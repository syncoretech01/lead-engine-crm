import { describe, expect, it } from "vitest";
import {
  completeJobRun,
  createTrackedJob,
  csvImportIdempotencyKey,
  csvImportRequestHash,
  failJobRun,
  jobObservabilitySnapshot,
  reserveJobIdempotency,
  retryFailedJob
} from "@/lib/phase1/jobs";
import { createSeedState } from "@/lib/phase1/seed";
import type { LeadJob } from "@/lib/phase1/types";

describe("async job observability", () => {
  it("backfills seeded jobs with runs and logs", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const snapshot = jobObservabilitySnapshot(state, workspaceId, job.id);

    expect(snapshot.runs.length).toBeGreaterThan(0);
    expect(snapshot.logs.length).toBeGreaterThan(0);
    expect(snapshot.latestRun?.providerRunId).toMatch(/^provider-/);
    expect(snapshot.latestRun?.idempotencyKey).toContain(job.id);
  });

  it("retries failed runs without replacing the original attempt", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const job: LeadJob = {
      id: "job-retry-test",
      workspaceId,
      name: "Retry test",
      status: "Running",
      progress: 10,
      sources: ["Apollo"],
      raw: 0,
      normalized: 0,
      duplicates: 0,
      suppressed: 0,
      verified: 0,
      enriched: 0,
      exported: 0,
      pushedToCrm: 0,
      actualCost: 0,
      eta: "Running",
      errorSummary: "Starting",
      createdById: "user-nora",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const tracked = createTrackedJob({ state, job, sources: ["Apollo"], startImmediately: true });
    failJobRun(state, {
      runId: tracked.runs[0].id,
      errorMessage: "Provider timeout"
    });

    const retry = retryFailedJob(state, workspaceId, job.id);
    const snapshot = jobObservabilitySnapshot(state, workspaceId, job.id);

    expect(retry.attempt).toBe(2);
    expect(snapshot.runs).toHaveLength(2);
    expect(snapshot.canRetry).toBe(false);
    expect(state.leadJobs.find((item) => item.id === job.id)?.status).toBe("Queued");
  });

  it("records completed idempotent imports", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const requestHash = csvImportRequestHash({
      workspaceId,
      source: "CSV Upload",
      csvText: "company,email\nSyncore,nora@syncore.tech",
      mapping: { companyName: "company", email: "email" }
    });
    const key = csvImportIdempotencyKey(workspaceId, requestHash);

    const reservation = reserveJobIdempotency(state, {
      workspaceId,
      key,
      scope: "csv_import",
      requestHash,
      leadJobId: "job-idempotency-test"
    });
    const replay = reserveJobIdempotency(state, {
      workspaceId,
      key,
      scope: "csv_import",
      requestHash,
      leadJobId: "job-idempotency-test"
    });

    expect(reservation.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
  });

  it("marks a run complete and updates the parent job", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const job: LeadJob = {
      id: "job-complete-test",
      workspaceId,
      name: "Complete test",
      status: "Running",
      progress: 25,
      sources: ["CSV Upload"],
      raw: 2,
      normalized: 0,
      duplicates: 0,
      suppressed: 0,
      verified: 0,
      enriched: 0,
      exported: 0,
      pushedToCrm: 0,
      actualCost: 0,
      eta: "Running",
      errorSummary: "Processing",
      createdById: "user-nora",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const tracked = createTrackedJob({ state, job, sources: ["CSV Upload"], startImmediately: true });

    completeJobRun(state, {
      runId: tracked.runs[0].id,
      recordsRead: 2,
      recordsWritten: 2
    });

    expect(state.leadJobs.find((item) => item.id === job.id)?.status).toBe("Completed");
    expect(jobObservabilitySnapshot(state, workspaceId, job.id).latestLog?.message).toBe("Run completed");
  });
});
