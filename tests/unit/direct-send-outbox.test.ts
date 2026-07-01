import { describe, expect, it } from "vitest";
import {
  claimDirectSends,
  finalizeDirectSendClaims,
  findDirectSendClaim,
  openDirectSendClaimsForContact
} from "@/lib/phase1/direct-send-outbox";
import { createSeedState } from "@/lib/phase1/seed";

const base = {
  workspaceId: "workspace-syncore",
  channel: "Email" as const,
  requestId: "req-1",
  actorUserId: "user-ari"
};

describe("direct send outbox", () => {
  it("claims a recipient once and skips it on a same-request retry (at-most-once)", () => {
    const state = createSeedState();

    const first = claimDirectSends(state, { ...base, contactIds: ["contact-1"] });
    expect(first.toSend).toEqual(["contact-1"]);
    expect(first.alreadyClaimed).toEqual([]);

    const claim = findDirectSendClaim(state, { ...base, contactId: "contact-1" });
    expect(claim?.status).toBe("Sending");

    // Retry with the same requestId — the recipient must NOT be re-sent.
    const retry = claimDirectSends(state, { ...base, contactIds: ["contact-1"] });
    expect(retry.toSend).toEqual([]);
    expect(retry.alreadyClaimed).toEqual(["contact-1"]);
    expect(state.directSendClaims.filter((c) => c.contactId === "contact-1")).toHaveLength(1);
  });

  it("finalizes claims to Sent/Failed from send outcomes", () => {
    const state = createSeedState();
    claimDirectSends(state, { ...base, contactIds: ["contact-1", "contact-2"] });

    finalizeDirectSendClaims(state, {
      workspaceId: base.workspaceId,
      channel: "Email",
      requestId: base.requestId,
      outcomes: [
        { contactId: "contact-1", status: "sent", providerMessageId: "msg-abc" },
        { contactId: "contact-2", status: "failed", reason: "bounced" }
      ]
    });

    const sent = findDirectSendClaim(state, { ...base, contactId: "contact-1" });
    const failed = findDirectSendClaim(state, { ...base, contactId: "contact-2" });
    expect(sent?.status).toBe("Sent");
    expect(sent?.providerMessageId).toBe("msg-abc");
    expect(failed?.status).toBe("Failed");
    expect(failed?.reason).toBe("bounced");
  });

  it("separates claims by channel and request id", () => {
    const state = createSeedState();
    claimDirectSends(state, { ...base, contactIds: ["contact-1"] });

    // Different channel for the same contact/request is a distinct claim.
    const sms = claimDirectSends(state, { ...base, channel: "SMS", contactIds: ["contact-1"] });
    expect(sms.toSend).toEqual(["contact-1"]);

    // Different requestId is also a distinct claim (a fresh attempt can send).
    const newRequest = claimDirectSends(state, { ...base, requestId: "req-2", contactIds: ["contact-1"] });
    expect(newRequest.toSend).toEqual(["contact-1"]);
  });

  it("surfaces only open (Sending) claims for a contact", () => {
    const state = createSeedState();
    claimDirectSends(state, { ...base, contactIds: ["contact-1"] });
    claimDirectSends(state, { ...base, requestId: "req-2", contactIds: ["contact-1"] });
    finalizeDirectSendClaims(state, {
      workspaceId: base.workspaceId,
      channel: "Email",
      requestId: "req-2",
      outcomes: [{ contactId: "contact-1", status: "sent", providerMessageId: "msg-1" }]
    });

    const open = openDirectSendClaimsForContact(state, {
      workspaceId: base.workspaceId,
      contactId: "contact-1"
    });
    expect(open).toHaveLength(1);
    expect(open[0].requestId).toBe("req-1");
    expect(open[0].status).toBe("Sending");
  });
});
