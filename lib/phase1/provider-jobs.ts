import { createHash, randomUUID } from "node:crypto";
import { assertPermission } from "@/lib/phase1/auth";
import {
  providerLedgerJobId,
  recordProviderUsage,
  syncLeadJobActualCostsFromLedger,
  unitCostFromTotal
} from "@/lib/phase1/money";
import type {
  AppState,
  ProviderConnection,
  ProviderJob,
  ProviderJobOperation,
  ProviderJobRun,
  ProviderJobStatus,
  Session
} from "@/lib/phase1/types";
import { providerConfig } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/providers/types";

const defaultMaxAttempts = 3;

export type CreateProviderJobInput = {
  providerId: ProviderId;
  operation: ProviderJobOperation;
  inputSummary?: Record<string, unknown>;
  sourceObjectType?: string;
  sourceObjectId?: string;
  priority?: number;
  idempotencyKey?: string;
  requestHash?: string;
  maxAttempts?: number;
  startImmediately?: boolean;
};

export type CompleteProviderJobRunInput = {
  runId: string;
  recordsRead?: number;
  recordsWritten?: number;
  costCents?: number;
  checkpoint?: ProviderJobRun["checkpoint"];
  responseSummary?: Record<string, unknown>;
  rawResponseRef?: string;
  providerRunId?: string;
  completedAt?: string;
};

export type FailProviderJobRunInput = {
  runId: string;
  errorMessage: string;
  nextRetryAt?: string;
  checkpoint?: ProviderJobRun["checkpoint"];
};

export function createProviderJob(
  state: AppState,
  session: Session,
  input: CreateProviderJobInput
): { job: ProviderJob; run: ProviderJobRun; replayed: boolean } {
  assertPermission(session, "manage_workspace");
  const provider = providerConfig(input.providerId);
  if (!provider.capabilities.includes(input.operation)) {
    throw new Error(`Provider ${provider.name} does not support operation ${input.operation}.`);
  }

  const connection = activeProviderConnection(state, session.workspace.id, input.providerId, input.operation);
  const requestHash = input.requestHash ?? providerJobRequestHash({
    workspaceId: session.workspace.id,
    providerId: input.providerId,
    operation: input.operation,
    inputSummary: input.inputSummary ?? {},
    sourceObjectType: input.sourceObjectType,
    sourceObjectId: input.sourceObjectId
  });
  const idempotencyKey = input.idempotencyKey ?? providerJobIdempotencyKey({
    workspaceId: session.workspace.id,
    providerId: input.providerId,
    operation: input.operation,
    requestHash
  });
  const existing = state.providerJobs.find(
    (job) => job.workspaceId === session.workspace.id && job.idempotencyKey === idempotencyKey
  );

  if (existing) {
    const latestRun = latestProviderJobRun(state, existing.id);
    if (!latestRun) {
      const replayRun = createProviderJobRunRecord(existing, {
        status: "Queued",
        attempt: 1,
        now: new Date().toISOString()
      });
      state.providerJobRuns.unshift(replayRun);
      return { job: existing, run: replayRun, replayed: true };
    }
    return { job: existing, run: latestRun, replayed: true };
  }

  const now = new Date().toISOString();
  const status: ProviderJobStatus = input.startImmediately ? "Running" : "Queued";
  const job: ProviderJob = {
    id: `provider-job-${randomUUID()}`,
    workspaceId: session.workspace.id,
    providerConnectionId: connection.id,
    providerId: input.providerId,
    operation: input.operation,
    status,
    priority: input.priority ?? 5,
    idempotencyKey,
    requestHash,
    sourceObjectType: input.sourceObjectType,
    sourceObjectId: input.sourceObjectId,
    inputSummary: redactInputSummary(input.inputSummary ?? {}),
    recordsRead: 0,
    recordsWritten: 0,
    costCents: 0,
    maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
    queuedAt: now,
    startedAt: status === "Running" ? now : undefined,
    createdById: session.user.id,
    createdAt: now,
    updatedAt: now
  };
  const run = createProviderJobRunRecord(job, {
    status,
    attempt: 1,
    now,
    requestSummary: job.inputSummary
  });

  state.providerJobs.unshift(job);
  state.providerJobRuns.unshift(run);
  return { job, run, replayed: false };
}

