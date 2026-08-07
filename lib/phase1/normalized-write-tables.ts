import type { ProjectionTableName } from "@/lib/phase1/persistence-projection";

export const exportWriteTables = ["exports", "auditLogs"] satisfies ProjectionTableName[];

export const exportRuleWriteTables = ["exportRules", "auditLogs"] satisfies ProjectionTableName[];

export const authWriteTables = [
  "users",
  "workspaceMembers",
  "authAccounts",
  "authSessions",
  "userInvites",
  "auditLogs"
] satisfies ProjectionTableName[];

export const leadGenerationWriteTables = [
  "searchProfiles",
  "leadJobs",
  "asyncJobRuns",
  "jobLogs",
  "jobIdempotencyRecords",
  "rawLeads",
  "normalizedRecords",
  "companies",
  "contacts",
  "verificationResults",
  "dedupeMatches",
  "providerUsageLedger",
  "auditLogs"
] satisfies ProjectionTableName[];

export const enrichmentWriteTables = [
  "companies",
  "contacts",
  "verificationResults",
  "enrichmentResults",
  "fieldSources",
  "providerCache",
  "segments",
  "recordSegments",
  "leadScores",
  "providerMetricsDaily",
  "providerUsageLedger",
  "auditLogs"
] satisfies ProjectionTableName[];

export const leadJobWorkerWriteTables = [
  "searchProfiles",
  "leadJobs",
  "asyncJobRuns",
  "jobLogs",
  "jobIdempotencyRecords",
  "rawLeads",
  "normalizedRecords",
  "companies",
  "contacts",
  "verificationResults",
  "dedupeMatches",
  "enrichmentResults",
  "fieldSources",
  "providerCache",
  "segments",
  "recordSegments",
  "leadScores",
  "providerMetricsDaily",
  "providerUsageLedger",
  "customFields",
  "customFieldValues",
  "auditLogs"
] satisfies ProjectionTableName[];

export const crmWriteTables = [
  "companies",
  "contacts",
  "accounts",
  "crmContacts",
  "opportunities",
  "activities",
  "tasks",
  "customFields",
  "customFieldValues",
  "auditLogs"
] satisfies ProjectionTableName[];

export const sdrWriteTables = [
  "companies",
  "contacts",
  "accounts",
  "crmContacts",
  "activities",
  "tasks",
  "sdrTeams",
  "sdrAssignments",
  "followUpReminders",
  "reassignmentRules",
  "sdrCallingSessions",
  "auditLogs"
] satisfies ProjectionTableName[];

// The Focus cockpit's hot path. A wrap-up changes only these projected domains;
// notes are Prisma-native and are flushed separately by writeStateToPrisma.
// Keeping this list narrow avoids diffing unrelated CRM/SDR configuration rows
// while the SDR is waiting to advance to the next lead.
export const callWrapupWriteTables = [
  "contacts",
  "opportunities",
  "activities",
  "tasks",
  "sdrAssignments",
  "followUpReminders",
  "trackedCalls",
  "sdrCallingSessions",
  "auditLogs"
] satisfies ProjectionTableName[];

export const sdrDailyReportWriteTables = [
  "sdrDailyReports"
] satisfies ProjectionTableName[];

export const reportingWriteTables = [
  "reportSnapshots",
  "retentionPolicies",
  "retentionRuns",
  "auditLogs"
] satisfies ProjectionTableName[];

export const complianceWriteTables = [
  "contacts",
  "crmContacts",
  "suppressionRecords",
  "verificationResults",
  "dataSubjectRequests",
  "complianceChecklistItems",
  "deliverabilityAlerts",
  "auditLogs"
] satisfies ProjectionTableName[];

export const aiWriteTables = [
  "searchProfiles",
  "companies",
  "contacts",
  "crmContacts",
  "activities",
  "leadScores",
  "outreachProviders",
  "emailEvents",
  "smsEvents",
  "trackedCalls",
  "aiPersonalizations",
  "aiReplyClassifications",
  "aiCallSummaries",
  "aiLeadScorePredictions",
  "aiIcpRecommendations",
  "aiDeliverabilityRecommendations",
  "aiRevenueInsights",
  "aiAutomationRuns",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachEmailWriteTables = [
  "contacts",
  "crmContacts",
  "suppressionRecords",
  "tasks",
  "sdrAssignments",
  "followUpReminders",
  "outreachCampaigns",
  "emailEvents",
  "webhookEvents",
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachSetupWriteTables = [
  "outreachProviders",
  "outreachCampaigns",
  "campaignSequences",
  "sequenceSteps",
  "deliverabilityAlerts",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachSmsWriteTables = [
  "contacts",
  "crmContacts",
  "suppressionRecords",
  "outreachCampaigns",
  "smsEvents",
  "webhookEvents",
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachTrackedCallWriteTables = [
  "trackedCalls",
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachCampaignSendWriteTables = [
  "outreachCampaigns",
  "emailEvents",
  "webhookEvents",
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const providerConnectionWriteTables = [
  "providerConnections",
  "providerCredentialAudits",
  "providerEncryptedSecrets",
  "auditLogs"
] satisfies ProjectionTableName[];

export const providerJobWriteTables = [
  "providerJobs",
  "providerJobRuns",
  "providerMetricsDaily",
  "providerUsageLedger",
  "auditLogs"
] satisfies ProjectionTableName[];

export const waterfallTemplateWriteTables = [
  "waterfallTemplates",
  "auditLogs"
] satisfies ProjectionTableName[];

export const snapshotOnlyWriteTables = ["auditLogs"] satisfies ProjectionTableName[];
