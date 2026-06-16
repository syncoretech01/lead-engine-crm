import { createHash, randomUUID } from "node:crypto";
import type {
  AppState,
  Company,
  Contact,
  EnrichmentFields,
  EnrichmentProvider,
  EnrichmentResult,
  EnrichmentTargetType,
  ProviderCacheEntry
} from "@/lib/phase1/types";
import { applySegmentsAndScores } from "@/lib/phase1/scoring";
import { recordProviderUsage } from "@/lib/phase1/money";

const providers: EnrichmentProvider[] = [
  "Syncore Apollo Local",
  "Syncore Hunter Local",
  "Syncore Web Signals Local"
];

type RunWorkspaceEnrichmentOptions = {
  budgetCents?: number;
  highValueOnly?: boolean;
};

const enrichmentUnitCostCents = 2;

export function runWorkspaceEnrichment(
  state: AppState,
  workspaceId: string,
  options: RunWorkspaceEnrichmentOptions = {}
) {
  let enrichedCompanies = 0;
  let enrichedContacts = 0;
  let cacheHits = 0;
  let cacheWrites = 0;
  let budgetSpentCents = 0;
  let skippedForBudget = 0;
  let skippedForHighValue = 0;
  const budgetCents = typeof options.budgetCents === "number" ? Math.max(0, Math.round(options.budgetCents)) : undefined;

  const canSpend = () => budgetCents === undefined || budgetSpentCents + enrichmentUnitCostCents <= budgetCents;
  const spend = () => {
    budgetSpentCents += enrichmentUnitCostCents;
  };

  for (const company of state.companies.filter((item) => item.workspaceId === workspaceId)) {
    if (options.highValueOnly && !isHighValueCompany(state, company)) {
      skippedForHighValue += 1;
      continue;
    }

    if (!canSpend()) {
      skippedForBudget += 1;
      continue;
    }

    const result = enrichCompany(state, company);
    spend();
    recordProviderUsage(state, {
      workspaceId,
      provider: "syncore_local_enrichment",
      operation: "enrich_company",
      jobId: undefined,
      unitsUsed: 1,
      unitCostCents: enrichmentUnitCostCents,
      totalCostCents: enrichmentUnitCostCents,
      amountKind: "System-generated",
      rawProviderMetadata: {
        targetType: "company",
        targetId: company.id,
        highValueOnly: options.highValueOnly ?? false,
        moneySource: "System-generated"
      }
    });
    enrichedCompanies += result.enriched ? 1 : 0;
    cacheHits += result.cacheHits;
    cacheWrites += result.cacheWrites;
  }

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId && !item.isSuppressed)) {
    if (options.highValueOnly && !isHighValueContact(contact)) {
      skippedForHighValue += 1;
      continue;
    }

    if (!canSpend()) {
      skippedForBudget += 1;
      continue;
    }

    const company = state.companies.find((item) => item.id === contact.companyId);
    const result = enrichContact(state, contact, company);
    spend();
    recordProviderUsage(state, {
      workspaceId,
      provider: "syncore_local_enrichment",
      operation: "enrich_contact",
      jobId: undefined,
      unitsUsed: 1,
      unitCostCents: enrichmentUnitCostCents,
      totalCostCents: enrichmentUnitCostCents,
      amountKind: "System-generated",
      rawProviderMetadata: {
        targetType: "contact",
        targetId: contact.id,
        highValueOnly: options.highValueOnly ?? false,
        moneySource: "System-generated"
      }
    });
    enrichedContacts += result.enriched ? 1 : 0;
    cacheHits += result.cacheHits;
    cacheWrites += result.cacheWrites;
  }

  const scoring = applySegmentsAndScores(state, workspaceId);
  refreshJobEnrichmentCounts(state, workspaceId);

  return {
    enrichedCompanies,
    enrichedContacts,
    cacheHits,
    cacheWrites,
    budgetSpentCents,
    budgetRemainingCents: budgetCents === undefined ? undefined : Math.max(budgetCents - budgetSpentCents, 0),
    skippedForBudget,
    skippedForHighValue,
    highValueOnly: options.highValueOnly ?? false,
    segmented: scoring.segmented,
    scored: scoring.scored
  };
}

