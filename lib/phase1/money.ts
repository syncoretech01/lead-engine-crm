import { randomUUID } from "node:crypto";
import type {
  AppState,
  LeadJob,
  MoneyCurrency,
  MoneySource,
  ProviderJob,
  ProviderJobOperation,
  ProviderUsageLedger
} from "@/lib/phase1/types";

export const moneySources: MoneySource[] = [
  "Actual",
  "Estimated",
  "Manual",
  "Demo",
  "System-generated",
  "Projected"
];

export const defaultCurrency: MoneyCurrency = "USD";

const actualCostSources = new Set<MoneySource>(["Actual", "Manual", "Demo", "System-generated"]);

const operationUnitCostCents: Partial<Record<ProviderJobOperation | string, number>> = {
  discover_companies: 8,
  discover_contacts: 8,
  find_email: 3,
  verify_email: 1,
  find_phone: 4,
  verify_phone: 1,
  enrich_company: 2,
  enrich_contact: 2,
  send_campaign: 1,
  process_webhook: 0,
  send_transactional_email: 1
};

const providerOperationUnitCostCents: Record<string, number> = {
  "apollo:discover_companies": 8,
  "apollo:discover_contacts": 8,
  "google_places:discover_companies": 4,
  "apify:discover_companies": 6,
  "hunter:find_email": 3,
  "hunter:verify_email": 2,
  "zerobounce:verify_email": 1,
  "lusha:find_email": 5,
  "lusha:find_phone": 6,
  "people_data_labs:enrich_company": 4,
  "people_data_labs:enrich_contact": 4,
  "twilio_lookup:verify_phone": 1,
  "smartlead:send_campaign": 1,
  "amazon_ses:send_transactional_email": 1
};

export function dollarsToCents(value: number | null | undefined) {
  return normalizeCents((value ?? 0) * 100);
}

export function centsToDollars(value: number | null | undefined) {
  return normalizeCents(value) / 100;
}

