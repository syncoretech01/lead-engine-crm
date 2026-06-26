import { createHash, randomUUID } from "node:crypto";
import type {
  AppState,
  AsyncJobRun,
  JobIdempotencyRecord,
  JobLog,
  JobLogLevel,
  JobRunStatus,
  JobStatus,
  LeadJob
} from "@/lib/phase1/types";

const defaultMaxAttempts = 3;

type CreateTrackedJobInput = {
  state: AppState;
  job: LeadJob;
  sources: string[];
  idempotencyKey?: string;
  idempotencyScope?: JobIdempotencyRecord["scope"];
  requestHash?: string;
  startImmediately?: boolean;
  checkpoint?: AsyncJobRun["checkpoint"];
  logMessage?: string;
};

export type IdempotencyReservation =
  | { replayed: true; record: JobIdempotencyRecord }
  | { replayed: false; record: JobIdempotencyRecord };

export function createTrackedJob(input: CreateTrackedJobInput) {
  const now = new Date().toISOString();
  const sources = input.sources.length ? input.sources : input.job.sources;
  const runStatus: JobRunStatus = input.startImmediately ? "Running" : "Queued";

  input.state.leadJobs.unshift(input.job);

  const runs = sources.map((source) =>
    createRun({
      workspaceId: input.job.workspaceId,
      leadJobId: input.job.id,
      source,
      status: runStatus,
      attempt: 1,
      idempotencyKey: input.idempotencyKey ?? leadJobIdempotencyKey(input.job.workspaceId, input.job.id, source),
      checkpoint: input.checkpoint,
      now
    })
  );

  input.state.asyncJobRuns.unshift(...runs);

  if (input.idempotencyKey && input.requestHash) {
    upsertIdempotencyRecord(input.state, {
      workspaceId: input.job.workspaceId,
      key: input.idempotencyKey,
      scope: input.idempotencyScope ?? "lead_job",
      requestHash: input.requestHash,
      leadJobId: input.job.id,
      status: "Reserved",
      recordIds: []
    });
  }

  appendJobLog(input.state, {
    workspaceId: input.job.workspaceId,
    leadJobId: input.job.id,
    runId: runs[0]?.id,
    level: "Info",
    message: input.logMessage ?? "Job queued",
    metadata: {
      sources: sources.join(", "),
      runCount: runs.length,
      status: input.job.status
    }
  });

  return { job: input.job, runs };
}

export function reserveJobIdempotency(
  state: AppState,
  input: {
    workspaceId: string;
    key: string;
    scope: JobIdempotencyRecord["scope"];
    requestHash: string;
    leadJobId: string;
  }
): IdempotencyReservation {
  const existing = state.jobIdempotencyRecords.find(
    (record) => record.workspaceId === input.workspaceId && record.key === input.key
  );

  if (existing) {
    existing.updatedAt = new Date().toISOString();
    return { replayed: true, record: existing };
  }

  const record = upsertIdempotencyRecord(state, {
    workspaceId: input.workspaceId,
    key: input.key,
    scope: input.scope,
    requestHash: input.requestHash,
    leadJobId: input.leadJobId,
    status: "Reserved",
    recordIds: []
  });

  return { replayed: false, record };
}

export function completeJobRun(
  state: AppState,
  input: {
    runId: string;
    recordsRead: number;
    recordsWritten: number;
    creditUsage?: number;
    checkpoint?: AsyncJobRun["checkpoint"];
    message?: string;
  }
) {
  const run = state.asyncJobRuns.find((item) => item.id === input.runId);
  if (!run) {
    throw new Error("Job run not found.");
  }

  const now = new Date().toISOString();
  run.status = "Completed";
  run.recordsRead = input.recordsRead;
  run.recordsWritten = input.recordsWritten;
  run.creditUsage = input.creditUsage ?? run.creditUsage;
  run.checkpoint = input.checkpoint ?? run.checkpoint;
  run.completedAt = now;
  run.updatedAt = now;

  appendJobLog(state, {
    workspaceId: run.workspaceId,
    leadJobId: run.leadJobId,
    runId: run.id,
    level: "Info",
    message: input.message ?? "Run completed",
    metadata: {
      recordsRead: input.recordsRead,
      recordsWritten: input.recordsWritten,
      attempt: run.attempt
    }
  });

  refreshJobFromRuns(state, run.workspaceId, run.leadJobId);
  return run;
}

export function failJobRun(
  state: AppState,
  input: {
    runId: string;
    errorMessage: string;
    nextRetryAt?: string;
  }
) {
  const run = state.asyncJobRuns.find((item) => item.id === input.runId);
  if (!run) {
    throw new Error("Job run not found.");
  }

  const now = new Date().toISOString();
  run.status = input.nextRetryAt && run.attempt < run.maxAttempts ? "Retry scheduled" : "Failed";
  run.errorMessage = input.errorMessage;
  run.nextRetryAt = input.nextRetryAt;
  run.completedAt = run.status === "Failed" ? now : undefined;
  run.updatedAt = now;

  appendJobLog(state, {
    workspaceId: run.workspaceId,
    leadJobId: run.leadJobId,
    runId: run.id,
    level: "Error",
    message: input.errorMessage,
    metadata: {
      attempt: run.attempt,
      nextRetryAt: input.nextRetryAt
    }
  });

  refreshJobFromRuns(state, run.workspaceId, run.leadJobId);
  return run;
}