export function startProviderJobRun(state: AppState, runId: string) {
  const run = providerRunById(state, runId);
  const job = providerJobById(state, run.providerJobId);
  const now = new Date().toISOString();

  run.status = "Running";
  run.startedAt = run.startedAt ?? now;
  run.updatedAt = now;
  job.status = "Running";
  job.startedAt = job.startedAt ?? now;
  job.updatedAt = now;
  return run;
}

export function completeProviderJobRun(state: AppState, input: CompleteProviderJobRunInput) {
  const run = providerRunById(state, input.runId);
  const job = providerJobById(state, run.providerJobId);
  const completedAt = input.completedAt ?? new Date().toISOString();

  run.status = "Completed";
  run.recordsRead = input.recordsRead ?? run.recordsRead;
  run.recordsWritten = input.recordsWritten ?? run.recordsWritten;
  run.costCents = input.costCents ?? run.costCents;
  run.checkpoint = input.checkpoint ?? run.checkpoint;
  run.responseSummary = input.responseSummary ? redactInputSummary(input.responseSummary) : run.responseSummary;
  run.rawResponseRef = input.rawResponseRef ?? run.rawResponseRef;
  run.providerRunId = input.providerRunId ?? run.providerRunId;
  run.completedAt = completedAt;
  run.durationMs = run.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(run.startedAt)) : run.durationMs;
  run.lockedBy = undefined;
  run.lockedAt = undefined;
  run.lockExpiresAt = undefined;
  run.updatedAt = completedAt;

  job.status = "Completed";
  job.recordsRead = run.recordsRead;
  job.recordsWritten = run.recordsWritten;
  job.costCents = run.costCents;
  job.resultSummary = run.responseSummary;
  job.errorMessage = undefined;
  job.completedAt = completedAt;
  job.updatedAt = completedAt;
  recordProviderUsage(state, {
    workspaceId: run.workspaceId,
    provider: run.providerId,
    operation: run.operation,
    jobId: providerLedgerJobId(job),
    providerJobId: job.id,
    providerJobRunId: run.id,
    unitsUsed: run.recordsWritten || run.recordsRead || 1,
    unitCostCents: unitCostFromTotal(run.costCents, run.recordsWritten || run.recordsRead || 1),
    totalCostCents: run.costCents,
    amountKind: "Actual",
    rawProviderMetadata: {
      providerRunId: run.providerRunId,
      rawResponseRef: run.rawResponseRef,
      recordsRead: run.recordsRead,
      recordsWritten: run.recordsWritten,
      moneySource: "Actual"
    },
    createdAt: completedAt
  });
  syncLeadJobActualCostsFromLedger(state, run.workspaceId);
  return run;
}

export function failProviderJobRun(state: AppState, input: FailProviderJobRunInput) {
  const run = providerRunById(state, input.runId);
  const job = providerJobById(state, run.providerJobId);
  const now = new Date().toISOString();
  const retryable = Boolean(input.nextRetryAt) && run.attempt < run.maxAttempts;

  run.status = retryable ? "Retry scheduled" : "Failed";
  run.errorMessage = input.errorMessage;
  run.checkpoint = input.checkpoint ?? run.checkpoint;
  run.nextRetryAt = input.nextRetryAt;
  run.completedAt = retryable ? undefined : now;
  run.lockedBy = undefined;
  run.lockedAt = undefined;
  run.lockExpiresAt = undefined;
  run.updatedAt = now;

  job.status = run.status;
  job.errorMessage = input.errorMessage;
  job.nextRetryAt = input.nextRetryAt;
  job.completedAt = run.status === "Failed" ? now : undefined;
  job.updatedAt = now;
  return run;
}

