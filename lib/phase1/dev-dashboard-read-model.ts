import { domainReadCache } from "@/lib/phase1/domain-read-cache";
import { createFastState } from "@/lib/phase1/fast-read-utils";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AiAutomationRun,
  AiCallSummary,
  AiDeliverabilityRecommendation,
  AiIcpRecommendation,
  AiLeadScorePrediction,
  AiPersonalization,
  AiReplyClassification,
  AiRevenueInsight,
  AppState,
  AuthAccount,
  AuthSessionRecord,
  AuditLog,
  CampaignSequence,
  Company,
  ComplianceChecklistItem,
  Contact,
  DataSubjectRequest,
  DeliverabilityAlert,
  EmailEvent,
  EnrichmentResult,
  ExportRecord,
  LeadJob,
  NormalizedRecord,
  Opportunity,
  OutreachCampaign,
  OutreachProvider,
  ProviderCacheEntry,
  ProviderConnection,
  ProviderCredentialAudit,
  ProviderUsageLedger,
  RawLead,
  ReportSnapshot,
  RetentionPolicy,
  RetentionRun,
  SdrAssignment,
  Session,
  SmsEvent,
  SuppressionRecord,
  TrackedCall,
  User,
  UserInvite,
  VerificationResult,
  WorkspaceMember
} from "@/lib/phase1/types";
import type { PrismaClient } from "@prisma/client";

const STATE_SNAPSHOT_ID = "syncore-primary-state";

type DevSettingsSnapshotSlices = {
  users: User[];
  workspaceMembers: WorkspaceMember[];
  authAccounts: AuthAccount[];
  authSessions: AuthSessionRecord[];
  userInvites: UserInvite[];
  providerConnections: ProviderConnection[];
  providerCredentialAudits: ProviderCredentialAudit[];
  suppressionRecords: SuppressionRecord[];
  auditLogs: AuditLog[];
  retentionPolicies: RetentionPolicy[];
};

type DevReportsSnapshotSlices = DevSettingsSnapshotSlices & {
  rawLeads: RawLead[];
  normalizedRecords: NormalizedRecord[];
  companies: Company[];
  contacts: Contact[];
  verificationResults: VerificationResult[];
  sdrAssignments: SdrAssignment[];
  opportunities: Opportunity[];
  activities: AppState["activities"];
  leadJobs: LeadJob[];
  dataSubjectRequests: DataSubjectRequest[];
  reportSnapshots: ReportSnapshot[];
  deliverabilityAlerts: DeliverabilityAlert[];
  complianceChecklistItems: ComplianceChecklistItem[];
  retentionRuns: RetentionRun[];
  emailEvents: EmailEvent[];
  smsEvents: SmsEvent[];
  trackedCalls: TrackedCall[];
  exports: ExportRecord[];
  enrichmentResults: EnrichmentResult[];
  providerCache: ProviderCacheEntry[];
  outreachProviders: OutreachProvider[];
  outreachCampaigns: OutreachCampaign[];
  campaignSequences: CampaignSequence[];
  providerUsageLedger: ProviderUsageLedger[];
};

type DevAutomationSnapshotSlices = {
  users: User[];
  contacts: Contact[];
  companies: Company[];
  outreachCampaigns: OutreachCampaign[];
  trackedCalls: TrackedCall[];
  aiPersonalizations: AiPersonalization[];
  aiReplyClassifications: AiReplyClassification[];
  aiCallSummaries: AiCallSummary[];
  aiLeadScorePredictions: AiLeadScorePrediction[];
  aiIcpRecommendations: AiIcpRecommendation[];
  aiDeliverabilityRecommendations: AiDeliverabilityRecommendation[];
  aiRevenueInsights: AiRevenueInsight[];
  aiAutomationRuns: AiAutomationRun[];
};

export const readFastDevSettingsState = domainReadCache(readFastDevSettingsStateUncached);
export const readFastDevReportsState = domainReadCache(readFastDevReportsStateUncached);
export const readFastDevAutomationState = domainReadCache(readFastDevAutomationStateUncached);

