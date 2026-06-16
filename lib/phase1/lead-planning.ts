import { randomUUID } from "node:crypto";
import type {
  AppState,
  Contact,
  LeadJob,
  LeadSourceEstimate,
  Priority,
  SearchProfile,
  Session
} from "@/lib/phase1/types";

type LeadJobPreflightInput = {
  profile?: SearchProfile;
  name?: string;
  sources: string[];
  requestedRecords?: number;
  budgetCapCents?: number;
  enrichmentBudgetCents?: number;
  highValueOnlyEnrichment?: boolean;
};

type SourceCostProfile = {
  unitCostCents: number;
  creditsPerRecord: number;
  confidence: number;
  volumeShare: number;
};

const sourceCostProfiles: Record<string, SourceCostProfile> = {
  "CSV Upload": { unitCostCents: 0, creditsPerRecord: 0, confidence: 94, volumeShare: 0.9 },
  Apollo: { unitCostCents: 8, creditsPerRecord: 1, confidence: 86, volumeShare: 1 },
  Hunter: { unitCostCents: 3, creditsPerRecord: 1, confidence: 80, volumeShare: 0.72 },
  "Google Places": { unitCostCents: 4, creditsPerRecord: 1, confidence: 82, volumeShare: 0.82 },
  Apify: { unitCostCents: 6, creditsPerRecord: 1, confidence: 72, volumeShare: 0.55 }
};

const fallbackCostProfile: SourceCostProfile = {
  unitCostCents: 5,
  creditsPerRecord: 1,
  confidence: 70,
  volumeShare: 0.65
};

export function createLeadJobPreflight(input: LeadJobPreflightInput) {
  const sources = normalizedSources(input.sources, input.profile?.sources);
  const requestedRecords = Math.max(
    0,
    Math.round(input.requestedRecords ?? input.profile?.estimatedVolume ?? 0)
  );
  const baselineRecords = requestedRecords || 100;
  const estimates = sources.map((source) => estimateSource(source, baselineRecords, sources.length));
  const estimatedRecords = estimates.reduce((total, estimate) => total + estimate.estimatedRecords, 0);
  const estimatedCostCents = estimates.reduce((total, estimate) => total + estimate.estimatedCostCents, 0);
  const estimatedCredits = estimates.reduce((total, estimate) => total + estimate.estimatedCredits, 0);
  const enrichmentBudgetCents = Math.max(0, Math.round(input.enrichmentBudgetCents ?? Math.round(estimatedRecords * 2)));
  const totalEstimatedCostCents = estimatedCostCents + enrichmentBudgetCents;
  const budgetCapCents = Math.max(0, Math.round(input.budgetCapCents ?? Math.ceil(totalEstimatedCostCents * 1.15)));

  return {
    jobName: input.name || (input.profile ? `${input.profile.name} Job` : "Manual lead job"),
    sources,
    requestedRecords: baselineRecords,
    estimatedRecords,
    estimatedCostCents: totalEstimatedCostCents,
    estimatedAcquisitionCostCents: estimatedCostCents,
    estimatedCredits,
    budgetCapCents,
    enrichmentBudgetCents,
    highValueOnlyEnrichment: input.highValueOnlyEnrichment ?? false,
    budgetStatus: budgetCapCents >= totalEstimatedCostCents ? "Within budget" as const : "Over budget" as const,
    sourceEstimates: estimates
  };
}

export function createLeadJobFromPreflight(input: {
  session: Session;
  profile?: SearchProfile;
  name?: string;
  sources: string[];
  requestedRecords?: number;
  budgetCapCents?: number;
  enrichmentBudgetCents?: number;
  highValueOnlyEnrichment?: boolean;
  budgetConfirmed: boolean;
  now?: string;
}): LeadJob {
  const preflight = createLeadJobPreflight(input);

  if (!input.budgetConfirmed) {
    throw new Error("Budget confirmation is required before queuing a lead job.");
  }

  if (preflight.budgetStatus === "Over budget") {
    throw new Error("Budget cap must be greater than or equal to the estimated job cost.");
  }

  const now = input.now ?? new Date().toISOString();

  return {
    id: `job-${randomUUID()}`,
    workspaceId: input.session.workspace.id,
    searchProfileId: input.profile?.id,
    name: preflight.jobName,
    status: "Queued",
    progress: 0,
    sources: preflight.sources,
    estimatedRecords: preflight.estimatedRecords,
    estimatedCostCents: preflight.estimatedCostCents,
    estimatedCostSource: "Estimated",
    estimatedCredits: preflight.estimatedCredits,
    budgetCapCents: preflight.budgetCapCents,
    budgetCapSource: "Manual",
    budgetStatus: "Confirmed",
    budgetConfirmedAt: now,
    budgetConfirmedById: input.session.user.id,
    preflightSourceEstimates: preflight.sourceEstimates,
    enrichmentBudgetCents: preflight.enrichmentBudgetCents,
    highValueOnlyEnrichment: preflight.highValueOnlyEnrichment,
    raw: 0,
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
    eta: "Waiting for source data",
    errorSummary: "Budget confirmed; source connector or CSV data required",
    createdById: input.session.user.id,
    createdAt: now,
    updatedAt: now
  };
}