export function enrichCompany(state: AppState, company: Company) {
  const before = coverageForCompany(company);
  let cacheHits = 0;
  let cacheWrites = 0;

  for (const provider of providers) {
    const result = getOrCreateEnrichment({
      state,
      provider,
      workspaceId: company.workspaceId,
      targetType: "company",
      targetId: company.id,
      input: `${company.name}|${company.domain}|${company.industry}`,
      fields: () => companyFields(provider, company)
    });
    cacheHits += result.cacheHit ? 1 : 0;
    cacheWrites += result.cacheHit ? 0 : 1;
    applyCompanyFields(company, result.enrichment.fields);

    if (coverageForCompany(company) >= 90) {
      break;
    }
  }

  company.enrichmentCoverage = coverageForCompany(company);
  company.updatedAt = new Date().toISOString();

  return { enriched: coverageForCompany(company) > before, cacheHits, cacheWrites };
}

export function enrichContact(state: AppState, contact: Contact, company?: Company) {
  const before = coverageForContact(contact);
  let cacheHits = 0;
  let cacheWrites = 0;

  for (const provider of providers) {
    const result = getOrCreateEnrichment({
      state,
      provider,
      workspaceId: contact.workspaceId,
      targetType: "contact",
      targetId: contact.id,
      input: `${contact.name}|${contact.email}|${contact.title}|${company?.domain ?? ""}`,
      fields: () => contactFields(provider, contact, company)
    });
    cacheHits += result.cacheHit ? 1 : 0;
    cacheWrites += result.cacheHit ? 0 : 1;
    applyContactFields(contact, result.enrichment.fields);

    if (coverageForContact(contact) >= 90) {
      break;
    }
  }

  contact.enrichmentCoverage = coverageForContact(contact);
  contact.enrichedAt = new Date().toISOString();
  contact.updatedAt = contact.enrichedAt;

  return { enriched: coverageForContact(contact) > before, cacheHits, cacheWrites };
}

function getOrCreateEnrichment({
  state,
  provider,
  workspaceId,
  targetType,
  targetId,
  input,
  fields
}: {
  state: AppState;
  provider: EnrichmentProvider;
  workspaceId: string;
  targetType: EnrichmentTargetType;
  targetId: string;
  input: string;
  fields: () => EnrichmentFields;
}) {
  const now = new Date();
  const cacheKey = `${provider}:${targetType}:${hash(input)}`;
  const cached = state.providerCache.find(
    (entry) => entry.workspaceId === workspaceId && entry.provider === provider && entry.cacheKey === cacheKey
  );

  if (cached && Date.parse(cached.expiresAt) > now.getTime()) {
    cached.hits += 1;
    const enrichment = writeEnrichmentResult(state, {
      workspaceId,
      provider,
      targetType,
      targetId,
      cacheKey,
      fields: cached.fields,
      confidence: cached.confidence,
      cacheHit: true,
      now
    });
    return { enrichment, cacheHit: true };
  }

  const generatedFields = fields();
  const confidence = confidenceForProvider(provider, generatedFields);
  const expiresAt = new Date(now.getTime() + ttlDays(provider) * 24 * 60 * 60 * 1000).toISOString();
  const cacheEntry: ProviderCacheEntry = {
    id: `cache-${randomUUID()}`,
    workspaceId,
    provider,
    targetType,
    cacheKey,
    inputHash: hash(input),
    fields: generatedFields,
    confidence,
    hits: 0,
    createdAt: now.toISOString(),
    expiresAt
  };

  state.providerCache.unshift(cacheEntry);
  const enrichment = writeEnrichmentResult(state, {
    workspaceId,
    provider,
    targetType,
    targetId,
    cacheKey,
    fields: generatedFields,
    confidence,
    cacheHit: false,
    now
  });

  return { enrichment, cacheHit: false };
}

