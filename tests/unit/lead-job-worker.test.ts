import { describe, expect, it } from "vitest";
import { createTrackedJob, csvImportIdempotencyKey, csvImportRequestHash } from "@/lib/phase1/jobs";
import { processLeadJobQueue } from "@/lib/phase1/lead-job-worker";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, LeadJob, RawLead } from "@/lib/phase1/types";

describe("lead job worker", () => {
  it("processes queued CSV imports out of band", () => {
    const state = cleanLeadState(createSeedState());
    const workspaceId = state.workspaces[0].id;
    const mapping = {
      companyName: "company",
      contactName: "name",
      email: "email",
      domain: "domain",
      title: "title"
    };
    const csvText = "company,name,email,domain,title\nAcme Test,Ada Lovelace,ada@acmetest.example,acmetest.example,CEO";
    const requestHash = csvImportRequestHash({
      csvText,
      source: "CSV Upload",
      mapping,
      workspaceId
    });
    const idempotencyKey = csvImportIdempotencyKey(workspaceId, requestHash);
    const job = createLeadJob(workspaceId, "job-csv-worker", "CSV Upload");
    const tracked = createTrackedJob({
      state,
      job,
      sources: ["CSV Upload"],
      idempotencyKey,
      idempotencyScope: "csv_import",
      requestHash,
      checkpoint: {
        kind: "csv_import",
        mapping,
        rows: 1,
        stage: "queued"
      }
    });
    state.rawLeads.unshift(createRawLead(workspaceId, job.id));

    const result = processLeadJobQueue(state, {
      workspaceId,
      now: "2026-06-26T12:00:00.000Z",
      workerId: "test-worker"
    });

    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect(tracked.runs[0].status).toBe("Completed");
    expect(tracked.runs[0].recordsRead).toBe(1);
    expect(tracked.runs[0].recordsWritten).toBe(1);
    expect(state.leadJobs.find((item) => item.id === job.id)?.status).toBe("Completed");
    expect(state.rawLeads.find((item) => item.leadJobId === job.id)?.processingStatus).toBe("Normalized");
    expect(state.normalizedRecords.filter((item) => item.leadJobId === job.id)).toHaveLength(1);
    expect(state.jobIdempotencyRecords.find((item) => item.key === idempotencyKey)?.status).toBe("Completed");
    expect(state.auditLogs[0].action).toBe("csv_import_background_completed");
  });

  it("leaves non-CSV lead jobs queued for other workers", () => {
    const state = cleanLeadState(createSeedState());
    const workspaceId = state.workspaces[0].id;
    const job = createLeadJob(workspaceId, "job-provider-worker", "Apollo");
    const tracked = createTrackedJob({
      state,
      job,
      sources: ["Apollo"],
      checkpoint: { kind: "provider_import" }
    });

    const result = processLeadJobQueue(state, {
      workspaceId,
      now: "2026-06-26T12:00:00.000Z"
    });

    expect(result.claimed).toBe(0);
    expect(tracked.runs[0].status).toBe("Queued");
    expect(state.leadJobs.find((item) => item.id === job.id)?.status).toBe("Queued");
  });

  it("preserves CSV processing when worker audit identity is missing", () => {
    const state = cleanLeadState(createSeedState());
    const workspaceId = state.workspaces[0].id;
    const mapping = {
      companyName: "company",
      contactName: "name",
      email: "email",
      domain: "domain"
    };
    const csvText = "company,name,email,domain\nAcme Test,Ada Lovelace,ada@acmetest.example,acmetest.example";
    const requestHash = csvImportRequestHash({
      csvText,
      source: "CSV Upload",
      mapping,
      workspaceId
    });
    const idempotencyKey = csvImportIdempotencyKey(workspaceId, requestHash);
    const job = createLeadJob(workspaceId, "job-csv-worker-missing-audit-identity", "CSV Upload");
    const tracked = createTrackedJob({
      state,
      job,
      sources: ["CSV Upload"],
      idempotencyKey,
      idempotencyScope: "csv_import",
      requestHash,
      checkpoint: {
        kind: "csv_import",
        mapping,
        rows: 1,
        stage: "queued"
      }
    });
    state.rawLeads.unshift(createRawLead(workspaceId, job.id));
    state.workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
    state.workspaceMembers = state.workspaceMembers.filter((member) => member.workspaceId !== workspaceId);

    const result = processLeadJobQueue(state, {
      workspaceId,
      now: "2026-06-26T12:00:00.000Z",
      workerId: "test-worker"
    });

    expect(result.completed).toBe(1);
    expect(tracked.runs[0].status).toBe("Completed");
    expect(state.normalizedRecords.filter((item) => item.leadJobId === job.id)).toHaveLength(1);
    expect(state.auditLogs).toHaveLength(0);
    expect(state.jobLogs.some((log) => log.level === "Warning" && log.message.includes("Worker audit skipped"))).toBe(true);
  });

  it("increments attempts when retry-scheduled CSV runs become due", () => {
    const state = cleanLeadState(createSeedState());
    const workspaceId = state.workspaces[0].id;
    const job = createLeadJob(workspaceId, "job-csv-retry-worker", "CSV Upload");
    const tracked = createTrackedJob({
      state,
      job,
      sources: ["CSV Upload"],
      idempotencyKey: "csv-import:workspace:test-retry",
      idempotencyScope: "csv_import",
      requestHash: "retry-hash",
      checkpoint: { kind: "csv_import", rows: 1, stage: "queued" }
    });

    const first = processLeadJobQueue(state, {
      workspaceId,
      now: "2026-06-26T12:00:00.000Z"
    });
    const second = processLeadJobQueue(state, {
      workspaceId,
      now: "2026-06-26T12:01:01.000Z"
    });

    expect(first.failed).toBe(1);
    expect(second.failed).toBe(1);
    expect(tracked.runs[0].attempt).toBe(2);
    expect(tracked.runs[0].status).toBe("Retry scheduled");
  });
});

