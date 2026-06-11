import type { ProjectionTableName } from "@/lib/phase1/persistence-projection";

export const exportWriteTables = ["exports", "auditLogs"] satisfies ProjectionTableName[];

export const outreachEmailWriteTables = [
  "contacts",
  "crmContacts",
  "suppressionRecords",
  "outreachCampaigns",
  "emailEvents",
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const outreachSmsWriteTables = [
  "contacts",
  "crmContacts",
  "suppressionRecords",
  "outreachCampaigns",
  "smsEvents",
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
  "activities",
  "auditLogs"
] satisfies ProjectionTableName[];

export const providerConnectionWriteTables = [
  "providerConnections",
  "providerCredentialAudits",
  "auditLogs"
] satisfies ProjectionTableName[];
