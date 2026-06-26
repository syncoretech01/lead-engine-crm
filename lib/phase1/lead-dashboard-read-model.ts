import { domainReadCache } from "@/lib/phase1/domain-read-cache";
import { defaultExportRules } from "@/lib/phase1/exporting";
import {
  assignmentMethodValue,
  consentStatusValue,
  createFastState,
  iso,
  lawfulBasisValue,
  leadGradeValue,
  leadStatusValue,
  optionalIso,
  outreachChannelValue,
  priorityValue,
  recordFromJson,
  reminderStatusValue,
  sdrLeadStatusValue,
  slaStatusValue,
  stringArray,
  userFromPrisma,
  workspaceMemberFromPrisma
} from "@/lib/phase1/fast-read-utils";
import { defaultSegmentRules } from "@/lib/phase1/scoring";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { defaultWaterfallTemplates } from "@/lib/phase1/waterfall-templates";
import type { PrismaClient } from "@prisma/client";
import type {
  AiIcpRecommendation,
  AppState,
  AsyncJobRun,
  Company,
  Contact,
  DedupeMatch,
  EnrichmentFields,
  EnrichmentProvider,
  EnrichmentResult,
  ExportRecord,
  ExportRule,
  FollowUpReminder,
  JobIdempotencyRecord,
  JobLog,
  JobStatus,
  LeadScore,
  LeadJob,
  NormalizedRecord,
  ProcessingStatus,
  ProviderCacheEntry,
  RawLead,
  RecordSegment,
  SearchProfile,
  SegmentCondition,
  SegmentRule,
  Session,
  SdrAssignment,
  SdrTeam,
  VerificationResult,
  WaterfallTemplate
} from "@/lib/phase1/types";

const DASHBOARD_RECORD_LIMIT = 2_000;
const DASHBOARD_JOB_LIMIT = 100;
const DASHBOARD_EXPORT_LIMIT = 100;
const STATE_SNAPSHOT_ID = "syncore-primary-state";

