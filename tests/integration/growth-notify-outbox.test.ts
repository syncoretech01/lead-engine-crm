import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER
} from "@syncore/contracts";
import {
  drainNotifyOutbox,
  enqueueNotify,
  getNotifyOutboxHealth,
  type NotifyDeliveryConfig,
  type NotifySendResult
} from "@/lib/growth/notify-outbox";
import { verifyNotifySignature } from "@/lib/growth/notify";
import {
  resetObservabilitySink,
  setObservabilitySink,
  type ObservabilityContext
} from "@/lib/phase1/observability";

const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const workspaceId = `ws_notify_${Date.now()}`;
const secret = "notify-integration-secret";
const defaultConfig: NotifyDeliveryConfig = {
  maxAttempts: 3,
  retryBaseMs: 1_000,
  retryMaxMs: 4_000,
  timeoutMs: 100,
  leaseMs: 2_000,
  batchSize: 25
};

async function db() {
  return (await import("@/lib/prisma")).prisma;
}

let sequence = 0;
async function enqueue(extra: { approvalId?: string; occurredAt?: string } = {}) {
  sequence += 1;
  return enqueueNotify({
    kind: "REPORT",
    workspaceId,
    approvalId: extra.approvalId,
    eventId: `evt_notify_${Date.now()}_${sequence}`,
    occurredAt: extra.occurredAt,
    payload: { title: `sensitive-payload-${sequence}` }
  });
}

const accepted = (): NotifySendResult => ({
  status: 202,
  body: { status: "accepted", deduped: false }
});

