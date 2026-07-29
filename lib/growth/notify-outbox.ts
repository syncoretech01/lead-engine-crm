import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import {
  NotifyEnvelope,
  type NotifyKind,
  WEBHOOK_DELIVERY_ID_HEADER
} from "@syncore/contracts";
import {
  type BuildNotifyInput,
  type SignedNotify,
  buildSignedNotify,
  signNotifyDeliveryAttempt
} from "@/lib/growth/notify";
import { type GrowthPrismaClient, growthPrisma } from "@/lib/growth/repositories/client";
import { recordEvent } from "@/lib/phase1/observability";

/**
 * Durable CRM -> Growth Bot delivery (Growth OS Wave 1, Step 1.2).
 *
 * The database is the queue. A short Postgres lease owns one row at a time; no
 * transaction is held while the network request is in flight. A receiver may
 * therefore observe a duplicate if the process dies after the Bot accepts but
 * before the CRM settles the row. eventId/delivery-id stays stable so the Bot can
 * acknowledge that retry as a duplicate without enqueueing a second message.
 */

export type NotifyDeliveryConfig = {
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  timeoutMs: number;
  leaseMs: number;
  batchSize: number;
};

const DEFAULT_CONFIG: NotifyDeliveryConfig = {
  maxAttempts: 8,
  retryBaseMs: 60_000,
  retryMaxMs: 3_600_000,
  timeoutMs: 15_000,
  leaseMs: 60_000,
  batchSize: 25
};

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function resolveNotifyDeliveryConfig(
  overrides: Partial<NotifyDeliveryConfig> = {},
  env: Record<string, string | undefined> = process.env
): NotifyDeliveryConfig {
  const config = {
    maxAttempts:
      overrides.maxAttempts ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_MAX_ATTEMPTS",
        env.SYNCORE_BOT_NOTIFY_MAX_ATTEMPTS,
        DEFAULT_CONFIG.maxAttempts
      ),
    retryBaseMs:
      overrides.retryBaseMs ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_RETRY_BASE_MS",
        env.SYNCORE_BOT_NOTIFY_RETRY_BASE_MS,
        DEFAULT_CONFIG.retryBaseMs
      ),
    retryMaxMs:
      overrides.retryMaxMs ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_RETRY_MAX_MS",
        env.SYNCORE_BOT_NOTIFY_RETRY_MAX_MS,
        DEFAULT_CONFIG.retryMaxMs
      ),
    timeoutMs:
      overrides.timeoutMs ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_TIMEOUT_MS",
        env.SYNCORE_BOT_NOTIFY_TIMEOUT_MS,
        DEFAULT_CONFIG.timeoutMs
      ),
    leaseMs:
      overrides.leaseMs ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_LEASE_MS",
        env.SYNCORE_BOT_NOTIFY_LEASE_MS,
        DEFAULT_CONFIG.leaseMs
      ),
    batchSize:
      overrides.batchSize ??
      positiveInteger(
        "SYNCORE_BOT_NOTIFY_BATCH_SIZE",
        env.SYNCORE_BOT_NOTIFY_BATCH_SIZE,
        DEFAULT_CONFIG.batchSize
      )
  };

  if (config.retryMaxMs < config.retryBaseMs) {
    throw new Error("SYNCORE_BOT_NOTIFY_RETRY_MAX_MS must be at least the retry base.");
  }
  if (config.leaseMs <= config.timeoutMs) {
    throw new Error("SYNCORE_BOT_NOTIFY_LEASE_MS must be greater than the Bot timeout.");
  }
  return config;
}

/** First failure waits base, then base*2, base*4, capped at retryMaxMs. */
export function nextNotifyAttemptDelayMs(
  attempts: number,
  config: Pick<NotifyDeliveryConfig, "retryBaseMs" | "retryMaxMs">
): number {
  return Math.min(config.retryBaseMs * 2 ** Math.max(0, attempts - 1), config.retryMaxMs);
}

