import { domainReadCache } from "@/lib/phase1/domain-read-cache";
import { defaultExportRules } from "@/lib/phase1/exporting";
import {
  consentStatusValue,
  createFastState,
  iso,
  lawfulBasisValue,
  leadGradeValue,
  leadStatusValue,
  optionalIso,
  priorityValue,
  recordFromJson,
  stringArray
} from "@/lib/phase1/fast-read-utils";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  Company,
  Contact,
  ExportRecord,
  JobStatus,
  LeadJob,
  NormalizedRecord,
  ProcessingStatus,
  RawLead,
  SearchProfile,
  Session,
  VerificationResult
} from "@/lib/phase1/types";

const DASHBOARD_RECORD_LIMIT = 2_000;
const DASHBOARD_JOB_LIMIT = 100;
const DASHBOARD_EXPORT_LIMIT = 100;

export const readFastLeadDashboardState = domainReadCache(readFastLeadDashboardStateUncached);

async function readFastLeadDashboardStateUncached(
  session: Session,
  workspaceId: string
): Promise<AppState | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const [
    profileRows,
    jobRows,
    rawLeadRows,
    normalizedRows,
    companyRows,
    contactRows,
    verificationRows,
    exportRows
  ] = await Promise.all([
    prisma.searchProfile.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        profileName: true,
        targetMarket: true,
        targetIndustries: true,
        targetGeographies: true,
        targetTitles: true,
        requiredFields: true,
        sourcePreferences: true,
        scoringProfile: true,
        segmentRules: true,
        defaultRouting: true,
        complianceNotes: true,
        createdById: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.leadJob.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_JOB_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        searchProfileId: true,
        jobName: true,
        selectedSources: true,
        sourceConfigs: true,
        status: true,
        estimatedRecords: true,
        rawRecordsCount: true,
        normalizedRecordsCount: true,
        duplicateRecordsCount: true,
        suppressedRecordsCount: true,
        verifiedEmailCount: true,
        enrichedRecordsCount: true,
        exportedRecordsCount: true,
        pushedToCrmCount: true,
        estimatedCostCents: true,
        actualCostCents: true,
        complianceNotes: true,
        errorSummary: true,
        createdById: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.rawLead.findMany({
      where: { workspaceId },
      orderBy: [{ extractedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        leadJobId: true,
        source: true,
        sourceRecordId: true,
        sourcePayload: true,
        sourceUrl: true,
        sourceConfidence: true,
        extractedAt: true,
        processingStatus: true,
        processingError: true
      }
    }),
    prisma.normalizedRecord.findMany({
      where: { workspaceId },
      orderBy: [{ normalizedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        rawLeadId: true,
        leadJobId: true,
        companyName: true,
        normalizedName: true,
        domain: true,
        website: true,
        contactName: true,
        title: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        country: true,
        industry: true,
        grade: true,
        score: true,
        priority: true,
        status: true,
        segment: true,
        owner: true,
        verification: true,
        suppressionReason: true,
        normalizedAt: true,
        rawLead: {
          select: {
            source: true
          }
        }
      }
    }),
    prisma.company.findMany({
      where: { workspaceId },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        name: true,
        normalizedName: true,
        rootDomain: true,
        website: true,
        phone: true,
        industry: true,
        employeeBand: true,
        revenueBand: true,
        city: true,
        state: true,
        country: true,
        sourceLineage: true,
        confidence: true,
        score: true,
        priority: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.contact.findMany({
      where: { workspaceId },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        companyId: true,
        fullName: true,
        title: true,
        seniority: true,
        department: true,
        email: true,
        phone: true,
        sourceLineage: true,
        confidence: true,
        grade: true,
        score: true,
        priority: true,
        status: true,
        segment: true,
        owner: true,
        verification: true,
        enrichmentCoverage: true,
        fitReason: true,
        enrichedAt: true,
        lawfulBasis: true,
        consentStatus: true,
        consentSource: true,
        consentCapturedAt: true,
        doNotContact: true,
        isSuppressed: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.verificationResult.findMany({
      where: { workspaceId },
      orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        provider: true,
        email: true,
        phone: true,
        grade: true,
        status: true,
        checks: true,
        rawResponse: true,
        verifiedAt: true,
        expiresAt: true
      }
    }),
    prisma.export.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_EXPORT_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        leadJobId: true,
        name: true,
        exportType: true,
        filterSnapshot: true,
        columns: true,
        recordCount: true,
        createdById: true,
        createdAt: true
      }
    })
  ]);

  const profileEstimates = new Map<string, number>();
  for (const job of jobRows) {
    if (!job.searchProfileId) continue;
    profileEstimates.set(
      job.searchProfileId,
      Math.max(profileEstimates.get(job.searchProfileId) ?? 0, job.estimatedRecords)
    );
  }

  return createFastState(session, {
    searchProfiles: profileRows.map((row) => searchProfileFromPrisma(row, profileEstimates.get(row.id) ?? 0)),
    leadJobs: jobRows.map(leadJobFromPrisma),
    rawLeads: rawLeadRows.map(rawLeadFromPrisma),
    normalizedRecords: normalizedRows.map(normalizedRecordFromPrisma),
    companies: companyRows.map(companyFromPrisma),
    contacts: contactRows.map(contactFromPrisma),
    verificationResults: verificationRows.map(verificationResultFromPrisma),
    exportRules: defaultExportRules(workspaceId),
    exports: exportRows.map(exportRecordFromPrisma)
  });
}

function searchProfileFromPrisma(
  row: {
    id: string;
    workspaceId: string;
    profileName: string;
    targetMarket: string | null;
    targetIndustries: string[];
    targetGeographies: string[];
    targetTitles: string[];
    requiredFields: string[];
    sourcePreferences: unknown;
    scoringProfile: string | null;
    segmentRules: unknown;
    defaultRouting: unknown;
    complianceNotes: string | null;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  estimatedVolume: number
): SearchProfile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.profileName,
    targetMarket: row.targetMarket ?? "",
    geographies: row.targetGeographies,
    industries: row.targetIndustries,
    titles: row.targetTitles,
    sources: profileSources(row.sourcePreferences),
    requiredFields: row.requiredFields,
    scoringProfile: row.scoringProfile ?? "",
    segmentRules: profileSegmentRules(row.segmentRules),
    defaultRouting: profileDefaultRouting(row.defaultRouting),
    estimatedVolume,
    complianceNote: row.complianceNotes ?? "",
    createdById: row.createdById ?? "system",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function leadJobFromPrisma(row: {
  id: string;
  workspaceId: string;
  searchProfileId: string | null;
  jobName: string;
  selectedSources: string[];
  sourceConfigs: unknown;
  status: string;
  estimatedRecords: number;
  rawRecordsCount: number;
  normalizedRecordsCount: number;
  duplicateRecordsCount: number;
  suppressedRecordsCount: number;
  verifiedEmailCount: number;
  enrichedRecordsCount: number;
  exportedRecordsCount: number;
  pushedToCrmCount: number;
  estimatedCostCents: number;
  actualCostCents: number;
  complianceNotes: string | null;
  errorSummary: string | null;
  createdById: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): LeadJob {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    searchProfileId: row.searchProfileId ?? undefined,
    name: row.jobName,
    status: jobStatusValue(row.status),
    progress: jobProgress(row.status, row.normalizedRecordsCount, row.estimatedRecords),
    sources: row.selectedSources,
    estimatedRecords: row.estimatedRecords,
    estimatedCostCents: row.estimatedCostCents,
    raw: row.rawRecordsCount,
    normalized: row.normalizedRecordsCount,
    duplicates: row.duplicateRecordsCount,
    suppressed: row.suppressedRecordsCount,
    verified: row.verifiedEmailCount,
    enriched: row.enrichedRecordsCount,
    exported: row.exportedRecordsCount,
    pushedToCrm: row.pushedToCrmCount,
    actualCost: row.actualCostCents / 100,
    actualCostCents: row.actualCostCents,
    budgetStatus: budgetStatusFromCompliance(row.complianceNotes),
    startedAt: optionalIso(row.startedAt),
    completedAt: optionalIso(row.completedAt),
    eta: row.status === "COMPLETED" ? "Done" : "",
    errorSummary: row.errorSummary ?? "",
    createdById: row.createdById ?? "system",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function rawLeadFromPrisma(row: {
  id: string;
  workspaceId: string;
  leadJobId: string;
  source: string;
  sourceRecordId: string;
  sourcePayload: unknown;
  sourceUrl: string | null;
  sourceConfidence: number | null;
  extractedAt: Date;
  processingStatus: string;
  processingError: string | null;
}): RawLead {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    leadJobId: row.leadJobId,
    source: row.source,
    sourceRecordId: row.sourceRecordId,
    sourcePayload: stringRecordFromJson(row.sourcePayload),
    sourceUrl: row.sourceUrl ?? undefined,
    sourceConfidence: row.sourceConfidence ?? undefined,
    extractedAt: iso(row.extractedAt),
    processingStatus: processingStatusValue(row.processingStatus),
    processingError: row.processingError ?? undefined
  };
}

function normalizedRecordFromPrisma(row: {
  id: string;
  workspaceId: string;
  rawLeadId: string;
  leadJobId: string | null;
  companyName: string | null;
  normalizedName: string | null;
  domain: string | null;
  website: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  grade: string | null;
  score: number;
  priority: string | null;
  status: string | null;
  segment: string | null;
  owner: string | null;
  verification: string | null;
  suppressionReason: string | null;
  normalizedAt: Date;
  rawLead: { source: string };
}): NormalizedRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    rawLeadId: row.rawLeadId,
    leadJobId: row.leadJobId ?? "",
    companyName: row.companyName ?? "",
    normalizedCompanyName: row.normalizedName ?? "",
    contactName: row.contactName ?? "",
    title: row.title ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    domain: row.domain ?? "",
    website: row.website ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    country: row.country ?? "",
    industry: row.industry ?? "",
    source: row.rawLead.source,
    grade: leadGradeValue(row.grade),
    score: row.score,
    priority: priorityValue(row.priority),
    status: leadStatusValue(row.status),
    segment: row.segment ?? "Unsegmented",
    owner: row.owner ?? "Unassigned",
    verification: row.verification ?? "No verification yet",
    suppressionReason: row.suppressionReason ?? undefined,
    normalizedAt: iso(row.normalizedAt)
  };
}

function companyFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  rootDomain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  employeeBand: string | null;
  revenueBand: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sourceLineage: unknown;
  confidence: number;
  score: number;
  priority: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Company {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    normalizedName: row.normalizedName,
    domain: row.rootDomain ?? "",
    website: row.website ?? "",
    phone: row.phone ?? "",
    industry: row.industry ?? "",
    employeeBand: row.employeeBand ?? undefined,
    revenueBand: row.revenueBand ?? undefined,
    technologies: [],
    signals: [],
    enrichmentCoverage: row.confidence,
    city: row.city ?? "",
    state: row.state ?? "",
    country: row.country ?? "",
    sourceLineage: stringArray(row.sourceLineage),
    score: row.score,
    priority: priorityValue(row.priority),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function contactFromPrisma(row: {
  id: string;
  workspaceId: string;
  companyId: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  sourceLineage: unknown;
  confidence: number;
  grade: string | null;
  score: number;
  priority: string | null;
  status: string | null;
  segment: string | null;
  owner: string | null;
  verification: string | null;
  enrichmentCoverage: number | null;
  fitReason: string | null;
  enrichedAt: Date | null;
  lawfulBasis: string | null;
  consentStatus: string | null;
  consentSource: string | null;
  consentCapturedAt: Date | null;
  doNotContact: boolean;
  isSuppressed: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.companyId ?? "",
    name: row.fullName,
    title: row.title ?? "",
    seniority: row.seniority ?? undefined,
    department: row.department ?? undefined,
    email: row.email ?? "",
    phone: row.phone ?? "",
    grade: leadGradeValue(row.grade),
    score: row.score,
    priority: priorityValue(row.priority),
    status: leadStatusValue(row.status),
    segment: row.segment ?? "Unsegmented",
    owner: row.owner ?? "Unassigned",
    sourceLineage: stringArray(row.sourceLineage),
    verification: row.verification ?? "No verification yet",
    enrichmentCoverage: row.enrichmentCoverage ?? row.confidence,
    fitReason: row.fitReason ?? undefined,
    enrichedAt: optionalIso(row.enrichedAt),
    lawfulBasis: lawfulBasisValue(row.lawfulBasis),
    consentStatus: consentStatusValue(row.consentStatus),
    consentSource: row.consentSource ?? "Unknown",
    consentCapturedAt: optionalIso(row.consentCapturedAt),
    doNotContact: row.doNotContact,
    isSuppressed: row.isSuppressed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function verificationResultFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string;
  provider: string;
  email: string | null;
  phone: string | null;
  grade: string;
  status: string;
  checks: unknown;
  rawResponse: unknown;
  verifiedAt: Date;
  expiresAt: Date | null;
}): VerificationResult {
  const rawResponse = recordFromJson(row.rawResponse);
  const emailStatus = emailStatusValue(row.status, row.grade);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId,
    provider: "Syncore Local",
    email: row.email ?? "",
    phone: row.phone ?? "",
    grade: leadGradeValue(row.grade),
    emailStatus,
    domainStatus: row.email ? "Mail-capable" : "Missing",
    phoneStatus: phoneStatusValue(rawResponse.phoneStatus, row.phone),
    roleEmail: booleanValue(rawResponse.roleEmail),
    disposable: booleanValue(rawResponse.disposable),
    catchAll: booleanValue(rawResponse.catchAll),
    suppressionReason: typeof rawResponse.suppressionReason === "string" ? rawResponse.suppressionReason : undefined,
    checks: stringArray(row.checks),
    rawResponse,
    verifiedAt: iso(row.verifiedAt),
    expiresAt: optionalIso(row.expiresAt) ?? iso(row.verifiedAt)
  };
}

function exportRecordFromPrisma(row: {
  id: string;
  workspaceId: string;
  leadJobId: string | null;
  name: string;
  exportType: string;
  filterSnapshot: unknown;
  columns: string[];
  recordCount: number;
  createdById: string | null;
  createdAt: Date;
}): ExportRecord {
  const snapshot = recordFromJson(row.filterSnapshot);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    leadJobId: row.leadJobId ?? undefined,
    exportRuleId: typeof snapshot.exportRuleId === "string" ? snapshot.exportRuleId : undefined,
    name: row.name,
    type: exportTypeValue(row.exportType),
    columns: row.columns,
    recordIds: stringArray(snapshot.recordIds),
    recordCount: row.recordCount,
    blockedCount: typeof snapshot.blockedCount === "number" ? snapshot.blockedCount : undefined,
    createdById: row.createdById ?? "system",
    createdAt: iso(row.createdAt),
    status: snapshot.status === "Draft" ? "Draft" : "Ready"
  };
}

