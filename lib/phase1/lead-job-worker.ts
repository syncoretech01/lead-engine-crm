import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import {
  appendJobLog,
  completeJobRun,
  failJobRun,
  markIdempotencyCompleted,
  markIdempotencyFailed
} from "@/lib/phase1/jobs";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { appendWorkspaceAudit, systemActorForWorkspace } from "@/lib/phase1/tenant-isolation";
import { runWorkspaceVerification } from "@/lib/phase1/verification";
import type { AppState, AsyncJobRun, CsvImportMapping, JobRunStatus, LeadJob } from "@/lib/phase1/types";

const defaultMaxRuns = 1;
const retryDelayMs = 60_000;

export type LeadJobWorkerOptions = {
  workerId?: string;
  workspaceId?: string;
  maxRuns?: number;
  now?: string;
};

export type LeadJobWorkerRunResult = {
  runId: string;
  leadJobId: string;
  source: string;
  status: JobRunStatus;
  recordsRead: number;
  recordsWritten: number;
  message: string;
};

export type LeadJobWorkerTickResult = {
  workerId: string;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  results: LeadJobWorkerRunResult[];
};

export function processLeadJobQueue(state: AppState, options: LeadJobWorkerOptions = {}): LeadJobWorkerTickResult {
  const now = options.now ?? new Date().toISOString();
  const workerId = options.workerId ?? "syncore-lead-job-worker";
  const dueRuns = claimCsvImportRuns(state, {
    workerId,
    workspaceId: options.workspaceId,
    maxRuns: options.maxRuns ?? defaultMaxRuns,
    now
  });
  const results = dueRuns.map((run) => processCsvImportRun(state, run, { workerId, now }));

  return {
    workerId,
    claimed: dueRuns.length,
    completed: results.filter((result) => result.status === "Completed").length,
    failed: results.filter((result) => result.status === "Failed" || result.status === "Retry scheduled").length,
    skipped: results.filter((result) => result.status === "Skipped").length,
    results
  };
}

function claimCsvImportRuns(
  state: AppState,
  input: { workerId: string; workspaceId?: string; maxRuns: number; now: string }
) {
  const nowMs = Date.parse(input.now);
  const candidates = state.asyncJobRuns
    .filter((run) => isDueCsvImportRun(run, nowMs, input.workspaceId))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, Math.max(0, input.maxRuns));

  for (const run of candidates) {
    const job = leadJobForRun(state, run);
    if (run.status === "Retry scheduled") {
      run.attempt += 1;
    }
    run.status = "Running";
    run.startedAt ||= input.now;
    run.completedAt = undefined;
    run.nextRetryAt = undefined;
    run.errorMessage = undefined;
    run.updatedAt = input.now;
    job.status = "Running";
    job.startedAt ||= input.now;
    job.progress = Math.max(job.progress, 35);
    job.eta = "Background worker processing";
    job.errorSummary = "Processing CSV rows";
    job.updatedAt = input.now;

    appendJobLog(state, {
      workspaceId: run.workspaceId,
      leadJobId: run.leadJobId,
      runId: run.id,
      level: "Info",
      message: "Lead job worker claimed CSV import run",
      metadata: {
        workerId: input.workerId,
        source: run.source,
        attempt: run.attempt
      }
    });
  }

  return candidates;
}

