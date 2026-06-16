import { describe, expect, it, vi } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import { createProviderJob } from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import {
  claimProviderJobRuns,
  processProviderJobQueue,
  recoverExpiredProviderJobRunLocks
} from "@/lib/phase1/provider-worker";
import { createSeedState } from "@/lib/phase1/seed";

describe("provider worker queue", () => {
  it("claims queued provider runs with a lease and completes mock execution without network access", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Provider worker should not call the network.");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret",
      allowedOperations: ["verify_email"]
    });
    const { job } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "nora@syncore.tech" }
    });

    const result = processProviderJobQueue(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:00.000Z"
    });
    const run = state.providerJobRuns[0];

    expect(result).toMatchObject({
      workerId: "worker-a",
      claimed: 1,
      completed: 1,
      failed: 0,
      recovered: 0
    });
    expect(state.providerJobs.find((item) => item.id === job.id)?.status).toBe("Completed");
    expect(run.status).toBe("Completed");
    expect(run.lockedBy).toBeUndefined();
    expect(run.responseSummary).toMatchObject({
      executionMode: "mock",
      operation: "verify_email"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not let another worker claim an active lease before it expires", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      secretValue: "apollo-secret",
      allowedOperations: ["discover_companies"]
    });
    createProviderJob(state, session, {
      providerId: "apollo",
      operation: "discover_companies",
      inputSummary: { industry: "SaaS" }
    });

    const firstClaim = claimProviderJobRuns(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:00.000Z",
      leaseMs: 60_000
    });
    const secondClaim = claimProviderJobRuns(state, {
      workerId: "worker-b",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:30.000Z",
      leaseMs: 60_000
    });

    expect(firstClaim).toHaveLength(1);
    expect(secondClaim).toHaveLength(0);
    expect(firstClaim[0].lockedBy).toBe("worker-a");
  });

  it("recovers expired locks so a later worker can claim the run", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "hunter",
      enabled: true,
      secretValue: "hunter-secret",
      allowedOperations: ["find_email"]
    });
    createProviderJob(state, session, {
      providerId: "hunter",
      operation: "find_email",
      inputSummary: { fullName: "Nora Patel", domain: "syncore.tech" }
    });
    claimProviderJobRuns(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:00.000Z",
      leaseMs: 1_000
    });

    const recovered = recoverExpiredProviderJobRunLocks(state, {
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:02.000Z"
    });
    const nextClaim = claimProviderJobRuns(state, {
      workerId: "worker-b",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:03.000Z"
    });

    expect(recovered).toBe(1);
    expect(nextClaim).toHaveLength(1);
    expect(nextClaim[0].lockedBy).toBe("worker-b");
  });

  it("queues due retries and preserves attempts", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "smartlead",
      enabled: true,
      secretValue: "smartlead-secret",
      allowedOperations: ["send_campaign"]
    });
    createProviderJob(state, session, {
      providerId: "smartlead",
      operation: "send_campaign",
      inputSummary: {
        campaignId: "campaign-1",
        forceMockFailure: true
      },
      startImmediately: false
    });

    const firstTick = processProviderJobQueue(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:00.000Z"
    });
    const secondTick = processProviderJobQueue(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:01:01.000Z"
    });

    expect(firstTick).toMatchObject({
      claimed: 1,
      completed: 0,
      failed: 1,
      retried: 0
    });
    expect(secondTick).toMatchObject({
      claimed: 1,
      completed: 0,
      failed: 1,
      retried: 1
    });
    expect(state.providerJobRuns).toHaveLength(2);
    expect(state.providerJobRuns[0].attempt).toBe(2);
  });
});
