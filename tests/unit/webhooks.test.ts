import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/phase1/seed";
import {
  processEmailWebhook,
  processSmsWebhook,
  signWebhookPayload,
  verifyWebhookSignature
} from "@/lib/phase1/webhooks";

describe("signed webhook processing", () => {
  it("validates HMAC signatures with optional sha256 prefix", () => {
    const body = JSON.stringify({ providerEventId: "evt-test" });
    const signature = signWebhookPayload(body, "secret");

    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${signature}`, "secret")).toBe(true);
    expect(verifyWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("processes hard-bounce email webhooks once and suppresses the contact", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const actor = state.users[0];
    const contact = state.contacts.find((item) => !item.isSuppressed && item.email);

    if (!contact) {
      throw new Error("Expected seeded contact.");
    }

    const payload = {
      workspaceId,
      contactId: contact.id,
      eventType: "Bounced" as const,
      bounceType: "Hard" as const,
      smtpCode: "550",
      providerEventId: "mailgun-event-1",
      messageId: "message-1",
      subject: "Webhook bounce",
      bodySnapshot: "Hard bounce from provider."
    };
    const first = processEmailWebhook(state, payload, actor);
    const emailEventsAfterFirst = state.emailEvents.length;
    const second = processEmailWebhook(state, payload, actor);

    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
    expect(state.emailEvents).toHaveLength(emailEventsAfterFirst);
    expect(state.webhookEvents.filter((event) => event.providerEventId === "mailgun-event-1")).toHaveLength(2);
    expect(state.contacts.find((item) => item.id === contact.id)?.isSuppressed).toBe(true);
    expect(state.suppressionRecords.some((record) => record.type === "Hard bounce" && record.email === contact.email)).toBe(true);
  });

  it("processes SMS opt-out webhooks idempotently", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const actor = state.users[0];
    const contact = state.contacts.find((item) => !item.isSuppressed && item.phone);

    if (!contact) {
      throw new Error("Expected seeded contact with phone.");
    }

    const payload = {
      workspaceId,
      contactId: contact.id,
      status: "Opt-out" as const,
      providerEventId: "ringcentral-event-1",
      body: "STOP",
      direction: "Inbound" as const
    };
    const first = processSmsWebhook(state, payload, actor);
    const smsEventsAfterFirst = state.smsEvents.length;
    const second = processSmsWebhook(state, payload, actor);

    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
    expect(state.smsEvents).toHaveLength(smsEventsAfterFirst);
    expect(state.contacts.find((item) => item.id === contact.id)?.isSuppressed).toBe(true);
    expect(state.suppressionRecords.some((record) => record.type === "SMS opt-out" && record.phone === contact.phone)).toBe(true);
  });
});