type LeadEngineSnapshotSlices = {
  asyncJobRuns: AsyncJobRun[];
  jobLogs: JobLog[];
  jobIdempotencyRecords: JobIdempotencyRecord[];
  dedupeMatches: DedupeMatch[];
  exportRules: ExportRule[];
  providerCache: ProviderCacheEntry[];
  waterfallTemplates: WaterfallTemplate[];
};

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
    exportRows,
    aiIcpRows,
    enrichmentRows,
    segmentRows,
    recordSegmentRows,
    leadScoreRows,
    sdrTeamRows,
    sdrAssignmentRows,
    followUpReminderRows,
    workspaceMemberRows,
    snapshotSlices
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
    }),
    prisma.aiIcpRecommendation.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        workspaceId: true,
        name: true,
        description: true,
        industries: true,
        titles: true,
        geographies: true,
        technologies: true,
        segments: true,
        sourceSummary: true,
        fitSignals: true,
        confidence: true,
        prompt: true,
        status: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        appliedSearchProfileId: true
      }
    }),
    prisma.enrichmentResult.findMany({
      where: { workspaceId },
      orderBy: [{ enrichedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        companyId: true,
        provider: true,
        confidence: true,
        fields: true,
        rawResponse: true,
        enrichedAt: true,
        expiresAt: true
      }
    }),
    prisma.segment.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        name: true,
        rules: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.recordSegment.findMany({
      where: { workspaceId },
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        segmentId: true,
        contactId: true,
        companyId: true,
        assignedAt: true,
        segment: {
          select: {
            name: true,
            rules: true
          }
        }
      }
    }),
    prisma.leadScore.findMany({
      where: { workspaceId },
      orderBy: [{ calculatedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        contactId: true,
        companyId: true,
        score: true,
        priority: true,
        breakdown: true,
        calculatedAt: true
      }
    }),
    prisma.sdrTeam.findMany({
      where: { workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        name: true,
        managerUserId: true,
        memberUserIds: true,
        territories: true,
        industries: true,
        capacityWeight: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.sdrAssignment.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        assignedSdrId: true,
        assignedTeamId: true,
        assignedById: true,
        assignmentMethod: true,
        assignmentReason: true,
        assignedAt: true,
        firstTouchDueAt: true,
        followUpDueAt: true,
        status: true,
        reassignmentReason: true,
        previousOwnerId: true,
        slaStatus: true,
        firstTouchedAt: true,
        lastTouchAt: true,
        touchCount: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.followUpReminder.findMany({
      where: { workspaceId },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: DASHBOARD_RECORD_LIMIT,
      select: {
        id: true,
        workspaceId: true,
        assignmentId: true,
        accountId: true,
        contactId: true,
        ownerUserId: true,
        title: true,
        channel: true,
        dueAt: true,
        status: true,
        createdAt: true,
        completedAt: true,
        snoozedUntil: true
      }
    }),
    prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        role: { in: ["SDR", "MANAGER", "ADMIN"] }
      },
      orderBy: [{ role: "asc" }, { id: "asc" }],
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true
          }
        }
      }
    }),
    readLeadEngineSnapshotSlices(prisma, workspaceId)
  ]);

  const profileEstimates = new Map<string, number>();
  for (const job of jobRows) {
    if (!job.searchProfileId) continue;
    profileEstimates.set(
      job.searchProfileId,
      Math.max(profileEstimates.get(job.searchProfileId) ?? 0, job.estimatedRecords)
    );
  }

  const segmentRules = segmentRows.map(segmentRuleFromPrisma);
  const exportRules = snapshotSlices.exportRules.length ? snapshotSlices.exportRules : defaultExportRules(workspaceId);
  const waterfallTemplates = snapshotSlices.waterfallTemplates.length
    ? snapshotSlices.waterfallTemplates
    : defaultWaterfallTemplates(workspaceId);

  return createFastState(session, {
    users: workspaceMemberRows.map((row) => userFromPrisma(row.user)),
    workspaceMembers: workspaceMemberRows.map(workspaceMemberFromPrisma),
    searchProfiles: profileRows.map((row) => searchProfileFromPrisma(row, profileEstimates.get(row.id) ?? 0)),
    leadJobs: jobRows.map(leadJobFromPrisma),
    asyncJobRuns: snapshotSlices.asyncJobRuns,
    jobLogs: snapshotSlices.jobLogs,
    jobIdempotencyRecords: snapshotSlices.jobIdempotencyRecords,
    rawLeads: rawLeadRows.map(rawLeadFromPrisma),
    normalizedRecords: normalizedRows.map(normalizedRecordFromPrisma),
    companies: companyRows.map(companyFromPrisma),
    contacts: contactRows.map(contactFromPrisma),
    verificationResults: verificationRows.map(verificationResultFromPrisma),
    dedupeMatches: snapshotSlices.dedupeMatches,
    exportRules,
    providerCache: snapshotSlices.providerCache,
    enrichmentResults: enrichmentRows.map(enrichmentResultFromPrisma),
    segmentRules: segmentRules.length ? segmentRules : defaultSegmentRules(workspaceId),
    recordSegments: recordSegmentRows.map(recordSegmentFromPrisma),
    leadScores: leadScoreRows.map(leadScoreFromPrisma),
    sdrTeams: sdrTeamRows.map(sdrTeamFromPrisma),
    sdrAssignments: sdrAssignmentRows.map(sdrAssignmentFromPrisma),
    followUpReminders: followUpReminderRows.map(followUpReminderFromPrisma),
    aiIcpRecommendations: aiIcpRows.map(aiIcpRecommendationFromPrisma),
    exports: exportRows.map(exportRecordFromPrisma),
    waterfallTemplates
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

async function readLeadEngineSnapshotSlices(
  prisma: Pick<PrismaClient, "$queryRaw">,
  workspaceId: string
): Promise<LeadEngineSnapshotSlices> {
  const rows = await prisma.$queryRaw<Array<Record<keyof LeadEngineSnapshotSlices, unknown>>>`
    SELECT
      "state"->'asyncJobRuns' AS "asyncJobRuns",
      "state"->'jobLogs' AS "jobLogs",
      "state"->'jobIdempotencyRecords' AS "jobIdempotencyRecords",
      "state"->'dedupeMatches' AS "dedupeMatches",
      "state"->'exportRules' AS "exportRules",
      "state"->'providerCache' AS "providerCache",
      "state"->'waterfallTemplates' AS "waterfallTemplates"
    FROM "AppStateSnapshot"
    WHERE "id" = ${STATE_SNAPSHOT_ID}
    LIMIT 1
  `;
  const row = rows[0];

  return {
    asyncJobRuns: workspaceSlice<AsyncJobRun>(row?.asyncJobRuns, workspaceId),
    jobLogs: workspaceSlice<JobLog>(row?.jobLogs, workspaceId),
    jobIdempotencyRecords: workspaceSlice<JobIdempotencyRecord>(row?.jobIdempotencyRecords, workspaceId),
    dedupeMatches: workspaceSlice<DedupeMatch>(row?.dedupeMatches, workspaceId),
    exportRules: workspaceSlice<ExportRule>(row?.exportRules, workspaceId),
    providerCache: workspaceSlice<ProviderCacheEntry>(row?.providerCache, workspaceId),
    waterfallTemplates: workspaceSlice<WaterfallTemplate>(row?.waterfallTemplates, workspaceId)
  };
}

function aiIcpRecommendationFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  industries: string[];
  titles: string[];
  geographies: string[];
  technologies: string[];
  segments: string[];
  sourceSummary: string;
  fitSignals: string[];
  confidence: number;
  prompt: string | null;
  status: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  appliedSearchProfileId: string | null;
}): AiIcpRecommendation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    industries: row.industries,
    titles: row.titles,
    geographies: row.geographies,
    technologies: row.technologies,
    segments: row.segments,
    sourceSummary: row.sourceSummary,
    fitSignals: row.fitSignals,
    confidence: row.confidence,
    prompt: row.prompt ?? undefined,
    status: aiRecordStatusValue(row.status),
    createdById: row.createdById ?? "system",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    appliedSearchProfileId: row.appliedSearchProfileId ?? undefined
  };
}

function enrichmentResultFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string | null;
  companyId: string | null;
  provider: string;
  confidence: number | null;
  fields: unknown;
  rawResponse: unknown;
  enrichedAt: Date;
  expiresAt: Date | null;
}): EnrichmentResult {
  const rawResponse = objectValue(row.rawResponse);
  const targetType = row.contactId ? "contact" : "company";
  const targetId = row.contactId ?? row.companyId ?? stringValue(rawResponse.targetId) ?? row.id;
  const cacheKey = stringValue(rawResponse.cacheKey) ?? `${row.provider}:${targetType}:${targetId}`;

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: enrichmentProviderValue(row.provider),
    targetType,
    targetId,
    confidence: row.confidence ?? 0,
    fields: enrichmentFieldsFromJson(row.fields),
    rawResponse: rawResponseFromJson(row.rawResponse),
    cacheKey,
    enrichedAt: iso(row.enrichedAt),
    expiresAt: optionalIso(row.expiresAt) ?? iso(row.enrichedAt)
  };
}

function segmentRuleFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  rules: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SegmentRule {
  const rules = objectValue(row.rules);
  const conditions = segmentConditionValue(rules.conditions);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: stringValue(rules.name) ?? row.name,
    description: stringValue(rules.description) ?? "",
    outputSegment: row.name,
    scoreBoost: numberValue(rules.scoreBoost) ?? 0,
    priorityOverride: optionalPriorityValue(rules.priorityOverride),
    conditions,
    active: booleanValue(rules.active, true),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function recordSegmentFromPrisma(row: {
  id: string;
  workspaceId: string;
  segmentId: string;
  contactId: string | null;
  companyId: string | null;
  assignedAt: Date;
  segment: { name: string; rules: unknown } | null;
}): RecordSegment {
  const rules = objectValue(row.segment?.rules);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId ?? "",
    companyId: row.companyId ?? "",
    segmentRuleId: row.segmentId,
    segment: row.segment?.name ?? stringValue(rules.name) ?? "Unsegmented",
    scoreContribution: numberValue(rules.scoreBoost) ?? 0,
    assignedAt: iso(row.assignedAt)
  };
}

function leadScoreFromPrisma(row: {
  id: string;
  workspaceId: string;
  contactId: string | null;
  companyId: string | null;
  score: number;
  priority: string;
  breakdown: unknown;
  calculatedAt: Date;
}): LeadScore {
  const breakdown = objectValue(row.breakdown);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId ?? "",
    companyId: row.companyId ?? "",
    score: row.score,
    priority: priorityValue(row.priority),
    breakdown: {
      verification: numberValue(breakdown.verification) ?? 0,
      enrichment: numberValue(breakdown.enrichment) ?? 0,
      segment: numberValue(breakdown.segment) ?? 0,
      fit: numberValue(breakdown.fit) ?? 0,
      compliance: numberValue(breakdown.compliance) ?? 0
    },
    reasons: stringArray(breakdown.reasons),
    calculatedAt: iso(row.calculatedAt)
  };
}

function sdrTeamFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  managerUserId: string | null;
  memberUserIds: string[];
  territories: string[];
  industries: string[];
  capacityWeight: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SdrTeam {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    managerUserId: row.managerUserId ?? "",
    memberUserIds: row.memberUserIds,
    territories: row.territories,
    industries: row.industries,
    capacityWeight: row.capacityWeight,
    active: row.active,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function sdrAssignmentFromPrisma(row: {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  assignedSdrId: string | null;
  assignedTeamId: string | null;
  assignedById: string | null;
  assignmentMethod: string;
  assignmentReason: string;
  assignedAt: Date;
  firstTouchDueAt: Date | null;
  followUpDueAt: Date | null;
  status: string;
  reassignmentReason: string | null;
  previousOwnerId: string | null;
  slaStatus: string;
  firstTouchedAt: Date | null;
  lastTouchAt: Date | null;
  touchCount: number;
  createdAt: Date;
  updatedAt: Date;
}): SdrAssignment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId ?? "",
    contactId: row.contactId ?? "",
    assignedSdrId: row.assignedSdrId ?? "",
    assignedTeamId: row.assignedTeamId ?? undefined,
    assignedById: row.assignedById ?? "system",
    assignmentMethod: assignmentMethodValue(row.assignmentMethod),
    assignmentReason: row.assignmentReason,
    assignedAt: iso(row.assignedAt),
    firstTouchDueAt: optionalIso(row.firstTouchDueAt),
    followUpDueAt: optionalIso(row.followUpDueAt),
    status: sdrLeadStatusValue(row.status),
    reassignmentReason: row.reassignmentReason ?? undefined,
    previousOwnerId: row.previousOwnerId ?? undefined,
    slaStatus: slaStatusValue(row.slaStatus),
    firstTouchedAt: optionalIso(row.firstTouchedAt),
    lastTouchAt: optionalIso(row.lastTouchAt),
    touchCount: row.touchCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function followUpReminderFromPrisma(row: {
  id: string;
  workspaceId: string;
  assignmentId: string;
  accountId: string | null;
  contactId: string | null;
  ownerUserId: string | null;
  title: string;
  channel: string;
  dueAt: Date;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  snoozedUntil: Date | null;
}): FollowUpReminder {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    assignmentId: row.assignmentId,
    companyId: row.accountId ?? "",
    contactId: row.contactId ?? "",
    ownerUserId: row.ownerUserId ?? "",
    title: row.title,
    channel: outreachChannelValue(row.channel),
    dueAt: iso(row.dueAt),
    status: reminderStatusValue(row.status),
    createdAt: iso(row.createdAt),
    completedAt: optionalIso(row.completedAt),
    snoozedUntil: optionalIso(row.snoozedUntil)
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

function workspaceSlice<T extends { workspaceId: string }>(value: unknown, workspaceId: string): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is T => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item) && "workspaceId" in item && item.workspaceId === workspaceId;
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function rawResponseFromJson(value: unknown): Record<string, string | number | boolean | string[] | undefined> {
  const record = objectValue(value);
  const output: Record<string, string | number | boolean | string[] | undefined> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === undefined) {
      output[key] = item;
    } else if (Array.isArray(item)) {
      output[key] = stringArray(item);
    }
  }

  return output;
}

function enrichmentFieldsFromJson(value: unknown): EnrichmentFields {
  const record = objectValue(value);

  return {
    industry: stringValue(record.industry),
    employeeBand: stringValue(record.employeeBand),
    revenueBand: stringValue(record.revenueBand),
    technologies: stringArray(record.technologies),
    signals: stringArray(record.signals),
    seniority: stringValue(record.seniority),
    department: stringValue(record.department),
    directEmailCandidate: stringValue(record.directEmailCandidate),
    confidenceNote: stringValue(record.confidenceNote)
  };
}

function segmentConditionValue(value: unknown): SegmentCondition {
  const record = objectValue(value);
  const grades = stringArray(record.grades)
    .map((grade) => leadGradeValue(grade))
    .filter((grade) => grade !== "S");

  return {
    industries: stringArray(record.industries),
    titleKeywords: stringArray(record.titleKeywords),
    domainKeywords: stringArray(record.domainKeywords),
    technologyKeywords: stringArray(record.technologyKeywords),
    signalKeywords: stringArray(record.signalKeywords),
    grades: grades.length ? grades : ["A", "B", "C"],
    minScore: numberValue(record.minScore) ?? 0,
    requirePhone: booleanValue(record.requirePhone)
  };
}

function optionalPriorityValue(value: unknown): SegmentRule["priorityOverride"] {
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" || value === "S"
    ? value
    : undefined;
}

function aiRecordStatusValue(value: string): AiIcpRecommendation["status"] {
  return value === "Applied" || value === "Dismissed" || value === "Generated" ? value : "Generated";
}

function enrichmentProviderValue(value: string): EnrichmentProvider {
  if (
    value === "Syncore Apollo Local" ||
    value === "Syncore Hunter Local" ||
    value === "Syncore Web Signals Local"
  ) {
    return value;
  }

  return "Syncore Apollo Local";
}