function cleanLeadState(state: AppState) {
  state.leadJobs = [];
  state.asyncJobRuns = [];
  state.jobLogs = [];
  state.jobIdempotencyRecords = [];
  state.rawLeads = [];
  state.normalizedRecords = [];
  state.companies = [];
  state.contacts = [];
  state.verificationResults = [];
  state.dedupeMatches = [];
  state.enrichmentResults = [];
  state.fieldSources = [];
  state.providerCache = [];
  state.providerUsageLedger = [];
  state.auditLogs = [];
  return state;
}

function createLeadJob(workspaceId: string, id: string, source: string): LeadJob {
  const now = "2026-06-26T11:59:00.000Z";
  return {
    id,
    workspaceId,
    name: `${source} worker test`,
    status: "Queued",
    progress: 10,
    sources: [source],
    raw: source === "CSV Upload" ? 1 : 0,
    normalized: 0,
    duplicates: 0,
    suppressed: 0,
    verified: 0,
    enriched: 0,
    exported: 0,
    pushedToCrm: 0,
    actualCost: 0,
    actualCostCents: 0,
    actualCostSource: "Actual",
    estimatedCostSource: "Estimated",
    eta: "Queued",
    errorSummary: "Waiting",
    createdById: "user-nora",
    createdAt: now,
    updatedAt: now
  };
}

function createRawLead(workspaceId: string, leadJobId: string): RawLead {
  return {
    id: "raw-csv-worker-1",
    workspaceId,
    leadJobId,
    source: "CSV Upload",
    sourceRecordId: "csv-row-1",
    sourcePayload: {
      company: "Acme Test",
      name: "Ada Lovelace",
      email: "ada@acmetest.example",
      domain: "acmetest.example",
      title: "CEO"
    },
    sourceConfidence: 70,
    extractedAt: "2026-06-26T11:59:10.000Z",
    processingStatus: "Pending"
  };
}
