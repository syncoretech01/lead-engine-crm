import {
  completeProviderJobRun,
  failProviderJobRun,
  retryProviderJobRun
} from "@/lib/phase1/provider-jobs";
import type { AppState, ProviderJob, ProviderJobRun, ProviderJobStatus } from "@/lib/phase1/types";
import { providerConfig } from "@/lib/providers/registry";

const defaultLeaseMs = 60_000;
const defaultBatchSize = 5;

export type ProviderWorkerClaimOptions = {
  workerId: string;
  workspaceId?: string;
  maxRuns?: number;
  leaseMs?: number;
  now?: string;
};

export type ProviderWorkerExecutionResult = {
  runId: string;
  providerJobId: string;
  providerId: string;
  operation: string;
  status: ProviderJobStatus;
  recordsRead: number;
  recordsWritten: number;
  message: string;
};

export type ProviderWorkerTickResult = {
  workerId: string;
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  recovered: number;
  results: ProviderWorkerExecutionResult[];
};

export function claimProviderJobRuns(state: AppState, options: ProviderWorkerClaimOptions): ProviderJobRun[] {
  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const maxRuns = options.maxRuns ?? defaultBatchSize;
  const leaseMs = options.leaseMs ?? defaultLeaseMs;
  const candidates = state.providerJobRuns
    .filter((run) => runIsClaimable(run, nowMs, options.workspaceId))
    .sort((a, b) => {
      const jobA = providerJobForRun(state, a);
      const jobB = providerJobForRun(state, b);
      return jobA.priority - jobB.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt);
    })
    .slice(0, maxRuns);

  for (const run of candidates) {
    const job = providerJobForRun(state, run);
    run.status = "Running";
    run.startedAt = run.startedAt ?? now;
    run.lockedBy = options.workerId;
    run.lockedAt = now;
    run.lockExpiresAt = new Date(nowMs + leaseMs).toISOString();
    run.updatedAt = now;
    job.status = "Running";
    job.startedAt = job.startedAt ?? now;
    job.updatedAt = now;
  }

  return candidates;
}

export function recoverExpiredProviderJobRunLocks(
  state: AppState,
  options: { workerId?: string; workspaceId?: string; now?: string } = {}
) {
  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  let recovered = 0;

  for (const run of state.providerJobRuns) {
    if (options.workspaceId && run.workspaceId !== options.workspaceId) continue;
    if (run.status !== "Running" || !run.lockExpiresAt || Date.parse(run.lockExpiresAt) > nowMs) continue;

    const job = providerJobForRun(state, run);
    run.status = "Queued";
    run.lockedBy = undefined;
    run.lockedAt = undefined;
    run.lockExpiresAt = undefined;
    run.updatedAt = now;
    job.status = "Queued";
    job.updatedAt = now;
    recovered += 1;
  }

  return recovered;
}

export function queueDueProviderRetries(
  state: AppState,
  options: { workspaceId?: string; now?: string } = {}
) {
  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  let retried = 0;

  const dueJobs = state.providerJobs.filter((job) => {
    if (options.workspaceId && job.workspaceId !== options.workspaceId) return false;
    if (job.status !== "Retry scheduled" || !job.nextRetryAt) return false;
    return Date.parse(job.nextRetryAt) <= nowMs;
  });

  for (const job of dueJobs) {
    retryProviderJobRun(state, job.id);
    retried += 1;
  }

  return retried;
}

