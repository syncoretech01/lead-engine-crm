import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NotifyEnvelope,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_REPLAY_WINDOW_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER
} from "@syncore/contracts";
import {
  buildSignedNotify,
  signNotifyBody,
  signNotifyDeliveryAttempt,
  verifyNotifySignature
} from "@/lib/growth/notify";

const SECRET = "notify-secret-for-tests";
const saved = {
  secret: process.env.SYNCORE_BOT_NOTIFY_SECRET,
  url: process.env.SYNCORE_BOT_NOTIFY_URL
};

beforeEach(() => {
  process.env.SYNCORE_BOT_NOTIFY_SECRET = SECRET;
  process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
});

afterEach(() => {
  process.env.SYNCORE_BOT_NOTIFY_SECRET = saved.secret ?? "";
  process.env.SYNCORE_BOT_NOTIFY_URL = saved.url ?? "";
});

/**
 * A stand-in for the real bot's receiver.
 *
 * It verifies using the SAME exported function the CRM signs with, on purpose:
 * a re-implementation here could agree with a bug in the signer and both would
 * look correct. The real bot re-implements it from the contracts constants, and
 * the joint P1 test is what proves those two agree.
 */
function fakeBot(secret = SECRET) {
  const seenNonces = new Set<string>();

  return function receive(delivery: { body: string; headers: Record<string, string> }) {
    const signature = delivery.headers[WEBHOOK_SIGNATURE_HEADER];
    const timestamp = delivery.headers[WEBHOOK_TIMESTAMP_HEADER];
    const nonce = delivery.headers[WEBHOOK_NONCE_HEADER];

    if (!signature || !timestamp || !nonce) return { status: 400, reason: "missing headers" };

    const verdict = verifyNotifySignature({
      rawBody: delivery.body,
      timestamp,
      signature,
      secret
    });
    if (!verdict.valid) return { status: 401, reason: verdict.reason };

    // Replay protection is signature + window + nonce reuse, not any one alone.
    if (seenNonces.has(nonce)) return { status: 409, reason: "replayed nonce" };
    seenNonces.add(nonce);

    const parsed = NotifyEnvelope.safeParse(JSON.parse(delivery.body));
    if (!parsed.success) return { status: 422, reason: "envelope does not parse" };

    return { status: 200, envelope: parsed.data };
  };
}

const notify = () =>
  buildSignedNotify({
    kind: "APPROVAL_REQUESTED",
    workspaceId: "ws_1",
    approvalId: "apr_1",
    campaignId: "camp_1",
    payload: { title: "Approve ICP" }
  });

describe("signed notify", () => {
  it("sets all four webhook headers", () => {
    const signed = notify();
    expect(signed.headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signed.headers[WEBHOOK_TIMESTAMP_HEADER]).toBeTruthy();
    expect(signed.headers[WEBHOOK_NONCE_HEADER]).toBeTruthy();
    // Via the constant, not a lowercase literal: contracts exports the canonical
    // casing for SETTING headers ("X-Syncore-Delivery-Id"); only reading is
    // lowercased, by Node.
    expect(signed.headers[WEBHOOK_DELIVERY_ID_HEADER]).toBeTruthy();
  });

  it("produces an envelope that validates against the contracts schema", () => {
    const parsed = NotifyEnvelope.safeParse(JSON.parse(notify().body));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.source).toBe("crm");
    expect(parsed.success && parsed.data.data.kind).toBe("APPROVAL_REQUESTED");
  });

  it("uses the nonce header as the envelope nonce", () => {
    // contracts: "Must equal the X-Syncore-Nonce header — the body is what is signed."
    const signed = notify();
    const envelope = JSON.parse(signed.body) as { nonce: string };
    expect(envelope.nonce).toBe(signed.headers[WEBHOOK_NONCE_HEADER]);
  });

  it("is accepted by the fake bot", () => {
    expect(fakeBot()(notify()).status).toBe(200);
  });
});