function profileSources(value: unknown) {
  if (Array.isArray(value)) {
    return stringArray(value);
  }

  if (value && typeof value === "object" && !Array.isArray(value) && "sources" in value) {
    return stringArray((value as { sources?: unknown }).sources);
  }

  return [];
}

function profileSegmentRules(value: unknown) {
  if (Array.isArray(value)) {
    return stringArray(value);
  }

  if (value && typeof value === "object" && !Array.isArray(value) && "rules" in value) {
    return stringArray((value as { rules?: unknown }).rules);
  }

  return [];
}

function profileDefaultRouting(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value) && "route" in value) {
    const route = (value as { route?: unknown }).route;
    return typeof route === "string" ? route : "";
  }

  return "";
}

function stringRecordFromJson(value: unknown): Record<string, string> {
  const record = recordFromJson(value);
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, item]) => [key, String(item)])
  );
}

function jobStatusValue(value: string): JobStatus {
  const map: Record<string, JobStatus> = {
    DRAFT: "Draft",
    QUEUED: "Queued",
    RUNNING: "Running",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    FAILED: "Failed",
    CANCELLED: "Failed",
    Draft: "Draft",
    Queued: "Queued",
    Running: "Running",
    Paused: "Paused",
    Completed: "Completed",
    Failed: "Failed"
  };
  return map[value] ?? "Draft";
}