export function retryFailedJob(state: AppState, workspaceId: string, leadJobId: string) {
  const job = state.leadJobs.find((item) => item.id === leadJobId && item.workspaceId === workspaceId);
  if (!job) {
    throw new Error("Lead job not found.");
  }

  const retryableRuns = state.asyncJobRuns
    .filter(
      (run) =>
        run.workspaceId === workspaceId &&
        run.leadJobId === leadJobId &&
        (run.status === "Failed" || run.status === "Retry scheduled")
    )
    .sort((a, b) => b.attempt - a.attempt);

  if (retryableRuns.length === 0) {
    throw new Error("No failed job run is available to retry.");
  }

  const previous = retryableRuns[0];
  if (previous.attempt >= previous.maxAttempts) {
    throw new Error("Maximum retry attempts reached.");
  }

  const now = new Date().toISOString();
  const retry = createRun({
    workspaceId,
    leadJobId,
    source: previous.source,
    status: "Queued",
    attempt: previous.attempt + 1,
    maxAttempts: previous.maxAttempts,
    idempotencyKey: previous.idempotencyKey,
    now,
    checkpoint: previous.checkpoint
  });

  state.asyncJobRuns.unshift(retry);
  job.status = "Queued";
  job.progress = Math.max(job.progress, 5);
  job.eta = `Retry attempt ${retry.attempt} queued`;
  job.errorSummary = `Recovering ${previous.source}: ${previous.errorMessage ?? "previous run failed"}`;
  job.updatedAt = now;

  appendJobLog(state, {
    workspaceId,
    leadJobId,
    runId: retry.id,
    level: "Info",
    message: `Retry attempt ${retry.attempt} queued for ${previous.source}`,
    metadata: {
      previousRunId: previous.id,
      providerRunId: retry.providerRunId,
      idempotencyKey: retry.idempotencyKey
    }
  });

  return retry;
}

export function markIdempotencyCompleted(
  state: AppState,
  workspaceId: string,
  key: string,
  leadJobId: string,
  recordIds: string[]
) {
  const now = new Date().toISOString();
  const record = state.jobIdempotencyRecords.find((item) => item.workspaceId === workspaceId && item.key === key);

  if (record) {
    record.status = "Completed";
    record.leadJobId = leadJobId;
    record.recordIds = unique([...record.recordIds, ...recordIds]);
    record.updatedAt = now;
  }
}

export function markIdempotencyFailed(
  state: AppState,
  workspaceId: string,
  key: string,
  leadJobId: string
) {
  const now = new Date().toISOString();
  const record = state.jobIdempotencyRecords.find((item) => item.workspaceId === workspaceId && item.key === key);

  if (record) {
    record.status = "Failed";
    record.leadJobId = leadJobId;
    record.updatedAt = now;
  }
}

export function appendJobLog(
  state: AppState,
  input: {
    workspaceId: string;
    leadJobId: string;
    runId?: string;
    level: JobLogLevel;
    message: string;
    metadata?: JobLog["metadata"];
  }
) {
  const log: JobLog = {
    id: `job-log-${randomUUID()}`,
    workspaceId: input.workspaceId,
    leadJobId: input.leadJobId,
    runId: input.runId,
    level: input.level,
    message: input.message,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };

  state.jobLogs.unshift(log);
  return log;
}

export function ensureJobObservabilityDefaults(state: AppState, workspaceId: string) {
  let changed = false;

  for (const job of state.leadJobs.filter((item) => item.workspaceId === workspaceId)) {
    const hasRuns = state.asyncJobRuns.some((run) => run.leadJobId === job.id && run.workspaceId === workspaceId);
    if (!hasRuns) {
      const status = runStatusForJob(job.status);
      const now = job.createdAt;
      const runs = job.sources.map((source) =>
        createRun({
          workspaceId,
          leadJobId: job.id,
          source,
          status,
          attempt: 1,
          idempotencyKey: leadJobIdempotencyKey(workspaceId, job.id, source),
          now,
          recordsRead: source === "CSV Upload" ? job.raw : 0,
          recordsWritten: source === "CSV Upload" ? job.normalized : 0
        })
      );
      state.asyncJobRuns.push(...runs);
      changed = true;
    }

    const hasLogs = state.jobLogs.some((log) => log.leadJobId === job.id && log.workspaceId === workspaceId);
    if (!hasLogs) {
      state.jobLogs.push({
        id: `job-log-${randomUUID()}`,
        workspaceId,
        leadJobId: job.id,
        level: job.status === "Failed" ? "Error" : "Info",
        message: job.errorSummary || `Legacy ${job.status.toLowerCase()} job imported into async observability`,
        metadata: {
          status: job.status,
          progress: job.progress,
          sources: job.sources.join(", ")
        },
        createdAt: job.updatedAt
      });
      changed = true;
    }
  }

  return { changed };
}