export function normalizeCents(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

export function providerUnitCostCents(provider: string, operation: string) {
  return providerOperationUnitCostCents[`${provider}:${operation}`] ?? operationUnitCostCents[operation] ?? 0;
}

export function estimatedProviderCostCents(input: {
  provider: string;
  operation: string;
  unitsUsed: number;
}) {
  return normalizeCents(input.unitsUsed * providerUnitCostCents(input.provider, input.operation));
}

export function unitCostFromTotal(totalCostCents: number, unitsUsed: number) {
  const units = Math.max(1, Math.round(unitsUsed));
  return normalizeCents(totalCostCents / units);
}

export function recordProviderUsage(
  state: AppState,
  input: {
    workspaceId: string;
    provider: string;
    operation: string;
    jobId?: string;
    providerJobId?: string;
    providerJobRunId?: string;
    unitsUsed: number;
    unitCostCents?: number;
    totalCostCents?: number;
    currency?: MoneyCurrency;
    amountKind: MoneySource;
    rawProviderMetadata?: Record<string, unknown>;
    createdAt?: string;
  }
) {
  const unitsUsed = Math.max(0, Math.round(input.unitsUsed));
  const unitCostCents = normalizeCents(input.unitCostCents ?? providerUnitCostCents(input.provider, input.operation));
  const totalCostCents = normalizeCents(input.totalCostCents ?? unitsUsed * unitCostCents);
  const now = input.createdAt ?? new Date().toISOString();
  const existing = input.providerJobRunId
    ? state.providerUsageLedger.find(
        (entry) => entry.providerJobRunId === input.providerJobRunId && entry.amountKind === input.amountKind
      )
    : undefined;

  if (existing) {
    existing.unitsUsed = unitsUsed;
    existing.unitCostCents = unitCostCents;
    existing.totalCostCents = totalCostCents;
    existing.rawProviderMetadata = redactMoneyMetadata(input.rawProviderMetadata ?? existing.rawProviderMetadata);
    existing.createdAt = now;
    return existing;
  }

  const entry: ProviderUsageLedger = {
    id: `usage-${randomUUID()}`,
    workspaceId: input.workspaceId,
    provider: input.provider,
    operation: input.operation,
    jobId: input.jobId,
    providerJobId: input.providerJobId,
    providerJobRunId: input.providerJobRunId,
    unitsUsed,
    unitCostCents,
    totalCostCents,
    currency: input.currency ?? defaultCurrency,
    amountKind: input.amountKind,
    rawProviderMetadata: redactMoneyMetadata(input.rawProviderMetadata ?? {}),
    createdAt: now
  };

  state.providerUsageLedger.unshift(entry);
  return entry;
}

export function providerUsageEntriesForWorkspace(state: AppState, workspaceId: string) {
  return state.providerUsageLedger.filter((entry) => entry.workspaceId === workspaceId);
}

export function ledgerCostCents(entries: ProviderUsageLedger[], sources?: MoneySource[]) {
  const allowed = sources ? new Set(sources) : undefined;
  return entries
    .filter((entry) => !allowed || allowed.has(entry.amountKind))
    .reduce((total, entry) => total + normalizeCents(entry.totalCostCents), 0);
}

export function actualLedgerCostCents(entries: ProviderUsageLedger[]) {
  return entries
    .filter((entry) => actualCostSources.has(entry.amountKind))
    .reduce((total, entry) => total + normalizeCents(entry.totalCostCents), 0);
}

export function providerLedgerJobId(job: ProviderJob) {
  return job.sourceObjectType === "lead_job" && job.sourceObjectId ? job.sourceObjectId : job.id;
}

export function syncLeadJobActualCostsFromLedger(state: AppState, workspaceId: string) {
  for (const job of state.leadJobs.filter((item) => item.workspaceId === workspaceId)) {
    const costCents = actualLedgerCostCents(state.providerUsageLedger.filter((entry) => entry.jobId === job.id));
    if (costCents > 0 || job.actualCostCents === undefined) {
      job.actualCostCents = costCents || dollarsToCents(job.actualCost);
      job.actualCost = centsToDollars(job.actualCostCents);
      job.actualCostSource = costCents > 0 ? costSourceForJob(state, job.id) : job.actualCostSource ?? "Demo";
    }
    job.estimatedCostSource = job.estimatedCostSource ?? "Estimated";
    job.budgetCapSource = job.budgetCapSource ?? "Manual";
  }
}

export function ensureMoneyLedgerDefaults(
  state: AppState,
  workspaceId: string,
  now = new Date().toISOString()
) {
  let changed = false;

  for (const job of state.leadJobs.filter((item) => item.workspaceId === workspaceId)) {
    job.actualCostCents = job.actualCostCents ?? dollarsToCents(job.actualCost);
    job.estimatedCostSource = job.estimatedCostSource ?? "Estimated";
    job.actualCostSource = job.actualCostSource ?? "Demo";
    job.budgetCapSource = job.budgetCapSource ?? "Manual";

    if (job.actualCostCents > 0 && !state.providerUsageLedger.some((entry) => entry.id === demoLedgerId(job.id))) {
      state.providerUsageLedger.push({
        id: demoLedgerId(job.id),
        workspaceId,
        provider: "syncore_local_demo",
        operation: "seeded_lead_job_cost",
        jobId: job.id,
        unitsUsed: Math.max(job.raw, 1),
        unitCostCents: unitCostFromTotal(job.actualCostCents, Math.max(job.raw, 1)),
        totalCostCents: job.actualCostCents,
        currency: defaultCurrency,
        amountKind: "Demo",
        rawProviderMetadata: {
          source: "Seeded local lead job",
          jobName: job.name,
          moneySource: "Demo"
        },
        createdAt: now
      });
      changed = true;
    }
  }

  for (const run of state.providerJobRuns.filter((item) => item.workspaceId === workspaceId && item.status === "Completed")) {
    if (state.providerUsageLedger.some((entry) => entry.providerJobRunId === run.id && entry.amountKind === "Actual")) {
      continue;
    }

    const job = state.providerJobs.find((item) => item.id === run.providerJobId);
    recordProviderUsage(state, {
      workspaceId,
      provider: run.providerId,
      operation: run.operation,
      jobId: job ? providerLedgerJobId(job) : run.providerJobId,
      providerJobId: run.providerJobId,
      providerJobRunId: run.id,
      unitsUsed: run.recordsWritten || run.recordsRead || 1,
      unitCostCents: unitCostFromTotal(run.costCents, run.recordsWritten || run.recordsRead || 1),
      totalCostCents: run.costCents,
      amountKind: "Actual",
      rawProviderMetadata: {
        providerRunId: run.providerRunId,
        rawResponseRef: run.rawResponseRef,
        recordsRead: run.recordsRead,
        recordsWritten: run.recordsWritten
      },
      createdAt: run.completedAt ?? run.updatedAt
    });
    changed = true;
  }

  syncLeadJobActualCostsFromLedger(state, workspaceId);
  return { changed };
}

export function workspaceCostMetrics(state: AppState, workspaceId: string) {
  const entries = providerUsageEntriesForWorkspace(state, workspaceId);
  const actualCostCents = actualLedgerCostCents(entries);
  const estimatedCostCents = state.leadJobs
    .filter((job) => job.workspaceId === workspaceId)
    .reduce((total, job) => total + normalizeCents(job.estimatedCostCents), 0);
  const projectedCostCents = ledgerCostCents(entries, ["Projected"]);
  const manualCostCents = ledgerCostCents(entries, ["Manual"]);
  const demoCostCents = ledgerCostCents(entries, ["Demo"]);
  const systemGeneratedCostCents = ledgerCostCents(entries, ["System-generated"]);
  const verifiedEmails = verifiedEmailCount(state, workspaceId);
  const validPhones = validPhoneCount(state, workspaceId);
  const sdrReadyLeads = state.contacts.filter(
    (contact) => contact.workspaceId === workspaceId && !contact.isSuppressed && contact.status === "Ready for SDR"
  ).length;
  const opportunities = state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId).length;

  return {
    actualCostCents,
    estimatedCostCents,
    projectedCostCents,
    manualCostCents,
    demoCostCents,
    systemGeneratedCostCents,
    verifiedEmails,
    validPhones,
    sdrReadyLeads,
    opportunities,
    costPerVerifiedEmailCents: perUnitCost(actualCostCents, verifiedEmails),
    costPerValidPhoneCents: perUnitCost(actualCostCents, validPhones),
    costPerSdrReadyLeadCents: perUnitCost(actualCostCents, sdrReadyLeads),
    costPerOpportunityCents: perUnitCost(actualCostCents, opportunities)
  };
}