function writeEnrichmentResult(
  state: AppState,
  input: {
    workspaceId: string;
    provider: EnrichmentProvider;
    targetType: EnrichmentTargetType;
    targetId: string;
    cacheKey: string;
    fields: EnrichmentFields;
    confidence: number;
    cacheHit: boolean;
    now: Date;
  }
) {
  const enrichment: EnrichmentResult = {
    id: `enrichment-${randomUUID()}`,
    workspaceId: input.workspaceId,
    provider: input.provider,
    targetType: input.targetType,
    targetId: input.targetId,
    confidence: input.confidence,
    fields: input.fields,
    rawResponse: {
      provider: input.provider,
      cacheHit: input.cacheHit,
      fields: Object.keys(input.fields)
    },
    cacheKey: input.cacheKey,
    enrichedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + ttlDays(input.provider) * 24 * 60 * 60 * 1000).toISOString()
  };

  state.enrichmentResults.unshift(enrichment);
  return enrichment;
}

function companyFields(provider: EnrichmentProvider, company: Company): EnrichmentFields {
  const haystack = `${company.name} ${company.domain} ${company.industry}`.toLowerCase();

  if (provider === "Syncore Apollo Local") {
    return {
      industry: company.industry || inferIndustry(haystack),
      employeeBand: company.employeeBand || inferEmployeeBand(haystack),
      revenueBand: company.revenueBand || inferRevenueBand(haystack),
      confidenceNote: "Local Apollo-style firmographic enrichment"
    };
  }

  if (provider === "Syncore Hunter Local") {
    return {
      signals: Array.from(new Set([...(company.signals ?? []), "domain present", company.domain ? "company domain resolved" : "domain missing"])),
      confidenceNote: "Local Hunter-style domain enrichment"
    };
  }

  return {
    technologies: inferTechnologies(haystack),
    signals: inferSignals(haystack),
    confidenceNote: "Local web signal enrichment"
  };
}

function contactFields(provider: EnrichmentProvider, contact: Contact, company?: Company): EnrichmentFields {
  const haystack = `${contact.name} ${contact.title} ${contact.email} ${company?.industry ?? ""} ${
    company?.domain ?? ""
  }`.toLowerCase();

  if (provider === "Syncore Apollo Local") {
    return {
      seniority: contact.seniority || inferSeniority(contact.title),
      department: contact.department || inferDepartment(contact.title),
      confidenceNote: "Local Apollo-style persona enrichment"
    };
  }

  if (provider === "Syncore Hunter Local") {
    return {
      directEmailCandidate: contact.email,
      confidenceNote: contact.grade === "C" ? "Role email needs direct mailbox enrichment" : "Email candidate retained"
    };
  }

  return {
    signals: inferSignals(haystack),
    confidenceNote: "Local web/contact signal enrichment"
  };
}

function applyCompanyFields(company: Company, fields: EnrichmentFields) {
  company.industry ||= fields.industry ?? "";
  company.employeeBand ||= fields.employeeBand;
  company.revenueBand ||= fields.revenueBand;
  company.technologies = Array.from(new Set([...(company.technologies ?? []), ...(fields.technologies ?? [])]));
  company.signals = Array.from(new Set([...(company.signals ?? []), ...(fields.signals ?? [])]));
}

function applyContactFields(contact: Contact, fields: EnrichmentFields) {
  contact.seniority ||= fields.seniority;
  contact.department ||= fields.department;
  contact.fitReason = fields.confidenceNote ?? contact.fitReason;
}