export function executeMockProviderJobRun(
  state: AppState,
  runId: string,
  options: { workerId: string; now?: string } = { workerId: "syncore-local-worker" }
): ProviderWorkerExecutionResult {
  const run = providerRunById(state, runId);
  const job = providerJobForRun(state, run);
  if (run.status !== "Running") {
    throw new Error("Provider job run must be claimed before execution.");
  }
  if (run.lockedBy !== options.workerId) {
    throw new Error("Provider job run is locked by a different worker.");
  }

  const outcome = mockOutcomeFor(job, run, options.now ?? new Date().toISOString());
  if (outcome.status === "Failed") {
    failProviderJobRun(state, {
      runId,
      errorMessage: outcome.message,
      nextRetryAt: outcome.nextRetryAt
    });
    return {
      runId,
      providerJobId: job.id,
      providerId: run.providerId,
      operation: run.operation,
      status: outcome.nextRetryAt ? "Retry scheduled" : "Failed",
      recordsRead: 0,
      recordsWritten: 0,
      message: outcome.message
    };
  }

  completeProviderJobRun(state, {
    runId,
    recordsRead: outcome.recordsRead,
    recordsWritten: outcome.recordsWritten,
    costCents: outcome.costCents,
    responseSummary: {
      executionMode: "mock",
      provider: providerConfig(run.providerId).name,
      operation: run.operation,
      message: outcome.message
    },
    rawResponseRef: `mock-provider-response://${run.providerId}/${run.id}`,
    providerRunId: `mock-${run.providerId}-${run.attempt}`,
    completedAt: options.now
  });

  return {
    runId,
    providerJobId: job.id,
    providerId: run.providerId,
    operation: run.operation,
    status: "Completed",
    recordsRead: outcome.recordsRead,
    recordsWritten: outcome.recordsWritten,
    message: outcome.message
  };
}

export function processProviderJobQueue(
  state: AppState,
  options: ProviderWorkerClaimOptions
): ProviderWorkerTickResult {
  const recovered = recoverExpiredProviderJobRunLocks(state, options);
  const retried = queueDueProviderRetries(state, options);
  const claimedRuns = claimProviderJobRuns(state, options);
  const results: ProviderWorkerExecutionResult[] = [];
  let completed = 0;
  let failed = 0;

  for (const run of claimedRuns) {
    const result = executeMockProviderJobRun(state, run.id, {
      workerId: options.workerId,
      now: options.now
    });
    results.push(result);
    if (result.status === "Completed") completed += 1;
    if (result.status === "Failed" || result.status === "Retry scheduled") failed += 1;
  }

  return {
    workerId: options.workerId,
    claimed: claimedRuns.length,
    completed,
    failed,
    retried,
    recovered,
    results
  };
}

function runIsClaimable(run: ProviderJobRun, nowMs: number, workspaceId?: string) {
  if (workspaceId && run.workspaceId !== workspaceId) return false;
  if (run.status === "Queued") return true;
  if (run.status === "Running" && run.lockExpiresAt && Date.parse(run.lockExpiresAt) <= nowMs) return true;
  return false;
}

function mockOutcomeFor(job: ProviderJob, run: ProviderJobRun, now: string) {
  if (job.inputSummary.forceMockFailure === true) {
    const nextRetryAt = run.attempt < run.maxAttempts
      ? new Date(Date.parse(now) + 60_000).toISOString()
      : undefined;
    return {
      status: "Failed" as const,
      recordsRead: 0,
      recordsWritten: 0,
      costCents: 0,
      message: "Forced mock provider failure.",
      nextRetryAt
    };
  }

  const recordsWrittenByOperation: Record<string, number> = {
    discover_companies: 3,
    discover_contacts: 5,
    find_email: 1,
    verify_email: 1,
    find_phone: 1,
    verify_phone: 1,
    enrich_company: 1,
    enrich_contact: 1,
    send_campaign: 1,
    process_webhook: 1,
    send_transactional_email: 1
  };
  const recordsWritten = recordsWrittenByOperation[run.operation] ?? 0;

  return {
    status: "Completed" as const,
    recordsRead: 1,
    recordsWritten,
    costCents: 0,
    message: "Mock provider worker completed without network access."
  };
}

function providerJobForRun(state: AppState, run: ProviderJobRun) {
  const job = state.providerJobs.find((item) => item.id === run.providerJobId);
  if (!job) {
    throw new Error("Provider job not found for run.");
  }
  return job;
}

function providerRunById(state: AppState, runId: string) {
  const run = state.providerJobRuns.find((item) => item.id === runId);
  if (!run) {
    throw new Error("Provider job run not found.");
  }
  return run;
}