async function readFastDevSettingsStateUncached(
  session: Session,
  workspaceId: string
): Promise<AppState | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const slices = await readSettingsSnapshotSlices(prisma, workspaceId, session);
  return createFastState(session, slices);
}

async function readFastDevReportsStateUncached(
  session: Session,
  workspaceId: string
): Promise<AppState | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const slices = await readReportsSnapshotSlices(prisma, workspaceId, session);
  return createFastState(session, slices);
}

async function readFastDevAutomationStateUncached(
  session: Session,
  workspaceId: string
): Promise<AppState | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const slices = await readAutomationSnapshotSlices(prisma, workspaceId, session);
  return createFastState(session, slices);
}

async function readSettingsSnapshotSlices(
  prisma: Pick<PrismaClient, "$queryRaw">,
  workspaceId: string,
  session: Session
): Promise<DevSettingsSnapshotSlices> {
  const rows = await prisma.$queryRaw<Array<Record<keyof DevSettingsSnapshotSlices, unknown>>>`
    SELECT
      "state"->'users' AS "users",
      "state"->'workspaceMembers' AS "workspaceMembers",
      "state"->'authAccounts' AS "authAccounts",
      "state"->'authSessions' AS "authSessions",
      "state"->'userInvites' AS "userInvites",
      "state"->'providerConnections' AS "providerConnections",
      "state"->'providerCredentialAudits' AS "providerCredentialAudits",
      "state"->'suppressionRecords' AS "suppressionRecords",
      "state"->'auditLogs' AS "auditLogs",
      "state"->'retentionPolicies' AS "retentionPolicies"
    FROM "AppStateSnapshot"
    WHERE "id" = ${STATE_SNAPSHOT_ID}
    LIMIT 1
  `;
  const row = rows[0];
  return settingsSlicesFromRow(row, workspaceId, session);
}

