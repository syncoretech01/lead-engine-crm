import { describe, expect, it } from "vitest";
import { matchSesSuppressionContact, parseSesEvent } from "@/lib/phase1/ses-events";
import { createSeedState } from "@/lib/phase1/seed";
import { isValidSnsUrl, snsSigningString, type SnsMessage } from "@/lib/phase1/sns-message";

describe("parseSesEvent", () => {
  it("suppresses on a permanent (hard) bounce and lowercases the email", () => {
    const body = JSON.stringify({
      notificationType: "Bounce",
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "Dead@Example.com" }] },
      mail: { messageId: "m-1" }
    });
    expect(parseSesEvent(body)).toEqual([
      { email: "dead@example.com", eventType: "Bounced", bounceType: "Hard", messageId: "m-1" }
    ]);
  });

  it("ignores transient (soft) bounces", () => {
    const body = JSON.stringify({
      eventType: "Bounce",
      bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "x@y.com" }] }
    });
    expect(parseSesEvent(body)).toEqual([]);
  });

  it("suppresses on a complaint (configuration-set eventType shape)", () => {
    const body = JSON.stringify({
      eventType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "spam@y.com" }] },
      mail: { messageId: "m-2" }
    });
    expect(parseSesEvent(body)).toEqual([{ email: "spam@y.com", eventType: "Spam complaint", messageId: "m-2" }]);
  });

  it("returns nothing for unrelated events or invalid JSON", () => {
    expect(parseSesEvent(JSON.stringify({ eventType: "Delivery" }))).toEqual([]);
    expect(parseSesEvent("not json")).toEqual([]);
  });

  it("captures the sending workspace from the SES message tag", () => {
    const body = JSON.stringify({
      eventType: "Bounce",
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "dead@example.com" }] },
      mail: { messageId: "m-3", tags: { syncore_workspace_id: ["workspace-b"] } }
    });
    expect(parseSesEvent(body)).toEqual([
      { email: "dead@example.com", eventType: "Bounced", bounceType: "Hard", messageId: "m-3", workspaceId: "workspace-b" }
    ]);
  });
});

describe("matchSesSuppressionContact (P2.1)", () => {
  function stateWithSharedEmail() {
    const state = createSeedState();
    const email = "shared@collision.test";
    const workspaceA = state.workspaces[0].id;
    state.workspaces.push({ ...state.workspaces[0], id: "workspace-b", name: "Workspace B" });
    state.contacts.push({ ...state.contacts[0], id: "contact-a-shared", workspaceId: workspaceA, email });
    state.contacts.push({ ...state.contacts[0], id: "contact-b-shared", workspaceId: "workspace-b", email });
    return { state, email, workspaceA };
  }

  it("matches strictly within the tagged workspace (no cross-tenant leak)", () => {
    const { state, email } = stateWithSharedEmail();
    const match = matchSesSuppressionContact(state, { email, eventType: "Bounced", workspaceId: "workspace-b" });
    expect(match.status).toBe("matched");
    if (match.status === "matched") {
      expect(match.contact.id).toBe("contact-b-shared");
    }
  });

  it("returns no-contact when the tagged workspace has no matching contact", () => {
    const { state, email } = stateWithSharedEmail();
    const match = matchSesSuppressionContact(state, { email, eventType: "Bounced", workspaceId: "workspace-absent" });
    expect(match.status).toBe("no-contact");
  });

  it("keeps the legacy first-match for untagged events by default", () => {
    const { state, email } = stateWithSharedEmail();
    const match = matchSesSuppressionContact(state, { email, eventType: "Bounced" });
    expect(match.status).toBe("matched");
  });

  it("quarantines untagged events when configured", () => {
    const { state, email } = stateWithSharedEmail();
    const match = matchSesSuppressionContact(state, { email, eventType: "Bounced" }, { quarantineUnscoped: true });
    expect(match.status).toBe("quarantined");
  });
});

describe("isValidSnsUrl", () => {
  it("accepts AWS SNS https hosts", () => {
    expect(isValidSnsUrl("https://sns.us-west-2.amazonaws.com/SimpleNotificationService.pem")).toBe(true);
  });

  it("rejects non-AWS hosts, http, and look-alike domains", () => {
    expect(isValidSnsUrl("https://evil.com/cert.pem")).toBe(false);
    expect(isValidSnsUrl("http://sns.us-west-2.amazonaws.com/cert.pem")).toBe(false);
    expect(isValidSnsUrl("https://sns.us-west-2.amazonaws.com.evil.com/cert.pem")).toBe(false);
  });
});

describe("snsSigningString", () => {
  it("orders Notification fields and omits an absent Subject", () => {
    const message = {
      Type: "Notification",
      MessageId: "id-1",
      TopicArn: "arn:topic",
      Message: "hello",
      Timestamp: "2026-01-01T00:00:00Z",
      Signature: "x",
      SignatureVersion: "1",
      SigningCertURL: "https://sns.us-west-2.amazonaws.com/c.pem"
    } as SnsMessage;

    expect(snsSigningString(message)).toBe(
      "Message\nhello\nMessageId\nid-1\nTimestamp\n2026-01-01T00:00:00Z\nTopicArn\narn:topic\nType\nNotification\n"
    );
  });
});