export function evaluateBudgetStopRules(
  state: AppState,
  input: {
    workspaceId: string;
    providerId?: string;
    leadJobId?: string;
    nextCostCents: number;
    now?: string;
  }
) {
  const nextCostCents = normalizeCents(input.nextCostCents);
  const now = input.now ?? new Date().toISOString();
  const providerConnection = input.providerId
    ? state.providerConnections.find(
        (connection) => connection.workspaceId === input.workspaceId && connection.providerId === input.providerId
      )
    : undefined;

  if (providerConnection?.dailyBudgetCents !== undefined) {
    const spentToday = actualLedgerCostCents(
      state.providerUsageLedger.filter(
        (entry) =>
          entry.workspaceId === input.workspaceId &&
          entry.provider === input.providerId &&
          entry.createdAt.slice(0, 10) === now.slice(0, 10)
      )
    );
    const capCents = normalizeCents(providerConnection.dailyBudgetCents);
    if (spentToday + nextCostCents > capCents) {
      return {
        allowed: false,
        scope: "provider_daily_budget" as const,
        spentCents: spentToday,
        capCents,
        remainingCents: Math.max(0, capCents - spentToday),
        stopReason: `${providerConnection.displayName} daily budget would be exceeded.`
      };
    }
  }

  if (input.leadJobId) {
    const leadJob = state.leadJobs.find((job) => job.workspaceId === input.workspaceId && job.id === input.leadJobId);
    if (leadJob?.budgetCapCents !== undefined) {
      const spentForJob = actualLedgerCostCents(
        state.providerUsageLedger.filter((entry) => entry.workspaceId === input.workspaceId && entry.jobId === input.leadJobId)
      );
      const capCents = normalizeCents(leadJob.budgetCapCents);
      if (spentForJob + nextCostCents > capCents) {
        return {
          allowed: false,
          scope: "lead_job_budget" as const,
          spentCents: spentForJob,
          capCents,
          remainingCents: Math.max(0, capCents - spentForJob),
          stopReason: `${leadJob.name} budget cap would be exceeded.`
        };
      }
    }
  }

  return {
    allowed: true,
    scope: "none" as const,
    spentCents: 0,
    capCents: undefined,
    remainingCents: undefined,
    stopReason: undefined
  };
}

function verifiedEmailCount(state: AppState, workspaceId: string) {
  return state.contacts.filter((contact) => {
    if (contact.workspaceId !== workspaceId || contact.isSuppressed) return false;
    const latest = latestVerification(state, contact.id);
    return latest?.emailStatus === "Valid";
  }).length;
}

function validPhoneCount(state: AppState, workspaceId: string) {
  return state.contacts.filter((contact) => {
    if (contact.workspaceId !== workspaceId || contact.isSuppressed) return false;
    const latest = latestVerification(state, contact.id);
    return latest?.phoneStatus === "Valid";
  }).length;
}

function latestVerification(state: AppState, contactId: string) {
  return state.verificationResults
    .filter((result) => result.contactId === contactId)
    .sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0];
}

function perUnitCost(costCents: number, units: number) {
  return units > 0 ? Math.round(costCents / units) : 0;
}

function costSourceForJob(state: AppState, jobId: string): MoneySource {
  const entries = state.providerUsageLedger.filter((entry) => entry.jobId === jobId && actualCostSources.has(entry.amountKind));
  if (entries.some((entry) => entry.amountKind === "Actual")) return "Actual";
  if (entries.some((entry) => entry.amountKind === "Manual")) return "Manual";
  if (entries.some((entry) => entry.amountKind === "System-generated")) return "System-generated";
  return "Demo";
}

function demoLedgerId(jobId: string) {
  return `usage-demo-${jobId}`;
}

function redactMoneyMetadata(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      /api[_-]?key|secret|token|password|authorization/i.test(key) ? "[redacted]" : value
    ])
  );
}
