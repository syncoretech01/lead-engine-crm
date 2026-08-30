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
  it("does not lend a curated display name to an arbitrary allowed address", () => {
    // `name` is self-service (app/settings/actions.ts), and the curated list is
    // matched by NAME as well as email. Letting the curated display name survive
    // while its address is rejected would let any rep send as "Bobby Jones".
    const identity = resolveUserSenderIdentity(
      { name: "Bobby Jones", email: "mallory@syncore-reach.test" },
      { SYNCORE_ALLOWED_SENDER_DOMAINS: "syncore-reach.test" } as unknown as NodeJS.ProcessEnv
    );

    // Refused outright: the curated address is not allowed here, and the
    // mailbox name does not match, so this is not Bobby on a new domain.
    expect(identity).toBeUndefined();
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