export function applyLeadOverride(input: {
  state: AppState;
  workspaceId: string;
  contactId: string;
  priorityOverride?: Priority;
  segmentOverride?: string;
  reason: string;
  now?: string;
}) {
  if (!input.reason.trim()) {
    throw new Error("An override reason is required.");
  }

  const contact = input.state.contacts.find(
    (item) => item.id === input.contactId && item.workspaceId === input.workspaceId
  );

  if (!contact) {
    throw new Error("Contact not found.");
  }

  const before = leadOverrideSnapshot(contact);
  const now = input.now ?? new Date().toISOString();

  if (input.priorityOverride) {
    contact.priority = input.priorityOverride;
  }

  if (input.segmentOverride?.trim()) {
    contact.segment = input.segmentOverride.trim();
  }

  contact.updatedAt = now;
  syncNormalizedRecordOverride(input.state, contact);

  return {
    contact,
    before,
    after: leadOverrideSnapshot(contact),
    reason: input.reason.trim()
  };
}

export function phase4JobDefaults(job: LeadJob): LeadJob {
  const preflight = createLeadJobPreflight({
    name: job.name,
    sources: job.sources,
    requestedRecords: job.estimatedRecords || job.raw || 100,
    budgetCapCents: job.budgetCapCents,
    enrichmentBudgetCents: job.enrichmentBudgetCents,
    highValueOnlyEnrichment: job.highValueOnlyEnrichment
  });

  return {
    ...job,
    estimatedRecords: job.estimatedRecords ?? preflight.estimatedRecords,
    estimatedCostCents: job.estimatedCostCents ?? preflight.estimatedCostCents,
    estimatedCostSource: job.estimatedCostSource ?? "Estimated",
    estimatedCredits: job.estimatedCredits ?? preflight.estimatedCredits,
    budgetCapCents: job.budgetCapCents ?? preflight.budgetCapCents,
    budgetCapSource: job.budgetCapSource ?? "Manual",
    budgetStatus: job.budgetStatus ?? "Draft estimate",
    preflightSourceEstimates: job.preflightSourceEstimates ?? preflight.sourceEstimates,
    enrichmentBudgetCents: job.enrichmentBudgetCents ?? preflight.enrichmentBudgetCents,
    highValueOnlyEnrichment: job.highValueOnlyEnrichment ?? false,
    actualCostCents: job.actualCostCents ?? Math.round(job.actualCost * 100),
    actualCostSource: job.actualCostSource ?? "Demo"
  };
}

function estimateSource(source: string, requestedRecords: number, sourceCount: number): LeadSourceEstimate {
  const profile = sourceCostProfiles[source] ?? fallbackCostProfile;
  const weightedRecords = requestedRecords * profile.volumeShare / Math.max(sourceCount, 1);
  const estimatedRecords = Math.max(1, Math.round(weightedRecords));
  const estimatedCostCents = estimatedRecords * profile.unitCostCents;

  return {
    source,
    estimatedRecords,
    estimatedCostCents,
    estimatedCredits: Math.ceil(estimatedRecords * profile.creditsPerRecord),
    unitCostCents: profile.unitCostCents,
    confidence: profile.confidence
  };
}

function normalizedSources(inputSources: string[], fallbackSources?: string[]) {
  const sources = inputSources.length ? inputSources : fallbackSources ?? ["CSV Upload"];
  return Array.from(new Set(sources.map((source) => source.trim()).filter(Boolean)));
}

function leadOverrideSnapshot(contact: Contact) {
  return {
    contactId: contact.id,
    priority: contact.priority,
    segment: contact.segment,
    score: contact.score,
    status: contact.status
  };
}

function syncNormalizedRecordOverride(state: AppState, contact: Contact) {
  for (const record of state.normalizedRecords.filter(
    (item) => item.workspaceId === contact.workspaceId && item.email === contact.email
  )) {
    record.priority = contact.priority;
    record.segment = contact.segment;
    record.status = contact.status;
  }
}