/**
 * Enqueue a delivery. Sign and serialize once here; each send attempt later
 * refreshes only the timestamp/signature headers over these exact body bytes.
 */
export async function enqueueNotify(
  input: BuildNotifyInput & { kind: NotifyKind },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const signed = buildSignedNotify(input);
  const envelope = JSON.parse(signed.body) as { eventId: string };

  return db.notifyOutbox.create({
    data: {
      workspaceId: input.workspaceId,
      kind: input.kind,
      eventId: envelope.eventId,
      approvalId: input.approvalId ?? null,
      campaignId: input.campaignId ?? null,
      stageRunId: input.stageRunId ?? null,
      envelopeJson: {
        body: signed.body,
        headers: signed.headers,
        url: signed.url
      } as unknown as PrismaTypes.InputJsonValue
    }
  });
}

export type NotifySendResult = {
  status: number;
  body: unknown;
  malformedBody?: boolean;
};

export type DrainResult = {
  claimed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  recoveredClaims: number;
  remaining: number;
};

type ClaimedNotifyRow = {
  id: string;
  workspaceId: string;
  kind: string;
  envelopeJson: PrismaTypes.JsonValue;
  eventId: string;
  approvalId: string | null;
  campaignId: string | null;
  stageRunId: string | null;
  attempts: number;
  claimToken: string;
  claimedBy: string;
  previousClaimedBy: string | null;
  previousClaimExpiresAt: Date | null;
};

type DecodedDelivery = {
  delivery: SignedNotify;
  eventType: string;
};

class NotifyDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "NotifyDeliveryError";
  }
}

function defaultWorkerId(): string {
  return `syncore-notify:${hostname()}:${process.pid}`;
}

function decodeStoredDelivery(row: ClaimedNotifyRow): DecodedDelivery {
  const stored = row.envelopeJson;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new NotifyDeliveryError("MALFORMED_OUTBOX_ROW", "Stored delivery is not an object.");
  }

  const candidate = stored as Record<string, unknown>;
  if (
    typeof candidate.url !== "string" ||
    typeof candidate.body !== "string" ||
    !candidate.headers ||
    typeof candidate.headers !== "object" ||
    Array.isArray(candidate.headers)
  ) {
    throw new NotifyDeliveryError("MALFORMED_OUTBOX_ROW", "Stored delivery fields are malformed.");
  }

  const headers = candidate.headers as Record<string, unknown>;
  if (Object.values(headers).some((value) => typeof value !== "string")) {
    throw new NotifyDeliveryError("MALFORMED_OUTBOX_ROW", "Stored delivery headers are malformed.");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(candidate.body);
  } catch {
    throw new NotifyDeliveryError("MALFORMED_OUTBOX_ROW", "Stored delivery body is not JSON.");
  }
  const envelope = NotifyEnvelope.safeParse(parsedBody);
  if (!envelope.success || envelope.data.eventId !== row.eventId) {
    throw new NotifyDeliveryError(
      "MALFORMED_OUTBOX_ROW",
      "Stored delivery body does not match its outbox identity."
    );
  }

  const configuredUrl = process.env.SYNCORE_BOT_NOTIFY_URL;
  if (!configuredUrl) {
    throw new NotifyDeliveryError("BOT_URL_NOT_CONFIGURED", "SYNCORE_BOT_NOTIFY_URL is not configured.");
  }
  let allowedUrl: URL;
  try {
    allowedUrl = new URL(configuredUrl);
  } catch {
    throw new NotifyDeliveryError("BOT_URL_INVALID", "The configured Bot URL is invalid.");
  }
  if (!/^https?:$/.test(allowedUrl.protocol)) {
    throw new NotifyDeliveryError(
      "BOT_ORIGIN_NOT_ALLOWED",
      "The configured Bot URL must use HTTP or HTTPS."
    );
  }
  if (process.env.NODE_ENV === "production" && allowedUrl.protocol !== "https:") {
    throw new NotifyDeliveryError("BOT_ORIGIN_NOT_ALLOWED", "The production Bot URL must use HTTPS.");
  }
  if (!process.env.SYNCORE_BOT_NOTIFY_SECRET) {
    throw new NotifyDeliveryError(
      "BOT_SIGNING_SECRET_NOT_CONFIGURED",
      "SYNCORE_BOT_NOTIFY_SECRET is not configured."
    );
  }

  return {
    delivery: {
      // The current environment value is the allow-list and delivery target.
      // Stored rows survive an intentional Bot URL rotation without becoming an
      // SSRF primitive through a mutable database URL.
      url: allowedUrl.toString(),
      body: candidate.body,
      headers: headers as Record<string, string>
    },
    eventType: envelope.data.eventType
  };
}

