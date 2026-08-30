import { beforeEach, describe, expect, it } from "vitest";

import { getLiveProviderOperation } from "@/lib/providers/live-adapters";
import {
  ensureLiveProviderAdaptersRegistered,
  resetLiveProviderAdapterRegistration
} from "@/lib/providers/register-live-adapters";
import { resolveUserSenderIdentity } from "@/lib/phase1/sender-identities";

/**
 * Email leaves through a path that owns the sending rules, or it does not leave.
 *
 * Registering amazon_ses in the live adapter registry made
 * `send_transactional_email` reachable from the GENERIC provider-job path — the
 * planner hands a ProviderJob's inputSummary to the matched adapter verbatim,
 * and the worker runs that path with SYNCORE_ENABLE_LIVE_PROVIDERS on. It was
 * also operator-selectable in the waterfall template UI. Either route would have
 * sent real mail with no suppression check, no List-Unsubscribe header, no
 * physical address (CAN-SPAM) and no golden-rule 8/13 cold-send check.
 *
 * The three legitimate senders — direct-email-send, outreach-send,
 * transactional-email-service — all import amazonSesSendEmail directly, so the
 * registration bought nothing.
 */
describe("live provider adapter boundary", () => {
  beforeEach(() => {
    resetLiveProviderAdapterRegistration();
    ensureLiveProviderAdaptersRegistered();
  });

  it("does not expose email sending through the generic provider-job registry", () => {
    expect(getLiveProviderOperation("amazon_ses", "send_transactional_email")).toBeUndefined();
  });

  it("still registers the data providers the job path legitimately drives", () => {
    // The guard above must not have been achieved by breaking registration.
    expect(getLiveProviderOperation("hunter", "find_email")).toBeTypeOf("function");
    expect(getLiveProviderOperation("apollo", "find_email")).toBeTypeOf("function");
    expect(getLiveProviderOperation("millionverifier", "verify_email")).toBeTypeOf("function");
    expect(getLiveProviderOperation("apify_maps", "discover_companies")).toBeTypeOf("function");
  });
});

describe("sender identity spoofing", () => {
  it("never lends the curated ADDRESS to someone matched only by name", () => {
    const identity = resolveUserSenderIdentity(
      { name: "Bobby Jones", email: "mallory@syncore-reach.test" },
      { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncore-reach.test" } as unknown as NodeJS.ProcessEnv
    );

    // The address is the thing that must never be borrowed: mail must not leave
    // as bobby@ because someone typed his name into their profile.
    expect(identity?.email).toBe("mallory@syncore-reach.test");
    expect(identity?.email).not.toBe("bobby@syncoretech.com");

    // KNOWN RESIDUAL, accepted deliberately: the display name is the user's own
    // profile name, and profile names are self-service, so this mailbox reads
    // "Bobby Jones <mallory@…>". Every non-curated user could already do that.
    // The alternative — refusing when a name matches a curated identity whose
    // address differs — locked out bobby.jones@lookalike, i.e. all three of the
    // people who actually send, on the exact deploy meant to unblock them. The
    // real gates are the domain allow-list and send_direct_outreach.
    expect(identity?.mailbox).toBe("Bobby Jones <mallory@syncore-reach.test>");
  });

  it("drops the curated display name along with its disallowed address", () => {
    // The name is spelled differently but normalises to the curated alias
    // (case is collapsed), which is what makes the two branches
    // observable: with the curated entry discarded the user's own spelling is
    // used, and if the curated name were allowed to win it would read
    // "Bobby Jones". Without this distinction the fallback is untestable — every
    // other name that matches an alias is already identical to it.
    //
    // Lowercase rather than odd whitespace on purpose: a double space is
    // invisible in review, and one auto-format that collapses it would make this
    // test silently vacuous.
    const identity = resolveUserSenderIdentity(
      { name: "bobby jones", email: "bobby.jones@syncore-reach.test" },
      { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncore-reach.test" } as unknown as NodeJS.ProcessEnv
    );

    expect(identity?.displayName).toBe("bobby jones");
    expect(identity?.mailbox).toBe("bobby jones <bobby.jones@syncore-reach.test>");
  });

  it("lets a curated rep send from a standard firstname.lastname lookalike address", () => {
    // The regression the local-part comparison caused. firstname.lastname@ is
    // the most common corporate convention there is.
    for (const email of ["bobby.jones@syncore-reach.test", "b.jones@syncore-reach.test", "bobby+ops@syncore-reach.test"]) {
      const identity = resolveUserSenderIdentity(
        { name: "Bobby Jones", email },
        { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncore-reach.test" } as unknown as NodeJS.ProcessEnv
      );
      expect(identity?.email, `${email} should be able to send`).toBe(email);
    }
  });

  it("still uses the curated identity when its own address is allowed", () => {
    const identity = resolveUserSenderIdentity(
      { name: "Bobby Jones", email: "bobby@syncoretech.com" },
      { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncoretech.com" } as unknown as NodeJS.ProcessEnv
    );

    expect(identity?.mailbox).toBe("Bobby Jones <bobby@syncoretech.com>");
  });

  it("lets a rep on an allow-listed lookalike domain send as themselves", () => {
    // The case rule 13 requires to be possible. Before this, the curated entry
    // pinned these three names to @syncoretech.com no matter what address the
    // User row held, making the rule unsatisfiable for the only identities that
    // actually send.
    const identity = resolveUserSenderIdentity(
      { name: "Sam Carter", email: "sam@syncore-reach.test" },
      { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncore-reach.test" } as unknown as NodeJS.ProcessEnv
    );

    expect(identity?.email).toBe("sam@syncore-reach.test");
  });
});