function processCsvImportRun(
  state: AppState,
  run: AsyncJobRun,
  input: { workerId: string; now: string }
): LeadJobWorkerRunResult {
  const job = leadJobForRun(state, run);
  const checkpoint = checkpointRecord(run);
  const rawLeads = state.rawLeads.filter(
    (lead) => lead.workspaceId === run.workspaceId && lead.leadJobId === run.leadJobId
  );

  try {
    if (rawLeads.length === 0) {
      throw new Error("CSV import run has no raw rows to process.");
    }

    const counts = normalizeImportedRows({
      state,
      workspaceId: run.workspaceId,
      leadJob: job,
      rawLeads,
      mapping: csvMappingFromCheckpoint(checkpoint.mapping)
    });
    const verification = runWorkspaceVerification(state, run.workspaceId);
    const dedupe = detectWorkspaceDuplicates(state, run.workspaceId);
    const enrichment = runWorkspaceEnrichment(state, run.workspaceId, {
      budgetCents: job.enrichmentBudgetCents,
      highValueOnly: job.highValueOnlyEnrichment
    });

    completeJobRun(state, {
      runId: run.id,
      recordsRead: rawLeads.length,
      recordsWritten: counts.normalized,
      checkpoint: {
        ...checkpoint,
        stage: "completed",
        rows: rawLeads.length,
        normalized: counts.normalized,
        duplicates: counts.duplicates,
        suppressed: counts.suppressed,
        verified: verification.verified,
        enrichedCompanies: enrichment.enrichedCompanies,
        enrichedContacts: enrichment.enrichedContacts,
        openDuplicates: dedupe.open,
        completedAt: input.now
      },
      message: "CSV import normalized, verified, deduped, and enriched by worker"
    });
    markIdempotencyCompleted(
      state,
      run.workspaceId,
      run.idempotencyKey,
      run.leadJobId,
      rawLeads.map((lead) => lead.id)
    );
    appendWorkerAudit(state, run.workspaceId, {
      objectId: run.leadJobId,
      action: "csv_import_background_completed",
      newValue: {
        workerId: input.workerId,
        runId: run.id,
        counts,
        verification,
        dedupe,
        enrichment
      }
    });

    return {
      runId: run.id,
      leadJobId: run.leadJobId,
      source: run.source,
      status: "Completed",
      recordsRead: rawLeads.length,
      recordsWritten: counts.normalized,
      message: "CSV import processed"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryAt =
      run.attempt < run.maxAttempts ? new Date(Date.parse(input.now) + retryDelayMs).toISOString() : undefined;
    const failedRun = failJobRun(state, {
      runId: run.id,
      errorMessage: message,
      nextRetryAt: retryAt
    });

    if (failedRun.status === "Failed") {
      markIdempotencyFailed(state, run.workspaceId, run.idempotencyKey, run.leadJobId);
    }
    appendWorkerAudit(state, run.workspaceId, {
      objectId: run.leadJobId,
      action: "csv_import_background_failed",
      newValue: {
        workerId: input.workerId,
        runId: run.id,
        attempt: run.attempt,
        nextRetryAt: retryAt,
        error: message
      }
    });

    return {
      runId: run.id,
      leadJobId: run.leadJobId,
      source: run.source,
      status: failedRun.status,
      recordsRead: rawLeads.length,
      recordsWritten: 0,
      message
    };
  }
}

function isDueCsvImportRun(run: AsyncJobRun, nowMs: number, workspaceId?: string) {
  if (workspaceId && run.workspaceId !== workspaceId) {
    return false;
  }
  if (!isCsvImportRun(run)) {
    return false;
  }
  if (run.status === "Queued") {
    return true;
  }
  if (run.status === "Retry scheduled") {
    return Boolean(run.nextRetryAt && Date.parse(run.nextRetryAt) <= nowMs);
  }
  return false;
}

function isCsvImportRun(run: AsyncJobRun) {
  const checkpoint = checkpointRecord(run);
  return checkpoint.kind === "csv_import" || run.source.toLowerCase().includes("csv");
}

function checkpointRecord(run: AsyncJobRun) {
  return isRecord(run.checkpoint) ? run.checkpoint : {};
}

function csvMappingFromCheckpoint(value: unknown): CsvImportMapping {
  if (!isRecord(value)) {
    return {};
  }

  return {
    companyName: stringOrUndefined(value.companyName),
    contactName: stringOrUndefined(value.contactName),
    title: stringOrUndefined(value.title),
    email: stringOrUndefined(value.email),
    phone: stringOrUndefined(value.phone),
    domain: stringOrUndefined(value.domain),
    website: stringOrUndefined(value.website),
    city: stringOrUndefined(value.city),
    state: stringOrUndefined(value.state),
    country: stringOrUndefined(value.country),
    industry: stringOrUndefined(value.industry),
    source: stringOrUndefined(value.source),
    sourceUrl: stringOrUndefined(value.sourceUrl),
    customColumns: Array.isArray(value.customColumns)
      ? value.customColumns.map(customColumnFromCheckpoint).filter((item): item is { column: string; fieldName: string } => Boolean(item))
      : undefined
  };
}

function customColumnFromCheckpoint(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  const column = stringOrUndefined(value.column);
  const fieldName = stringOrUndefined(value.fieldName);
  return column && fieldName ? { column, fieldName } : undefined;
}

function leadJobForRun(state: AppState, run: AsyncJobRun): LeadJob {
  const job = state.leadJobs.find((item) => item.workspaceId === run.workspaceId && item.id === run.leadJobId);
  if (!job) {
    throw new Error("Lead job not found for worker run.");
  }
  return job;
}

function appendWorkerAudit(
  state: AppState,
  workspaceId: string,
  input: { objectId: string; action: string; newValue: unknown }
) {
  const actor = systemActorForWorkspace(state, workspaceId);
  appendWorkspaceAudit(state, {
    workspaceId,
    actorUserId: actor.id,
    objectType: "lead_job",
    objectId: input.objectId,
    action: input.action,
    newValue: input.newValue
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
