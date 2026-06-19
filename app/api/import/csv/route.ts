import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertPermission } from "@/lib/phase1/auth";
import { parseCsv } from "@/lib/phase1/csv";
import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import {
  appendJobLog,
  completeJobRun,
  createTrackedJob,
  csvImportIdempotencyKey,
  csvImportRequestHash,
  markIdempotencyCompleted,
  reserveJobIdempotency
} from "@/lib/phase1/jobs";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { appendAudit, updateState } from "@/lib/phase1/store";
import { runWorkspaceVerification } from "@/lib/phase1/verification";
import type { CsvImportMapping, CsvImportResult, LeadJob, RawLead } from "@/lib/phase1/types";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
  }

  const csvText = await file.text();
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV did not contain any importable rows." }, { status: 400 });
  }

  const result = await updateState<CsvImportResult>((state, session) => {
    assertPermission(session, "import_csv");
    const now = new Date().toISOString();
    const source = stringValue(formData.get("source"), "CSV Upload");
    const profileId = stringValue(formData.get("searchProfileId"));
    const profile = state.searchProfiles.find(
      (item) => item.id === profileId && item.workspaceId === session.workspace.id
    );
    const mapping: CsvImportMapping = {
      companyName: stringValue(formData.get("companyName")),
      contactName: stringValue(formData.get("contactName")),
      title: stringValue(formData.get("title")),
      email: stringValue(formData.get("email")),
      phone: stringValue(formData.get("phone")),
      domain: stringValue(formData.get("domain")),
      website: stringValue(formData.get("website")),
      city: stringValue(formData.get("city")),
      state: stringValue(formData.get("state")),
      country: stringValue(formData.get("country")),
      industry: stringValue(formData.get("industry")),
      source: stringValue(formData.get("sourceColumn")),
      sourceUrl: stringValue(formData.get("sourceUrl"))
    };
    const requestHash = csvImportRequestHash({
      csvText,
      source,
      mapping,
      workspaceId: session.workspace.id
    });
    const idempotencyKey = csvImportIdempotencyKey(session.workspace.id, requestHash);
    const existingIdempotency = state.jobIdempotencyRecords.find(
      (record) => record.workspaceId === session.workspace.id && record.key === idempotencyKey
    );

    if (existingIdempotency) {
      const existingJob = state.leadJobs.find((item) => item.id === existingIdempotency.leadJobId);
      if (existingJob) {
        appendJobLog(state, {
          workspaceId: session.workspace.id,
          leadJobId: existingJob.id,
          level: "Info",
          message: "Idempotent CSV replay served without creating duplicate records",
          metadata: {
            idempotencyKey,
            requestHash,
            status: existingIdempotency.status
          }
        });

        return {
          jobId: existingJob.id,
          replayed: true,
          idempotencyKey,
          raw: existingJob.raw,
          normalized: existingJob.normalized,
          duplicates: existingJob.duplicates,
          suppressed: existingJob.suppressed,
          companies: 0,
          contacts: 0
        };
      }
    }

    const job: LeadJob = {
      id: `job-${randomUUID()}`,
      workspaceId: session.workspace.id,
      searchProfileId: profile?.id,
      name: stringValue(formData.get("jobName"), `${profile?.name ?? "CSV"} Import`),
      status: "Running",
      progress: 35,
      sources: [source],
      raw: rows.length,
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
      startedAt: now,
      eta: "Normalizing",
      errorSummary: "Processing CSV rows",
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };
    const reservation = reserveJobIdempotency(state, {
      workspaceId: session.workspace.id,
      key: idempotencyKey,
      scope: "csv_import",
      requestHash,
      leadJobId: job.id
    });

    if (reservation.replayed) {
      const existingJob = state.leadJobs.find((item) => item.id === reservation.record.leadJobId);
      return {
        jobId: reservation.record.leadJobId,
        replayed: true,
        idempotencyKey,
        raw: existingJob?.raw ?? 0,
        normalized: existingJob?.normalized ?? 0,
        duplicates: existingJob?.duplicates ?? 0,
        suppressed: existingJob?.suppressed ?? 0,
        companies: 0,
        contacts: 0
      };
    }

    const rawLeads: RawLead[] = rows.map((row, index) => ({
      id: `raw-${randomUUID()}`,
      workspaceId: session.workspace.id,
      leadJobId: job.id,
      source,
      sourceRecordId: `${file.name}-${index + 1}`,
      sourcePayload: row,
      sourceUrl: mapping.sourceUrl ? row[mapping.sourceUrl] : undefined,
      sourceConfidence: 70,
      extractedAt: now,
      processingStatus: "Pending"
    }));

    const trackedJob = createTrackedJob({
      state,
      job,
      sources: [source],
      idempotencyKey,
      startImmediately: true,
      logMessage: "CSV import job started"
    });
    state.rawLeads.unshift(...rawLeads);
    const counts = normalizeImportedRows({
      state,
      workspaceId: session.workspace.id,
      leadJob: job,
      rawLeads,
      mapping
    });
    const verification = runWorkspaceVerification(state, session.workspace.id);
    const dedupe = detectWorkspaceDuplicates(state, session.workspace.id);
    const enrichment = runWorkspaceEnrichment(state, session.workspace.id);
    completeJobRun(state, {
      runId: trackedJob.runs[0].id,
      recordsRead: rows.length,
      recordsWritten: counts.normalized,
      checkpoint: {
        rows: rows.length,
        normalized: counts.normalized,
        duplicates: counts.duplicates,
        suppressed: counts.suppressed
      },
      message: "CSV import normalized, verified, deduped, and enriched"
    });
    markIdempotencyCompleted(
      state,
      session.workspace.id,
      idempotencyKey,
      job.id,
      rawLeads.map((lead) => lead.id)
    );

    appendAudit(state, session, {
      objectType: "lead_job",
      objectId: job.id,
      action: "csv_imported",
      newValue: {
        fileName: file.name,
        source,
        rows: rows.length,
        idempotencyKey,
        counts,
        verification,
        dedupe,
        enrichment
      }
    });

    return {
      jobId: job.id,
      replayed: false,
      idempotencyKey,
      ...counts
    };
  });

  return NextResponse.json(result);
}

function stringValue(value: FormDataEntryValue | null, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
}