export function retryProviderJobRun(state: AppState, providerJobId: string) {
  const job = providerJobById(state, providerJobId);
  const previous = latestProviderJobRun(state, providerJobId);
  if (!previous) {
    throw new Error("Provider job has no run to retry.");
  }
  if (previous.attempt >= previous.maxAttempts) {
    throw new Error("Maximum provider retry attempts reached.");
  }
  if (previous.status !== "Failed" && previous.status !== "Retry scheduled") {
    throw new Error("Provider job run is not retryable.");
  }

  const now = new Date().toISOString();
  const retry = createProviderJobRunRecord(job, {
    status: "Queued",
    attempt: previous.attempt + 1,
    now,
    checkpoint: previous.checkpoint,
    requestSummary: previous.requestSummary
  });

  job.status = "Queued";
  job.errorMessage = previous.errorMessage;
  job.nextRetryAt = undefined;
  job.updatedAt = now;
  state.providerJobRuns.unshift(retry);
  return retry;
}

export function providerJobSnapshot(state: AppState, workspaceId: string, providerJobId: string) {
  const job = state.providerJobs.find((item) => item.workspaceId === workspaceId && item.id === providerJobId);
  const runs = state.providerJobRuns
    .filter((run) => run.workspaceId === workspaceId && run.providerJobId === providerJobId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const hasActiveRun = runs.some((run) => run.status === "Queued" || run.status === "Running");

  return {
    job,
    runs,
    latestRun: runs[0],
    attempts: runs.length,
    failedRuns: runs.filter((run) => run.status === "Failed" || run.status === "Retry scheduled").length,
    canRetry:
      !hasActiveRun &&
      runs.some((run) => (run.status === "Failed" || run.status === "Retry scheduled") && run.attempt < run.maxAttempts)
  };
}

export function providerJobRequestHash(input: {
  workspaceId: string;
  providerId: ProviderId;
  operation: ProviderJobOperation;
  inputSummary: Record<string, unknown>;
  sourceObjectType?: string;
  sourceObjectId?: string;
}) {
  return sha256(stableStringify(input));
}

export function providerJobIdempotencyKey(input: {
  workspaceId: string;
  providerId: ProviderId;
  operation: ProviderJobOperation;
  requestHash: string;
}) {
  return `provider-job:${input.workspaceId}:${input.providerId}:${input.operation}:${input.requestHash.slice(0, 24)}`;
}

function activeProviderConnection(
  state: AppState,
  workspaceId: string,
  providerId: ProviderId,
  operation: ProviderJobOperation
): ProviderConnection {
  const connection = state.providerConnections.find(
    (item) => item.workspaceId === workspaceId && item.providerId === providerId
  );
  if (!connection) {
    throw new Error(`Provider connection is not configured for ${providerId}.`);
  }
  if (!connection.enabled) {
    throw new Error(`Provider connection is disabled for ${connection.displayName}.`);
  }
  if (!connection.allowedOperations.includes(operation)) {
    throw new Error(`Provider connection does not allow operation ${operation}.`);
  }
  return connection;
}

function createProviderJobRunRecord(
  job: ProviderJob,
  input: {
    status: ProviderJobStatus;
    attempt: number;
    now: string;
    checkpoint?: ProviderJobRun["checkpoint"];
    requestSummary?: Record<string, unknown>;
  }
): ProviderJobRun {
  return {
    id: `provider-job-run-${randomUUID()}`,
    workspaceId: job.workspaceId,
    providerJobId: job.id,
    providerConnectionId: job.providerConnectionId,
    providerId: job.providerId,
    operation: job.operation,
    status: input.status,
    attempt: input.attempt,
    maxAttempts: job.maxAttempts,
    idempotencyKey: job.idempotencyKey,
    providerRequestId: `provider-request-${randomUUID()}`,
    checkpoint: input.checkpoint,
    requestSummary: input.requestSummary,
    recordsRead: 0,
    recordsWritten: 0,
    costCents: 0,
    lockedBy: undefined,
    lockedAt: undefined,
    lockExpiresAt: undefined,
    startedAt: input.status === "Running" ? input.now : undefined,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function providerJobById(state: AppState, providerJobId: string) {
  const job = state.providerJobs.find((item) => item.id === providerJobId);
  if (!job) {
    throw new Error("Provider job not found.");
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

function latestProviderJobRun(state: AppState, providerJobId: string) {
  return state.providerJobRuns
    .filter((run) => run.providerJobId === providerJobId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

function redactInputSummary(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      /api[_-]?key|secret|token|password|authorization/i.test(key) ? "[redacted]" : value
    ])
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}