async function readReportsSnapshotSlices(
  prisma: Pick<PrismaClient, "$queryRaw">,
  workspaceId: string,
  session: Session
): Promise<DevReportsSnapshotSlices> {
  const rows = await prisma.$queryRaw<Array<Record<keyof DevReportsSnapshotSlices, unknown>>>`
    SELECT
      "state"->'users' AS "users",
      "state"->'workspaceMembers' AS "workspaceMembers",
      "state"->'authAccounts' AS "authAccounts",
      "state"->'authSessions' AS "authSessions",
      "state"->'userInvites' AS "userInvites",
      "state"->'providerConnections' AS "providerConnections",
      "state"->'providerCredentialAudits' AS "providerCredentialAudits",
      "state"->'suppressionRecords' AS "suppressionRecords",
      "state"->'auditLogs' AS "auditLogs",
      "state"->'retentionPolicies' AS "retentionPolicies",
      "state"->'rawLeads' AS "rawLeads",
      "state"->'normalizedRecords' AS "normalizedRecords",
      "state"->'companies' AS "companies",
      "state"->'contacts' AS "contacts",
      "state"->'verificationResults' AS "verificationResults",
      "state"->'sdrAssignments' AS "sdrAssignments",
      "state"->'opportunities' AS "opportunities",
      "state"->'activities' AS "activities",
      "state"->'leadJobs' AS "leadJobs",
      "state"->'dataSubjectRequests' AS "dataSubjectRequests",
      "state"->'reportSnapshots' AS "reportSnapshots",
      "state"->'deliverabilityAlerts' AS "deliverabilityAlerts",
      "state"->'complianceChecklistItems' AS "complianceChecklistItems",
      "state"->'retentionRuns' AS "retentionRuns",
      "state"->'emailEvents' AS "emailEvents",
      "state"->'smsEvents' AS "smsEvents",
      "state"->'trackedCalls' AS "trackedCalls",
      "state"->'exports' AS "exports",
      "state"->'enrichmentResults' AS "enrichmentResults",
      "state"->'providerCache' AS "providerCache",
      "state"->'outreachProviders' AS "outreachProviders",
      "state"->'outreachCampaigns' AS "outreachCampaigns",
      "state"->'campaignSequences' AS "campaignSequences",
      "state"->'providerUsageLedger' AS "providerUsageLedger"
    FROM "AppStateSnapshot"
    WHERE "id" = ${STATE_SNAPSHOT_ID}
    LIMIT 1
  `;
  const row = rows[0];
  const settings = settingsSlicesFromRow(row, workspaceId, session);

  return {
    ...settings,
    rawLeads: workspaceSlice<RawLead>(row?.rawLeads, workspaceId),
    normalizedRecords: workspaceSlice<NormalizedRecord>(row?.normalizedRecords, workspaceId),
    companies: workspaceSlice<Company>(row?.companies, workspaceId),
    contacts: workspaceSlice<Contact>(row?.contacts, workspaceId),
    verificationResults: workspaceSlice<VerificationResult>(row?.verificationResults, workspaceId),
    sdrAssignments: workspaceSlice<SdrAssignment>(row?.sdrAssignments, workspaceId),
    opportunities: workspaceSlice<Opportunity>(row?.opportunities, workspaceId),
    activities: workspaceSlice<AppState["activities"][number]>(row?.activities, workspaceId),
    leadJobs: workspaceSlice<LeadJob>(row?.leadJobs, workspaceId),
    dataSubjectRequests: workspaceSlice<DataSubjectRequest>(row?.dataSubjectRequests, workspaceId),
    reportSnapshots: workspaceSlice<ReportSnapshot>(row?.reportSnapshots, workspaceId),
    deliverabilityAlerts: workspaceSlice<DeliverabilityAlert>(row?.deliverabilityAlerts, workspaceId),
    complianceChecklistItems: workspaceSlice<ComplianceChecklistItem>(row?.complianceChecklistItems, workspaceId),
    retentionRuns: workspaceSlice<RetentionRun>(row?.retentionRuns, workspaceId),
    emailEvents: workspaceSlice<EmailEvent>(row?.emailEvents, workspaceId),
    smsEvents: workspaceSlice<SmsEvent>(row?.smsEvents, workspaceId),
    trackedCalls: workspaceSlice<TrackedCall>(row?.trackedCalls, workspaceId),
    exports: workspaceSlice<ExportRecord>(row?.exports, workspaceId),
    enrichmentResults: workspaceSlice<EnrichmentResult>(row?.enrichmentResults, workspaceId),
    providerCache: workspaceSlice<ProviderCacheEntry>(row?.providerCache, workspaceId),
    outreachProviders: workspaceSlice<OutreachProvider>(row?.outreachProviders, workspaceId),
    outreachCampaigns: workspaceSlice<OutreachCampaign>(row?.outreachCampaigns, workspaceId),
    campaignSequences: workspaceSlice<CampaignSequence>(row?.campaignSequences, workspaceId),
    providerUsageLedger: workspaceSlice<ProviderUsageLedger>(row?.providerUsageLedger, workspaceId)
  };
}