function coverageForCompany(company: Company) {
  const checks = [
    company.industry,
    company.employeeBand,
    company.revenueBand,
    company.domain,
    company.website,
    company.city,
    company.state,
    (company.technologies ?? []).length > 0,
    (company.signals ?? []).length > 0
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function coverageForContact(contact: Contact) {
  const checks = [
    contact.name,
    contact.title,
    contact.email,
    contact.phone,
    contact.seniority,
    contact.department,
    contact.grade,
    contact.segment,
    contact.owner
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function inferIndustry(value: string) {
  if (value.includes("shopify") || value.includes("ecommerce") || value.includes("outfitter") || value.includes("retail")) {
    return "Ecommerce";
  }
  if (value.includes("auto") || value.includes("dealer") || value.includes("motors") || value.includes("fleet")) {
    return "Automotive services";
  }
  if (value.includes("architect") || value.includes("design")) {
    return "Architecture";
  }
  if (value.includes("solar") || value.includes("roof") || value.includes("home")) {
    return "Home services";
  }
  return "B2B services";
}

function inferEmployeeBand(value: string) {
  if (value.includes("group") || value.includes("fleet")) return "51-200";
  if (value.includes("studio") || value.includes("family")) return "11-50";
  return "1-50";
}

function inferRevenueBand(value: string) {
  if (value.includes("group") || value.includes("fleet")) return "$10M-$50M";
  if (value.includes("ecommerce") || value.includes("outfitter")) return "$5M-$25M";
  return "$1M-$10M";
}

function inferTechnologies(value: string) {
  const technologies = [];
  if (value.includes("shopify") || value.includes("outfitter") || value.includes("goods")) technologies.push("Shopify");
  if (value.includes("klaviyo") || value.includes("ecommerce")) technologies.push("Klaviyo");
  if (value.includes("studio") || value.includes("architect")) technologies.push("WordPress");
  if (value.includes("dealer") || value.includes("motors")) technologies.push("DealerSocket");
  return technologies.length ? technologies : ["Website detected"];
}

function inferSignals(value: string) {
  const signals = [];
  if (value.includes("growth") || value.includes("marketing")) signals.push("hiring growth");
  if (value.includes("owner") || value.includes("founder")) signals.push("owner identified");
  if (value.includes("phone") || value.includes("local") || value.includes("dealer")) signals.push("phone ready");
  if (value.includes("shopify") || value.includes("ecommerce")) signals.push("email marketing");
  return signals.length ? signals : ["source verified"];
}

function inferSeniority(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("owner") || normalized.includes("founder")) return "Owner";
  if (normalized.includes("ceo") || normalized.includes("chief")) return "C-level";
  if (normalized.includes("vp")) return "VP";
  if (normalized.includes("director")) return "Director";
  if (normalized.includes("manager") || normalized.includes("principal")) return "Manager";
  return "Individual Contributor";
}

function inferDepartment(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("marketing") || normalized.includes("growth")) return "Marketing";
  if (normalized.includes("sales")) return "Sales";
  if (normalized.includes("finance")) return "Finance";
  if (normalized.includes("operations") || normalized.includes("general manager")) return "Operations";
  if (normalized.includes("owner") || normalized.includes("founder") || normalized.includes("principal")) return "Executive";
  return "General";
}

function confidenceForProvider(provider: EnrichmentProvider, fields: EnrichmentFields) {
  const fieldCount = Object.values(fields).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
  const base = provider === "Syncore Apollo Local" ? 82 : provider === "Syncore Hunter Local" ? 78 : 70;
  return Math.min(98, base + fieldCount * 3);
}

function ttlDays(provider: EnrichmentProvider) {
  if (provider === "Syncore Apollo Local") return 60;
  if (provider === "Syncore Hunter Local") return 45;
  return 30;
}

function isHighValueCompany(state: AppState, company: Company) {
  if (company.priority === "P1" || company.priority === "P2" || company.score >= 70) {
    return true;
  }

  return state.contacts.some((contact) => contact.companyId === company.id && isHighValueContact(contact));
}

function isHighValueContact(contact: Contact) {
  return (
    contact.priority === "P1" ||
    contact.priority === "P2" ||
    contact.score >= 70 ||
    contact.grade === "A" ||
    contact.grade === "B"
  );
}

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function refreshJobEnrichmentCounts(state: AppState, workspaceId: string) {
  for (const job of state.leadJobs.filter((item) => item.workspaceId === workspaceId)) {
    const contactIds = new Set(
      state.normalizedRecords
        .filter((record) => record.leadJobId === job.id)
        .map((record) => state.contacts.find((contact) => contact.email === record.email)?.id)
        .filter(Boolean)
    );
    job.enriched = [...contactIds].filter((id) =>
      state.enrichmentResults.some((result) => result.targetId === id)
    ).length;
    job.updatedAt = new Date().toISOString();
  }
}
