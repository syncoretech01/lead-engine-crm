import { describe, expect, it, vi } from "vitest";
import {
  nextNotifyAttemptDelayMs,
  resolveNotifyDeliveryConfig
} from "@/lib/growth/notify-outbox";
import {
  type BackgroundWorkerDependencies,
  runBackgroundWorkerTick,
  waitForBackgroundWorkerInterval
} from "@/lib/phase1/background-worker-runner";

describe("Growth notification worker configuration", () => {
  it("uses a one-minute first retry and exponential capped backoff", () => {
    const retry = { retryBaseMs: 60_000, retryMaxMs: 3_600_000 };
    expect(nextNotifyAttemptDelayMs(1, retry)).toBe(60_000);
    expect(nextNotifyAttemptDelayMs(2, retry)).toBe(120_000);
    expect(nextNotifyAttemptDelayMs(8, retry)).toBe(3_600_000);
  });

  it("loads bounded delivery settings and rejects a lease shorter than timeout", () => {
    const config = resolveNotifyDeliveryConfig({}, {
      SYNCORE_BOT_NOTIFY_MAX_ATTEMPTS: "5",
      SYNCORE_BOT_NOTIFY_RETRY_BASE_MS: "1000",
      SYNCORE_BOT_NOTIFY_RETRY_MAX_MS: "8000",
      SYNCORE_BOT_NOTIFY_TIMEOUT_MS: "2000",
      SYNCORE_BOT_NOTIFY_LEASE_MS: "5000",
      SYNCORE_BOT_NOTIFY_BATCH_SIZE: "10"
    });
    expect(config).toEqual({
      maxAttempts: 5,
      retryBaseMs: 1000,
      retryMaxMs: 8000,
      timeoutMs: 2000,
      leaseMs: 5000,
      batchSize: 10
    });

    expect(() =>
      resolveNotifyDeliveryConfig({}, {
        SYNCORE_BOT_NOTIFY_TIMEOUT_MS: "5000",
        SYNCORE_BOT_NOTIFY_LEASE_MS: "5000"
      })
    ).toThrow(/lease/i);
  });
});

describe("combined background worker regression", () => {
  it("keeps every existing worker lane and adds the NotifyOutbox drain", async () => {
    const runProvider = vi.fn(async () => ({ lane: "provider" }));
    const runLead = vi.fn(async () => ({ lane: "lead" }));
    const runRecording = vi.fn(async () => ({ lane: "recording" }));
    const runDailyReports = vi.fn(async () => ({ lane: "daily" }));
    const drainNotify = vi.fn(async () => ({ lane: "notify" }));
    const dependencies = {
      runProvider,
      runLead,
      runRecording,
      runDailyReports,
      drainNotify
    } as unknown as BackgroundWorkerDependencies;
    const shouldStop = () => false;

    const result = await runBackgroundWorkerTick(
      { workspaceId: "ws_1", maxRuns: 4, workerId: "worker_1", shouldStop },
      dependencies
    );

    expect(runProvider).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      maxLiveRuns: 4,
      workerId: "worker_1"
    });
    expect(runLead).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      maxRuns: 4,
      workerId: "worker_1"
    });
    expect(runRecording).toHaveBeenCalledWith({ workspaceId: "ws_1" });
    expect(runDailyReports).toHaveBeenCalledWith({ workspaceId: "ws_1" });
    expect(drainNotify).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      workerId: "worker_1",
      shouldStop
    });
    expect(result).toEqual({
      provider: { lane: "provider" },
      lead: { lane: "lead" },
      recording: { lane: "recording" },
      dailyReports: { lane: "daily" },
      notify: { lane: "notify" }
    });
  });

  it("wakes an idle loop immediately on graceful shutdown", async () => {
    const shutdown = new AbortController();
    const waiting = waitForBackgroundWorkerInterval(60_000, shutdown.signal);
    shutdown.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
});