function processingStatusValue(value: string): ProcessingStatus {
  const map: Record<string, ProcessingStatus> = {
    PENDING: "Pending",
    NORMALIZED: "Normalized",
    FAILED: "Failed",
    SUPPRESSED: "Suppressed",
    Pending: "Pending",
    Normalized: "Normalized",
    Failed: "Failed",
    Suppressed: "Suppressed"
  };
  return map[value] ?? "Pending";
}

function exportTypeValue(value: string): ExportRecord["type"] {
  if (
    value === "companies" ||
    value === "contacts" ||
    value === "verified_email_leads" ||
    value === "phone_leads" ||
    value === "sdr_assignments"
  ) {
    return value;
  }

  return "contacts";
}

function budgetStatusFromCompliance(value: string | null): LeadJob["budgetStatus"] {
  if (!value) {
    return undefined;
  }

  if (value.includes("Within budget")) return "Within budget";
  if (value.includes("Over budget")) return "Over budget";
  if (value.includes("Confirmed")) return "Confirmed";
  if (value.includes("Draft estimate")) return "Draft estimate";
  return undefined;
}

function jobProgress(status: string, normalized: number, estimatedRecords: number) {
  if (status === "COMPLETED" || status === "Completed") {
    return 100;
  }

  if (status === "FAILED" || status === "Failed") {
    return Math.max(0, Math.min(100, estimatedRecords ? Math.round((normalized / estimatedRecords) * 100) : 0));
  }

  if (estimatedRecords <= 0) {
    return normalized > 0 ? 50 : 0;
  }

  return Math.max(5, Math.min(95, Math.round((normalized / estimatedRecords) * 100)));
}

function emailStatusValue(status: string, grade: string): VerificationResult["emailStatus"] {
  if (status === "Valid" || status === "Risky" || status === "Invalid" || status === "Missing" || status === "Suppressed") {
    return status;
  }

  if (grade === "A" || grade === "B") return "Valid";
  if (grade === "C") return "Risky";
  if (grade === "S") return "Suppressed";
  return "Invalid";
}

function phoneStatusValue(value: unknown, phone: string | null): VerificationResult["phoneStatus"] {
  if (value === "Valid" || value === "Invalid" || value === "Missing") {
    return value;
  }

  return phone ? "Valid" : "Missing";
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : false;
}