export function csvImportRequestHash(input: {
  csvText: string;
  source: string;
  mapping: unknown;
  workspaceId: string;
}) {
  return sha256(JSON.stringify(input));
}

export function csvImportIdempotencyKey(workspaceId: string, requestHash: string) {
  return `csv-import:${workspaceId}:${requestHash.slice(0, 24)}`;
}

export function jobObservabilitySnapshot(state: AppState, workspaceId: string, leadJobId: string) {
  const runs = state.asyncJobRuns
    .filter((run) => run.workspaceId === workspaceId && run.leadJobId === leadJobId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const logs = state.jobLogs
    .filter((log) => log.workspaceId === workspaceId && log.leadJobId === leadJobId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const idempotencyRecords = state.jobIdempotencyRecords.filter(
    (record) => record.workspaceId === workspaceId && record.leadJobId === leadJobId
  );
  const hasActiveRun = runs.some((run) => run.status === "Queued" || run.status === "Running");

  return {
    runs,
    logs,
    idempotencyRecords,
    attempts: runs.length,
    failedRuns: runs.filter((run) => run.status === "Failed" || run.status === "Retry scheduled").length,
    latestRun: runs[0],
    latestLog: logs[0],
    canRetry:
      !hasActiveRun &&
      runs.some((run) => (run.status === "Failed" || run.status === "Retry scheduled") && run.attempt < run.maxAttempts)
  };
}

function createRun(input: {
  workspaceId: string;
  leadJobId: string;
  source: string;
  status: JobRunStatus;
  attempt: number;
  idempotencyKey: string;
  now: string;
  maxAttempts?: number;
  checkpoint?: AsyncJobRun["checkpoint"];
  recordsRead?: number;
  recordsWritten?: number;
}) {
  const run: AsyncJobRun = {
    id: `job-run-${randomUUID()}`,
    workspaceId: input.workspaceId,
    leadJobId: input.leadJobId,
    source: input.source,
    status: input.status,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
    providerRunId: `provider-${slug(input.source)}-${randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
    checkpoint: input.checkpoint,
    creditUsage: 0,
    recordsRead: input.recordsRead ?? 0,
    recordsWritten: input.recordsWritten ?? 0,
    startedAt: input.status === "Running" || input.status === "Completed" || input.status === "Failed" ? input.now : undefined,
    completedAt: input.status === "Completed" || input.status === "Failed" ? input.now : undefined,
    createdAt: input.now,
    updatedAt: input.now
  };

  return run;
}

function upsertIdempotencyRecord(
  state: AppState,
  input: Omit<JobIdempotencyRecord, "id" | "createdAt" | "updatedAt">
) {
  const now = new Date().toISOString();
  const existing = state.jobIdempotencyRecords.find(
    (record) => record.workspaceId === input.workspaceId && record.key === input.key
  );

  if (existing) {
    existing.status = input.status;
    existing.leadJobId = input.leadJobId;
    existing.requestHash = input.requestHash;
    existing.recordIds = input.recordIds;
    existing.updatedAt = now;
    return existing;
  }

  const record: JobIdempotencyRecord = {
    id: `job-idem-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    ...input
  };

  state.jobIdempotencyRecords.unshift(record);
  return record;
}

function refreshJobFromRuns(state: AppState, workspaceId: string, leadJobId: string) {
  const job = state.leadJobs.find((item) => item.workspaceId === workspaceId && item.id === leadJobId);
  if (!job) return;

  const runs = state.asyncJobRuns.filter((run) => run.workspaceId === workspaceId && run.leadJobId === leadJobId);
  const now = new Date().toISOString();

  if (runs.length && runs.every((run) => run.status === "Completed" || run.status === "Skipped")) {
    job.status = "Completed";
    job.progress = 100;
    job.completedAt = now;
    job.eta = "Complete";
    job.errorSummary = "No open failures";
  } else if (runs.some((run) => run.status === "Failed")) {
    job.status = "Failed";
    job.errorSummary = runs.find((run) => run.status === "Failed")?.errorMessage ?? "Run failed";
  } else if (runs.some((run) => run.status === "Retry scheduled")) {
    job.status = "Paused";
    job.errorSummary = "Retry scheduled";
  } else if (runs.some((run) => run.status === "Running")) {
    job.status = "Running";
  }

  job.updatedAt = now;
}

function leadJobIdempotencyKey(workspaceId: string, jobId: string, source: string) {
  return `lead-job:${workspaceId}:${jobId}:${slug(source)}`;
}

function runStatusForJob(status: JobStatus): JobRunStatus {
  if (status === "Completed") return "Completed";
  if (status === "Failed") return "Failed";
  if (status === "Running") return "Running";
  if (status === "Paused") return "Retry scheduled";
  return "Queued";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