describe.skipIf(!enabled)("Growth NotifyOutbox delivery (real Postgres)", () => {
  beforeAll(async () => {
    process.env.SYNCORE_STORAGE_DRIVER = "prisma";
    process.env.SYNCORE_BOT_NOTIFY_SECRET = secret;
    process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
    const prisma = await db();
    await prisma.workspace.create({ data: { id: workspaceId, name: "Notify integration" } });
  });

  beforeEach(async () => {
    process.env.SYNCORE_BOT_NOTIFY_SECRET = secret;
    process.env.SYNCORE_BOT_NOTIFY_URL = "https://bot.example.test/notify";
    await (await db()).notifyOutbox.deleteMany({ where: { workspaceId } });
  });

  afterEach(() => {
    resetObservabilitySink();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!enabled) return;
    const prisma = await db();
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.$disconnect();
  });

  it("delivers once with fresh exact-byte signing and secret-free structured fields", async () => {
    const row = await enqueue({ approvalId: "approval-correlation-1" });
    const prisma = await db();
    const stored = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    const storedDelivery = stored.envelopeJson as unknown as { body: string };
    const attemptedAt = new Date("2026-07-29T16:00:00.000Z");
    const events: Array<{ name: string; data?: ObservabilityContext }> = [];
    setObservabilitySink({
      captureError: () => undefined,
      recordEvent: (name, data) => events.push({ name, data })
    });

    const send = vi.fn(async (delivery: { body: string; headers: Record<string, string> }) => {
      expect(delivery.body).toBe(storedDelivery.body);
      expect(delivery.headers[WEBHOOK_DELIVERY_ID_HEADER]).toBe(row.eventId);
      expect(
        verifyNotifySignature({
          rawBody: delivery.body,
          timestamp: delivery.headers[WEBHOOK_TIMESTAMP_HEADER],
          signature: delivery.headers[WEBHOOK_SIGNATURE_HEADER],
          secret,
          nowMs: attemptedAt.getTime()
        }).valid
      ).toBe(true);
      return accepted();
    });

    const result = await drainNotifyOutbox(
      { now: attemptedAt, workerId: "worker-success", config: defaultConfig, send },
      prisma
    );
    expect(result).toMatchObject({ claimed: 1, delivered: 1, failed: 0, remaining: 0 });
    const delivered = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(delivered.deliveredAt).toEqual(attemptedAt);
    expect(delivered.attempts).toBe(1);
    expect(delivered.claimToken).toBeNull();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "growth_notify_delivery_attempt",
      data: {
        notificationId: row.id,
        deliveryId: row.eventId,
        workspaceId,
        eventType: "notify.report",
        attemptCount: 1,
        correlationId: "approval-correlation-1",
        result: "accepted"
      }
    });
    const logLine = JSON.stringify(events[0]);
    expect(logLine).not.toContain(secret);
    expect(logLine).not.toContain("sensitive-payload");
    expect(logLine).not.toContain("headers");
  });

  it("persists a temporary connection failure, enforces retry time, then recovers", async () => {
    const row = await enqueue();
    const prisma = await db();
    const firstAt = new Date("2026-07-29T16:10:00.000Z");
    const unavailable = vi.fn(async () => {
      throw new Error("connection refused");
    });

    await drainNotifyOutbox(
      { now: firstAt, workerId: "worker-retry", config: defaultConfig, send: unavailable },
      prisma
    );
    const failed = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt).toEqual(new Date(firstAt.getTime() + 1_000));
    expect(failed.deadLetteredAt).toBeNull();
    expect(failed.lastError).toMatch(/^BOT_CONNECTION_ERROR:/);

    const tooEarly = vi.fn(async () => accepted());
    const early = await drainNotifyOutbox(
      {
        now: new Date(firstAt.getTime() + 999),
        workerId: "worker-retry",
        config: defaultConfig,
        send: tooEarly
      },
      prisma
    );
    expect(early.claimed).toBe(0);
    expect(tooEarly).not.toHaveBeenCalled();

    const recovered = await drainNotifyOutbox(
      {
        now: new Date(firstAt.getTime() + 1_000),
        workerId: "worker-retry",
        config: defaultConfig,
        send: async () => accepted()
      },
      prisma
    );
    expect(recovered.delivered).toBe(1);
    expect((await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(2);
  });

  it("times out an unresponsive Bot without losing the row", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => response.end('{"status":"accepted","deduped":false}'), 250);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    process.env.SYNCORE_BOT_NOTIFY_URL = `http://127.0.0.1:${address.port}/notify`;

    try {
      const row = await enqueue();
      const prisma = await db();
      const result = await drainNotifyOutbox(
        {
          workerId: "worker-timeout",
          config: { ...defaultConfig, timeoutMs: 25, leaseMs: 1_000 }
        },
        prisma
      );
      expect(result).toMatchObject({ delivered: 0, failed: 1, remaining: 1 });
      const pending = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
      expect(pending.deliveredAt).toBeNull();
      expect(pending.deadLetteredAt).toBeNull();
      expect(pending.lastError).toMatch(/^BOT_TIMEOUT:/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("dead-letters repeated non-2xx failures and exposes terminal health", async () => {
    const row = await enqueue();
    const prisma = await db();
    const config = {
      ...defaultConfig,
      maxAttempts: 4,
      retryBaseMs: 1_000,
      retryMaxMs: 1_000
    };
    const nonSuccess = vi.fn(async () => ({ status: 503, body: { error: "unavailable" } }));
    const times = [
      new Date("2026-07-29T16:20:00.000Z"),
      new Date("2026-07-29T16:20:01.000Z"),
      new Date("2026-07-29T16:20:02.000Z"),
      new Date("2026-07-29T16:20:03.000Z")
    ];

    for (const now of times.slice(0, 3)) {
      await drainNotifyOutbox({ now, workerId: "worker-dead", config, send: nonSuccess }, prisma);
    }
    expect(await getNotifyOutboxHealth(times[2], prisma)).toMatchObject({
      pending: 1,
      deadLettered: 0,
      repeatedlyFailing: 1
    });

    await drainNotifyOutbox({ now: times[3], workerId: "worker-dead", config, send: nonSuccess }, prisma);
    const terminal = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(terminal.attempts).toBe(4);
    expect(terminal.deadLetteredAt).toEqual(times[3]);
    expect(terminal.nextAttemptAt).toBeNull();
    expect(terminal.lastError).toBe("BOT_HTTP_ERROR: Bot responded HTTP 503.");

    const afterTerminal = await drainNotifyOutbox(
      { now: new Date(times[3].getTime() + 10_000), workerId: "worker-dead", config, send: nonSuccess },
      prisma
    );
    expect(afterTerminal.claimed).toBe(0);
    expect(nonSuccess).toHaveBeenCalledTimes(4);
    expect(await getNotifyOutboxHealth(times[3], prisma)).toMatchObject({
      pending: 0,
      deadLettered: 1,
      repeatedlyFailing: 0
    });
  });

  it("rejects malformed 2xx acknowledgements explicitly", async () => {
    const row = await enqueue();
    const prisma = await db();
    await drainNotifyOutbox(
      {
        now: new Date("2026-07-29T16:30:00.000Z"),
        workerId: "worker-malformed",
        config: defaultConfig,
        send: async () => ({ status: 202, body: { unexpected: true } })
      },
      prisma
    );
    expect((await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } })).lastError).toMatch(
      /^BOT_MALFORMED_RESPONSE:/
    );
  });

  it("allows only one concurrent worker to send an actively leased row", async () => {
    await enqueue();
    const prisma = await db();
    const send = vi.fn(async () => accepted());
    const now = new Date("2026-07-29T16:40:00.000Z");

    const [a, b] = await Promise.all([
      drainNotifyOutbox({ now, workerId: "worker-a", config: defaultConfig, send }, prisma),
      drainNotifyOutbox({ now, workerId: "worker-b", config: defaultConfig, send }, prisma)
    ]);
    expect(a.delivered + b.delivered).toBe(1);
    expect(a.claimed + b.claimed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("recovers an expired claim after a process restart", async () => {
    const row = await enqueue();
    const prisma = await db();
    const now = new Date("2026-07-29T16:50:00.000Z");
    await prisma.notifyOutbox.update({
      where: { id: row.id },
      data: {
        claimedBy: "terminated-worker",
        claimToken: "abandoned-token",
        claimExpiresAt: new Date(now.getTime() - 1)
      }
    });

    const result = await drainNotifyOutbox(
      { now, workerId: "replacement-worker", config: defaultConfig, send: async () => accepted() },
      prisma
    );
    expect(result).toMatchObject({ delivered: 1, recoveredClaims: 1 });
    const delivered = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(delivered.deliveredAt).toEqual(now);
    expect(delivered.claimedBy).toBeNull();
  });

  it("settles a retry as duplicate when the first accepted response was lost", async () => {
    const row = await enqueue();
    const prisma = await db();
    let botHasAccepted = false;
    const send = vi.fn(async () => {
      if (!botHasAccepted) {
        botHasAccepted = true;
        throw new Error("connection reset after Bot acceptance");
      }
      return { status: 200, body: { status: "duplicate" } };
    });
    const firstAt = new Date("2026-07-29T17:00:00.000Z");

    await drainNotifyOutbox(
      { now: firstAt, workerId: "worker-duplicate", config: defaultConfig, send },
      prisma
    );
    const result = await drainNotifyOutbox(
      {
        now: new Date(firstAt.getTime() + defaultConfig.retryBaseMs),
        workerId: "worker-duplicate",
        config: defaultConfig,
        send
      },
      prisma
    );
    expect(result.delivered).toBe(1);
    const delivered = await prisma.notifyOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(delivered.attempts).toBe(2);
    expect(delivered.deliveredAt).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("finishes the current delivery and leaves remaining work unclaimed on shutdown", async () => {
    await enqueue();
    await enqueue();
    const prisma = await db();
    let stopping = false;
    const send = vi.fn(async () => {
      stopping = true;
      return accepted();
    });

    const result = await drainNotifyOutbox(
      {
        now: new Date("2026-07-29T17:10:00.000Z"),
        workerId: "worker-shutdown",
        config: defaultConfig,
        shouldStop: () => stopping,
        send
      },
      prisma
    );
    expect(result).toMatchObject({ claimed: 1, delivered: 1, remaining: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await prisma.notifyOutbox.count({
        where: { workspaceId, deliveredAt: null, claimToken: { not: null } }
      })
    ).toBe(0);
  });
});
