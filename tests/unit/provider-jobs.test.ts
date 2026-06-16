import { describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import {
  completeProviderJobRun,
  createProviderJob,
  failProviderJobRun,
  providerJobSnapshot,
  retryProviderJobRun,
  startProviderJobRun
} from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { createSeedState } from "@/lib/phase1/seed";

describe("provider job records", () => {
  it("creates idempotent provider jobs and redacts sensitive input summaries", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret"
    });

    const first = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: {
        email: "nora@syncore.tech",
        apiKey: "must-not-persist"
      },
      sourceObjectType: "contact",
      sourceObjectId: "contact-1",
      startImmediately: true
    });
    const replay = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: {
        email: "nora@syncore.tech",
        apiKey: "must-not-persist"
      },
      sourceObjectType: "contact",
      sourceObjectId: "contact-1",
      startImmediately: true
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.job.id).toBe(first.job.id);
    expect(state.providerJobs).toHaveLength(1);
    expect(state.providerJobRuns).toHaveLength(1);
    expect(first.job.status).toBe("Running");
    expect(first.job.inputSummary).toMatchObject({
      email: "nora@syncore.tech",
      apiKey: "[redacted]"
    });
    expect(JSON.stringify(state)).not.toContain("must-not-persist");
  });

  it("completes provider runs and updates the parent job summary", () => {
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

    const { job, run } = createProviderJob(state, session, {
      providerId: "apollo",
      operation: "discover_companies",
      inputSummary: { industries: ["SaaS"], geography: "US" }
    });
    startProviderJobRun(state, run.id);
    completeProviderJobRun(state, {
      runId: run.id,
      recordsRead: 10,
      recordsWritten: 8,
      costCents: 125,
      responseSummary: { companies: 8 },
      rawResponseRef: "object://provider-responses/apollo/run-1.json"
    });
    const snapshot = providerJobSnapshot(state, session.workspace.id, job.id);

    expect(snapshot.job?.status).toBe("Completed");
    expect(snapshot.job?.recordsRead).toBe(10);
    expect(snapshot.latestRun?.status).toBe("Completed");
    expect(snapshot.latestRun?.rawResponseRef).toContain("apollo");
    expect(snapshot.canRetry).toBe(false);
  });

  it("tracks retryable provider failures without replacing earlier attempts", () => {
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

    const { job, run } = createProviderJob(state, session, {
      providerId: "hunter",
      operation: "find_email",
      inputSummary: { fullName: "Nora Patel", domain: "syncore.tech" },
      startImmediately: true
    });
    failProviderJobRun(state, {
      runId: run.id,
      errorMessage: "Provider rate limit",
      nextRetryAt: "2026-06-16T10:00:00.000Z"
    });
    const retry = retryProviderJobRun(state, job.id);
    const snapshot = providerJobSnapshot(state, session.workspace.id, job.id);

    expect(retry.attempt).toBe(2);
    expect(snapshot.runs).toHaveLength(2);
    expect(snapshot.job?.status).toBe("Queued");
    expect(snapshot.canRetry).toBe(false);
  });

  it("rejects unsupported or disabled provider operations", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret"
    });

    expect(() =>
      createProviderJob(state, session, {
        providerId: "zerobounce",
        operation: "discover_companies"
      })
    ).toThrow(/does not support operation/);

    expect(() =>
      createProviderJob(state, session, {
        providerId: "smartlead",
        operation: "send_campaign"
      })
    ).toThrow(/disabled/);
  });
});