describe("the fake bot rejects what it should", () => {
  it("rejects a tampered body", () => {
    const signed = notify();
    const tampered = { ...signed, body: signed.body.replace("Approve ICP", "Approve EVERYTHING") };
    const result = fakeBot()(tampered);
    expect(result.status).toBe(401);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects a rewritten timestamp", () => {
    // The timestamp is inside the signed material precisely so this fails. If it
    // were not, a replayer could move the window forward at will and the whole
    // replay defence would be decorative.
    const signed = notify();
    const moved = {
      ...signed,
      headers: {
        ...signed.headers,
        // Explicitly offset. `new Date().toISOString()` can land in the same
        // millisecond as the original and the test then proves nothing.
        [WEBHOOK_TIMESTAMP_HEADER]: new Date(Date.now() + 30_000).toISOString()
      }
    };
    expect(fakeBot()(moved).status).toBe(401);
  });

  it("rejects a delivery older than the replay window", () => {
    const old = new Date(Date.now() - (WEBHOOK_REPLAY_WINDOW_SECONDS + 60) * 1000).toISOString();
    const signed = buildSignedNotify({
      kind: "REPORT",
      workspaceId: "ws_1",
      occurredAt: old
    });
    const result = fakeBot()(signed);
    expect(result.status).toBe(401);
    expect(result.reason).toBe("outside replay window");
  });

  it("accepts a delivery just inside the replay window", () => {
    const recent = new Date(Date.now() - (WEBHOOK_REPLAY_WINDOW_SECONDS - 30) * 1000).toISOString();
    const signed = buildSignedNotify({ kind: "REPORT", workspaceId: "ws_1", occurredAt: recent });
    expect(fakeBot()(signed).status).toBe(200);
  });

  it("rejects a replayed nonce", () => {
    const bot = fakeBot();
    const signed = notify();
    expect(bot(signed).status).toBe(200);
    expect(bot(signed).status).toBe(409);
  });

  it("rejects a signature made with a different secret", () => {
    const signed = notify();
    expect(fakeBot("a-different-secret")(signed).status).toBe(401);
  });

  it("rejects missing headers outright", () => {
    const signed = notify();
    expect(fakeBot()({ body: signed.body, headers: {} }).status).toBe(400);
  });
});

describe("signing", () => {
  it("signs {timestamp}.{rawBody}, not the body alone", () => {
    const body = '{"a":1}';
    const ts = "2026-07-28T12:00:00.000Z";
    expect(signNotifyBody(body, ts, SECRET)).not.toBe(signNotifyBody(body, "2026-07-28T12:00:01.000Z", SECRET));
  });

  it("refreshes retry headers while preserving the exact payload bytes and identity", () => {
    const original = notify();
    const attemptedAt = new Date("2026-07-29T15:00:00.000Z");
    const retried = signNotifyDeliveryAttempt(original, attemptedAt, SECRET);

    expect(retried.body).toBe(original.body);
    expect(retried.headers[WEBHOOK_NONCE_HEADER]).toBe(original.headers[WEBHOOK_NONCE_HEADER]);
    expect(retried.headers[WEBHOOK_DELIVERY_ID_HEADER]).toBe(
      original.headers[WEBHOOK_DELIVERY_ID_HEADER]
    );
    expect(retried.headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(attemptedAt.toISOString());
    expect(
      verifyNotifySignature({
        rawBody: retried.body,
        timestamp: retried.headers[WEBHOOK_TIMESTAMP_HEADER],
        signature: retried.headers[WEBHOOK_SIGNATURE_HEADER],
        secret: SECRET,
        nowMs: attemptedAt.getTime()
      }).valid
    ).toBe(true);
  });

  it("fails closed when the secret is not configured", () => {
    // Signing with "" would produce a valid-looking signature over a known key.
    delete process.env.SYNCORE_BOT_NOTIFY_SECRET;
    expect(() => notify()).toThrow(/SYNCORE_BOT_NOTIFY_SECRET/);
  });

  it("fails closed when the bot URL is not configured", () => {
    delete process.env.SYNCORE_BOT_NOTIFY_URL;
    expect(() => notify()).toThrow(/SYNCORE_BOT_NOTIFY_URL/);
  });
});