async function readAutomationSnapshotSlices(
  prisma: Pick<PrismaClient, "$queryRaw">,
  workspaceId: string,
  session: Session
): Promise<DevAutomationSnapshotSlices> {
  const rows = await prisma.$queryRaw<Array<Record<keyof DevAutomationSnapshotSlices | "workspaceMembers", unknown>>>`
    SELECT
      "state"->'users' AS "users",
      "state"->'workspaceMembers' AS "workspaceMembers",
      "state"->'contacts' AS "contacts",
      "state"->'companies' AS "companies",
      "state"->'outreachCampaigns' AS "outreachCampaigns",
      "state"->'trackedCalls' AS "trackedCalls",
      "state"->'aiPersonalizations' AS "aiPersonalizations",
      "state"->'aiReplyClassifications' AS "aiReplyClassifications",
      "state"->'aiCallSummaries' AS "aiCallSummaries",
      "state"->'aiLeadScorePredictions' AS "aiLeadScorePredictions",
      "state"->'aiIcpRecommendations' AS "aiIcpRecommendations",
      "state"->'aiDeliverabilityRecommendations' AS "aiDeliverabilityRecommendations",
      "state"->'aiRevenueInsights' AS "aiRevenueInsights",
      "state"->'aiAutomationRuns' AS "aiAutomationRuns"
    FROM "AppStateSnapshot"
    WHERE "id" = ${STATE_SNAPSHOT_ID}
    LIMIT 1
  `;
  const row = rows[0];
  const workspaceMembers = workspaceSlice<WorkspaceMember>(row?.workspaceMembers, workspaceId);

  return {
    users: usersForMembers(row?.users, workspaceMembers, session),
    contacts: workspaceSlice<Contact>(row?.contacts, workspaceId),
    companies: workspaceSlice<Company>(row?.companies, workspaceId),
    outreachCampaigns: workspaceSlice<OutreachCampaign>(row?.outreachCampaigns, workspaceId),
    trackedCalls: workspaceSlice<TrackedCall>(row?.trackedCalls, workspaceId),
    aiPersonalizations: workspaceSlice<AiPersonalization>(row?.aiPersonalizations, workspaceId),
    aiReplyClassifications: workspaceSlice<AiReplyClassification>(row?.aiReplyClassifications, workspaceId),
    aiCallSummaries: workspaceSlice<AiCallSummary>(row?.aiCallSummaries, workspaceId),
    aiLeadScorePredictions: workspaceSlice<AiLeadScorePrediction>(row?.aiLeadScorePredictions, workspaceId),
    aiIcpRecommendations: workspaceSlice<AiIcpRecommendation>(row?.aiIcpRecommendations, workspaceId),
    aiDeliverabilityRecommendations: workspaceSlice<AiDeliverabilityRecommendation>(row?.aiDeliverabilityRecommendations, workspaceId),
    aiRevenueInsights: workspaceSlice<AiRevenueInsight>(row?.aiRevenueInsights, workspaceId),
    aiAutomationRuns: workspaceSlice<AiAutomationRun>(row?.aiAutomationRuns, workspaceId)
  };
}

function workspaceSlice<T extends { workspaceId: string }>(value: unknown, workspaceId: string): T[] {
  return arraySlice<T>(value).filter((item) => item.workspaceId === workspaceId);
}

function settingsSlicesFromRow(
  row: Partial<Record<keyof DevSettingsSnapshotSlices, unknown>> | undefined,
  workspaceId: string,
  session: Session
): DevSettingsSnapshotSlices {
  const workspaceMembers = workspaceSlice<WorkspaceMember>(row?.workspaceMembers, workspaceId);
  const users = usersForMembers(row?.users, workspaceMembers, session);
  const userIds = new Set(users.map((user) => user.id));

  return {
    users,
    workspaceMembers,
    authAccounts: userSlice<AuthAccount>(row?.authAccounts, userIds),
    authSessions: workspaceSlice<AuthSessionRecord>(row?.authSessions, workspaceId),
    userInvites: workspaceSlice<UserInvite>(row?.userInvites, workspaceId),
    providerConnections: workspaceSlice<ProviderConnection>(row?.providerConnections, workspaceId),
    providerCredentialAudits: workspaceSlice<ProviderCredentialAudit>(row?.providerCredentialAudits, workspaceId),
    suppressionRecords: workspaceSlice<SuppressionRecord>(row?.suppressionRecords, workspaceId),
    auditLogs: workspaceSlice<AuditLog>(row?.auditLogs, workspaceId),
    retentionPolicies: workspaceSlice<RetentionPolicy>(row?.retentionPolicies, workspaceId)
  };
}

function userSlice<T extends { userId: string }>(value: unknown, userIds: Set<string>): T[] {
  return arraySlice<T>(value).filter((item) => userIds.has(item.userId));
}

function usersForMembers(value: unknown, members: WorkspaceMember[], session: Session): User[] {
  const memberUserIds = new Set(members.map((member) => member.userId));
  memberUserIds.add(session.user.id);
  const users = arraySlice<User>(value).filter((user) => memberUserIds.has(user.id));
  return users.some((user) => user.id === session.user.id) ? users : [session.user, ...users];
}

function arraySlice<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}
