import { describe, expect, it } from "vitest";
import { parseSesEvent } from "@/lib/phase1/ses-events";
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