async function defaultSend(delivery: SignedNotify, timeoutMs: number): Promise<NotifySendResult> {
  let response: Response;
  try {
    response = await fetch(delivery.url, {
      method: "POST",
      headers: delivery.headers,
      body: delivery.body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new NotifyDeliveryError("BOT_TIMEOUT", `Bot request timed out after ${timeoutMs}ms.`);
    }
    throw new NotifyDeliveryError("BOT_CONNECTION_ERROR", "Bot connection failed.");
  }

  const raw = await response.text();
  if (!raw) return { status: response.status, body: null, malformedBody: true };
  try {
    return { status: response.status, body: JSON.parse(raw) as unknown };
  } catch {
    return { status: response.status, body: null, malformedBody: true };
  }
}

function botAcknowledgement(result: NotifySendResult): "accepted" | "duplicate" {
  if (result.status < 200 || result.status >= 300) {
    throw new NotifyDeliveryError("BOT_HTTP_ERROR", `Bot responded HTTP ${result.status}.`);
  }
  if (result.malformedBody || !result.body || typeof result.body !== "object") {
    throw new NotifyDeliveryError(
      "BOT_MALFORMED_RESPONSE",
      `Bot returned a malformed success response (HTTP ${result.status}).`
    );
  }

  const body = result.body as Record<string, unknown>;
  if (result.status === 202 && body.status === "accepted" && typeof body.deduped === "boolean") {
    return "accepted";
  }
  if (result.status === 200 && body.status === "duplicate") return "duplicate";
  throw new NotifyDeliveryError(
    "BOT_MALFORMED_RESPONSE",
    `Bot returned an unexpected success response (HTTP ${result.status}).`
  );
}

function deliveryError(error: unknown): NotifyDeliveryError {
  if (error instanceof NotifyDeliveryError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new NotifyDeliveryError("BOT_TIMEOUT", "Bot request timed out.");
  }
  return new NotifyDeliveryError(
    "BOT_CONNECTION_ERROR",
    "Bot delivery failed."
  );
}

async function claimNextNotify(
  db: GrowthPrismaClient,
  input: {
    now: Date;
    leaseMs: number;
    maxAttempts: number;
    workerId: string;
    workspaceId?: string;
  }
): Promise<ClaimedNotifyRow | null> {
  const claimToken = randomUUID();
  const expiresAt = new Date(input.now.getTime() + input.leaseMs);
  const workspaceClause = input.workspaceId
    ? Prisma.sql`AND "workspaceId" = ${input.workspaceId}`
    : Prisma.empty;

  const rows = await db.$queryRaw<ClaimedNotifyRow[]>(Prisma.sql`
    WITH candidate AS (
      SELECT
        "id",
        "claimedBy" AS "previousClaimedBy",
        "claimExpiresAt" AS "previousClaimExpiresAt"
      FROM "NotifyOutbox"
      WHERE "deliveredAt" IS NULL
        AND "deadLetteredAt" IS NULL
        AND "attempts" < ${input.maxAttempts}
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${input.now})
        AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= ${input.now})
        ${workspaceClause}
      ORDER BY "createdAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "NotifyOutbox" AS outbox
    SET "claimedBy" = ${input.workerId},
        "claimToken" = ${claimToken},
        "claimExpiresAt" = ${expiresAt},
        "updatedAt" = ${input.now}
    FROM candidate
    WHERE outbox."id" = candidate."id"
    RETURNING
      outbox."id",
      outbox."workspaceId",
      outbox."kind",
      outbox."envelopeJson",
      outbox."eventId",
      outbox."approvalId",
      outbox."campaignId",
      outbox."stageRunId",
      outbox."attempts",
      outbox."claimToken",
      outbox."claimedBy",
      candidate."previousClaimedBy",
      candidate."previousClaimExpiresAt"
  `);
  return rows[0] ?? null;
}

function logAttempt(
  row: ClaimedNotifyRow,
  eventType: string,
  attemptCount: number,
  result: string,
  recoveredClaim: boolean,
  errorCode?: string
) {
  recordEvent("growth_notify_delivery_attempt", {
    notificationId: row.id,
    deliveryId: row.eventId,
    workspaceId: row.workspaceId,
    eventType,
    kind: row.kind,
    attemptCount,
    correlationId: row.approvalId ?? row.stageRunId ?? row.campaignId ?? row.eventId,
    workerId: row.claimedBy,
    recoveredClaim,
    result,
    ...(errorCode ? { errorCode } : {})
  });
}

export async function drainNotifyOutbox(
  options: {
    limit?: number;
    now?: Date;
    workspaceId?: string;
    workerId?: string;
    config?: Partial<NotifyDeliveryConfig>;
    shouldStop?: () => boolean;
    /** Injectable fake Bot; locking/concurrency remains real in integration tests. */
    send?: (delivery: SignedNotify) => Promise<NotifySendResult>;
  } = {},
  client?: GrowthPrismaClient
): Promise<DrainResult> {
  const db = client ?? (await growthPrisma());
  const config = resolveNotifyDeliveryConfig(options.config);
  const limit = options.limit ?? config.batchSize;
  const workerId = options.workerId ?? defaultWorkerId();
  const clock = options.now ? () => options.now as Date : () => new Date();
  const send = options.send ?? ((delivery: SignedNotify) => defaultSend(delivery, config.timeoutMs));

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  let recoveredClaims = 0;

  // If operators lower the configured maximum, rows already at/over that limit
  // must become visible terminal work rather than sitting forever in neither the
  // claimable nor dead-letter set. Never take an active lease away from a worker.
  const terminalizedAt = clock();
  const terminalized = await db.notifyOutbox.updateMany({
    where: {
      deliveredAt: null,
      deadLetteredAt: null,
      attempts: { gte: config.maxAttempts },
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: terminalizedAt } }]
    },
    data: {
      deadLetteredAt: terminalizedAt,
      nextAttemptAt: null,
      claimedBy: null,
      claimToken: null,
      claimExpiresAt: null
    }
  });
  deadLettered += terminalized.count;

  while (claimed < limit && !options.shouldStop?.()) {
    const attemptedAt = clock();
    const row = await claimNextNotify(db, {
      now: attemptedAt,
      leaseMs: config.leaseMs,
      maxAttempts: config.maxAttempts,
      workerId,
      workspaceId: options.workspaceId
    });
    if (!row) break;

    claimed += 1;
    const recoveredClaim = row.previousClaimExpiresAt !== null;
    if (recoveredClaim) recoveredClaims += 1;
    const attemptCount = row.attempts + 1;
    let eventType = `notify.${row.kind.toLowerCase().replace(/_/g, ".")}`;

    try {
      const decoded = decodeStoredDelivery(row);
      eventType = decoded.eventType;
      const attempt = signNotifyDeliveryAttempt(decoded.delivery, attemptedAt);
      if (attempt.headers[WEBHOOK_DELIVERY_ID_HEADER] !== row.eventId) {
        throw new NotifyDeliveryError(
          "MALFORMED_OUTBOX_ROW",
          "Stored delivery-id header does not match the outbox identity."
        );
      }
      const acknowledgement = botAcknowledgement(await send(attempt));
      const settled = await db.notifyOutbox.updateMany({
        where: { id: row.id, claimedBy: workerId, claimToken: row.claimToken },
        data: {
          deliveredAt: clock(),
          attempts: attemptCount,
          lastError: null,
          nextAttemptAt: null,
          claimedBy: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      if (settled.count !== 1) {
        failed += 1;
        logAttempt(row, eventType, attemptCount, "claim_lost", recoveredClaim, "CLAIM_LOST");
        continue;
      }
      delivered += 1;
      logAttempt(row, eventType, attemptCount, acknowledgement, recoveredClaim);
    } catch (error) {
      const failure = deliveryError(error);
      const terminal = attemptCount >= config.maxAttempts;
      const finishedAt = clock();
      const settled = await db.notifyOutbox.updateMany({
        where: { id: row.id, claimedBy: workerId, claimToken: row.claimToken },
        data: {
          attempts: attemptCount,
          lastError: `${failure.code}: ${failure.message}`.slice(0, 1000),
          nextAttemptAt: terminal
            ? null
            : new Date(
                finishedAt.getTime() +
                  nextNotifyAttemptDelayMs(attemptCount, {
                    retryBaseMs: config.retryBaseMs,
                    retryMaxMs: config.retryMaxMs
                  })
              ),
          deadLetteredAt: terminal ? finishedAt : null,
          claimedBy: null,
          claimToken: null,
          claimExpiresAt: null
        }
      });
      failed += 1;
      if (settled.count !== 1) {
        logAttempt(row, eventType, attemptCount, "claim_lost", recoveredClaim, "CLAIM_LOST");
        continue;
      }
      if (terminal) deadLettered += 1;
      logAttempt(
        row,
        eventType,
        attemptCount,
        terminal ? "dead_letter" : "retry_scheduled",
        recoveredClaim,
        failure.code
      );
    }
  }

  const remaining = await db.notifyOutbox.count({
    where: { deliveredAt: null, deadLetteredAt: null, attempts: { lt: config.maxAttempts } }
  });
  return { claimed, delivered, failed, deadLettered, recoveredClaims, remaining };
}

export type NotifyOutboxHealth = {
  pending: number;
  activeClaims: number;
  repeatedlyFailing: number;
  deadLettered: number;
  oldestPendingAgeSeconds: number | null;
};

/** Safe aggregate only: no endpoint, headers, secrets, or payload bytes. */
export async function getNotifyOutboxHealth(
  now = new Date(),
  client?: GrowthPrismaClient
): Promise<NotifyOutboxHealth> {
  const db = client ?? (await growthPrisma());
  const [pending, activeClaims, repeatedlyFailing, deadLettered, oldestPending] = await Promise.all([
    db.notifyOutbox.count({ where: { deliveredAt: null, deadLetteredAt: null } }),
    db.notifyOutbox.count({
      where: { deliveredAt: null, deadLetteredAt: null, claimExpiresAt: { gt: now } }
    }),
    db.notifyOutbox.count({
      where: { deliveredAt: null, deadLetteredAt: null, attempts: { gte: 3 } }
    }),
    db.notifyOutbox.count({ where: { deadLetteredAt: { not: null } } }),
    db.notifyOutbox.findFirst({
      where: { deliveredAt: null, deadLetteredAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true }
    })
  ]);

  return {
    pending,
    activeClaims,
    repeatedlyFailing,
    deadLettered,
    oldestPendingAgeSeconds: oldestPending
      ? Math.max(0, Math.floor((now.getTime() - oldestPending.createdAt.getTime()) / 1000))
      : null
  };
}
