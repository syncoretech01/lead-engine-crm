import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  NotifyEnvelope,
  type NotifyKind,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_REPLAY_WINDOW_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_PAYLOAD_SEPARATOR,
  WEBHOOK_SIGNATURE_PREFIX,
  WEBHOOK_TIMESTAMP_HEADER
} from "@syncore/contracts";

/**
 * Outbound `/notify` to the chat bot (v9.1 §9.4, §23).
 *
 * `@syncore/contracts` documents the signing scheme and ships its pieces as
 * constants, but deliberately no `sign()`/`verify()` helper — a shared crypto
 * helper is executable code, and six repos inheriting a shared runtime
 * dependency is the anti-scope that package is defined against. So the four
 * lines live here, built from the imported constants.
 *
 * THE SCHEME:
 *
 *     signature = "sha256=" + hex(HMAC_SHA256(secret, timestamp + "." + rawBody))
 *
 * The timestamp is INSIDE the signed material on purpose: a timestamp the sender
 * did not sign can be rewritten by whoever replays the request, which makes the
 * replay window decorative.
 *
 * `rawBody` is the exact bytes sent. That is why the outbox stores the
 * serialised envelope verbatim rather than re-serialising on retry — key order
 * would shift and the signature would stop matching.
 */

export type SignedNotify = {
  url: string;
  body: string;
  headers: Record<string, string>;
};

function notifySecret(): string {
  const secret = process.env.SYNCORE_BOT_NOTIFY_SECRET;
  // Fail closed. An unsigned notify would be accepted by nothing, but silently
  // signing with "" would produce a valid-looking signature over a known key.
  if (!secret) throw new Error("SYNCORE_BOT_NOTIFY_SECRET is not configured.");
  return secret;
}

function botNotifyUrl(): string {
  const url = process.env.SYNCORE_BOT_NOTIFY_URL;
  if (!url) throw new Error("SYNCORE_BOT_NOTIFY_URL is not configured.");
  return url;
}

/** `sha256=<hex>` over `{timestamp}.{rawBody}`. */
export function signNotifyBody(rawBody: string, timestamp: string, secret: string): string {
  const material = `${timestamp}${WEBHOOK_SIGNATURE_PAYLOAD_SEPARATOR}${rawBody}`;
  return `${WEBHOOK_SIGNATURE_PREFIX}${createHmac("sha256", secret).update(material, "utf8").digest("hex")}`;
}

/**
 * Re-sign the stored, canonical body for one delivery attempt.
 *
 * Retry timestamps must be fresh enough for the Contracts replay window, while
 * the body bytes, event id, and nonce remain unchanged so the Growth Bot can
 * deduplicate an attempt accepted before the CRM lost the response.
 */
export function signNotifyDeliveryAttempt(
  delivery: SignedNotify,
  attemptedAt: Date,
  secret = notifySecret()
): SignedNotify {
  const timestamp = attemptedAt.toISOString();
  return {
    ...delivery,
    body: delivery.body,
    headers: {
      ...delivery.headers,
      [WEBHOOK_SIGNATURE_HEADER]: signNotifyBody(delivery.body, timestamp, secret),
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp
    }
  };
}

/**
 * Verify a signature the way the receiver must — exported so the fake bot in the
 * tests checks deliveries exactly as the real bot will, rather than a
 * re-implementation that could agree with a bug.
 */
export function verifyNotifySignature(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowMs?: number;
}): { valid: boolean; reason?: string } {
  const age = Math.abs(((input.nowMs ?? Date.now()) - Date.parse(input.timestamp)) / 1000);
  if (Number.isNaN(age)) return { valid: false, reason: "unparseable timestamp" };
  if (age > WEBHOOK_REPLAY_WINDOW_SECONDS) return { valid: false, reason: "outside replay window" };

  const expected = signNotifyBody(input.rawBody, input.timestamp, input.secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "signature mismatch" };
  }
  return { valid: true };
}

export type BuildNotifyInput = {
  kind: NotifyKind;
  workspaceId: string;
  approvalId?: string;
  campaignId?: string;
  stageRunId?: string;
  payload?: Record<string, unknown>;
  /** Injected in tests; production mints them. */
  eventId?: string;
  nonce?: string;
  occurredAt?: string;
};

/**
 * Build the signed delivery.
 *
 * The envelope is validated against the contracts schema before signing — a
 * malformed body that the bot will reject should fail here, where the stack
 * trace points at the producer, not there.
 */
export function buildSignedNotify(input: BuildNotifyInput, secret = notifySecret()): SignedNotify {
  const eventId = input.eventId ?? `evt_${randomUUID()}`;
  const nonce = input.nonce ?? randomUUID();
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const envelope = NotifyEnvelope.parse({
    eventId,
    eventType: `notify.${input.kind.toLowerCase().replace(/_/g, ".")}`,
    occurredAt,
    nonce,
    source: "crm",
    workspaceId: input.workspaceId,
    data: {
      kind: input.kind,
      campaignId: input.campaignId,
      stageRunId: input.stageRunId,
      approvalId: input.approvalId,
      payload: input.payload ?? {}
    }
  });

  // Serialise ONCE. These exact bytes are what gets signed, stored and sent.
  const body = JSON.stringify(envelope);
  const timestamp = occurredAt;

  return {
    url: botNotifyUrl(),
    body,
    headers: {
      "content-type": "application/json",
      [WEBHOOK_SIGNATURE_HEADER]: signNotifyBody(body, timestamp, secret),
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_NONCE_HEADER]: nonce,
      [WEBHOOK_DELIVERY_ID_HEADER]: eventId
    }
  };
}
