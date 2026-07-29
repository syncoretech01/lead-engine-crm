import type { Prisma } from "@prisma/client";
import type { NotifyKind } from "@syncore/contracts";
import { type BuildNotifyInput, buildSignedNotify } from "@/lib/growth/notify";
import { type GrowthPrismaClient, growthPrisma } from "@/lib/growth/repositories/client";

/**
 * The notify outbox (v9.1 §19).
 *
 * "A missed notify is retried; approvals valid in the dashboard regardless of
 * bot uptime." That is only true if the delivery outlives the request that
 * produced it, so enqueueing is a DB write inside the caller's transaction and
 * the HTTP call happens afterwards, out of band.
 *
 * 🔴 The ordering matters: a decision must never be delayed or blocked by a bot
 * outage. The decision commits, the notify drains later. Calling the bot inline
 * would make the operator's approval fail because a Slack app was restarting,
 * which is precisely the coupling v9.1 §15 forbids ("bot down ≠ pipeline
 * blocked").
 */

const MAX_ATTEMPTS = 8;

/** Exponential backoff, capped. 1m, 2m, 4m … 1h. */
function nextAttemptDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** attempts, 3_600_000);
}

/**
 * Enqueue a delivery. Signs at enqueue time and stores the exact bytes, because
 * the signature covers those bytes — re-serialising at send time would shift key
 * order and invalidate it.
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
      } as unknown as Prisma.InputJsonValue
    }
  });
}

export type DrainResult = { delivered: number; failed: number; remaining: number };

/**
 * Drain pending deliveries.
 *
 * Called by the worker, and by tests against a fake bot. Failures are recorded
 * with a backoff rather than thrown: one unreachable bot must not stop the rest
 * of the queue, and a permanently failing row must not be retried forever.
 */
export async function drainNotifyOutbox(
  options: {
    limit?: number;
    now?: Date;
    /** Injectable so tests can point at a fake bot without a network stub. */
    send?: (delivery: { url: string; body: string; headers: Record<string, string> }) => Promise<{
      ok: boolean;
      status: number;
    }>;
  } = {},
  client?: GrowthPrismaClient
): Promise<DrainResult> {
  const db = client ?? (await growthPrisma());
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;

  const send =
    options.send ??
    (async (delivery) => {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: delivery.headers,
        body: delivery.body
      });
      return { ok: response.ok, status: response.status };
    });

  const pending = await db.notifyOutbox.findMany({
    where: {
      deliveredAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit
  });

  let delivered = 0;
  let failed = 0;

  for (const row of pending) {
    const delivery = row.envelopeJson as unknown as {
      url: string;
      body: string;
      headers: Record<string, string>;
    };

    try {
      const result = await send(delivery);
      if (result.ok) {
        await db.notifyOutbox.update({
          where: { id: row.id },
          data: { deliveredAt: new Date(), attempts: row.attempts + 1, lastError: null }
        });
        delivered += 1;
        continue;
      }
      throw new Error(`Bot responded ${result.status}`);
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.notifyOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(attempts))
        }
      });
      failed += 1;
    }
  }

  const remaining = await db.notifyOutbox.count({
    where: { deliveredAt: null, attempts: { lt: MAX_ATTEMPTS } }
  });

  return { delivered, failed, remaining };
}
