import type { ProjectionTableName } from "@/lib/phase1/persistence-projection";

export const exportWriteTables = ["exports", "auditLogs"] satisfies ProjectionTableName[];

export const exportRuleWriteTables = ["exportRules", "auditLogs"] satisfies ProjectionTableName[];

export const authWriteTables = [
  "users",
  "workspaceMembers",
  "authAccounts",
  "authSessions",
  "userInvites",
  "passwordResetTokens",
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

export const crmWriteTables = [
  "companies",
  "contacts",
  "accounts",
  "crmContacts",
  "opportunities",
  "activities",
  "tasks",
  "notes",
  "callLogs",
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
  "auditLogs"
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
