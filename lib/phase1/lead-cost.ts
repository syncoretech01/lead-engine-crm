import type { LeadSourceEstimate } from "@/lib/phase1/types";

/**
 * Client-safe lead-job cost math. Lives apart from lead-planning.ts (which pulls
 * in node:crypto) so both the server preflight and the Build List live preview
 * import the *same* formula — one source of truth, no drift.
 */
export type LeadSourceCostProfile = {
  unitCostCents: number;
  creditsPerRecord: number;
  confidence: number;
  volumeShare: number;
};

export const sourceCostProfiles: Record<string, LeadSourceCostProfile> = {
  "CSV Upload": { unitCostCents: 0, creditsPerRecord: 0, confidence: 94, volumeShare: 0.9 },
  Apollo: { unitCostCents: 8, creditsPerRecord: 1, confidence: 86, volumeShare: 1 },
  Hunter: { unitCostCents: 3, creditsPerRecord: 1, confidence: 80, volumeShare: 0.72 },
  "Google Places": { unitCostCents: 4, creditsPerRecord: 1, confidence: 82, volumeShare: 0.82 },
  Apify: { unitCostCents: 6, creditsPerRecord: 1, confidence: 72, volumeShare: 0.55 }
};

export const fallbackCostProfile: LeadSourceCostProfile = {
  unitCostCents: 5,
  creditsPerRecord: 1,
  confidence: 70,
  volumeShare: 0.65
};

export function estimateLeadSource(source: string, requestedRecords: number, sourceCount: number): LeadSourceEstimate {
  const profile = sourceCostProfiles[source] ?? fallbackCostProfile;
  const weightedRecords = (requestedRecords * profile.volumeShare) / Math.max(sourceCount, 1);
  const estimatedRecords = Math.max(1, Math.round(weightedRecords));

  return {
    source,
    estimatedRecords,
    estimatedCostCents: estimatedRecords * profile.unitCostCents,
    estimatedCredits: Math.ceil(estimatedRecords * profile.creditsPerRecord),
    unitCostCents: profile.unitCostCents,
    confidence: profile.confidence
  };
}

export type LeadJobCostEstimate = {
  sources: string[];
  requestedRecords: number;
  estimatedRecords: number;
  estimatedCostCents: number;
  estimatedAcquisitionCostCents: number;
  estimatedCredits: number;
  enrichmentBudgetCents: number;
  budgetCapCents: number;
  budgetStatus: "Within budget" | "Over budget";
  sourceEstimates: LeadSourceEstimate[];
};

/**
 * Pure cost estimate for an already-resolved set of sources + requested records.
 * Identical to what the server preflight reports, so the live preview and the
 * queued job always agree.
 */
export function estimateLeadJobCost(input: {
  sources: string[];
  requestedRecords: number;
  budgetCapCents?: number;
  enrichmentBudgetCents?: number;
}): LeadJobCostEstimate {
  const baselineRecords = Math.max(0, Math.round(input.requestedRecords)) || 100;
  const sourceEstimates = input.sources.map((source) => estimateLeadSource(source, baselineRecords, input.sources.length));
  const estimatedRecords = sourceEstimates.reduce((total, estimate) => total + estimate.estimatedRecords, 0);
  const estimatedAcquisitionCostCents = sourceEstimates.reduce((total, estimate) => total + estimate.estimatedCostCents, 0);
  const estimatedCredits = sourceEstimates.reduce((total, estimate) => total + estimate.estimatedCredits, 0);
  const enrichmentBudgetCents = Math.max(0, Math.round(input.enrichmentBudgetCents ?? Math.round(estimatedRecords * 2)));
  const estimatedCostCents = estimatedAcquisitionCostCents + enrichmentBudgetCents;
  const budgetCapCents = Math.max(0, Math.round(input.budgetCapCents ?? Math.ceil(estimatedCostCents * 1.15)));

  return {
    sources: input.sources,
    requestedRecords: baselineRecords,
    estimatedRecords,
    estimatedCostCents,
    estimatedAcquisitionCostCents,
    estimatedCredits,
    enrichmentBudgetCents,
    budgetCapCents,
    budgetStatus: budgetCapCents >= estimatedCostCents ? "Within budget" : "Over budget",
    sourceEstimates
  };
}
