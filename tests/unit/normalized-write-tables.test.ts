import { describe, expect, it } from "vitest";
import { createNormalizedPersistenceProjection } from "@/lib/phase1/persistence-projection";
import {
  aiWriteTables,
  authWriteTables,
  complianceWriteTables,
  crmWriteTables,
  enrichmentWriteTables,
  exportRuleWriteTables,
  exportWriteTables,
  leadGenerationWriteTables,
  outreachCampaignSendWriteTables,
  outreachEmailWriteTables,
  outreachSetupWriteTables,
  outreachSmsWriteTables,
  outreachTrackedCallWriteTables,
  providerConnectionWriteTables,
  providerJobWriteTables,
  reportingWriteTables,
  sdrWriteTables,
  waterfallTemplateWriteTables
} from "@/lib/phase1/normalized-write-tables";
import { createSeedState } from "@/lib/phase1/seed";

const scopedWriteTableGroups = {
  aiWriteTables,
  authWriteTables,
  complianceWriteTables,
  crmWriteTables,
  enrichmentWriteTables,
  exportRuleWriteTables,
  exportWriteTables,
  leadGenerationWriteTables,
  outreachCampaignSendWriteTables,
  outreachEmailWriteTables,
  outreachSetupWriteTables,
  outreachSmsWriteTables,
  outreachTrackedCallWriteTables,
  providerConnectionWriteTables,
  providerJobWriteTables,
  reportingWriteTables,
  sdrWriteTables,
  waterfallTemplateWriteTables
};

describe("normalized write table scopes", () => {
  it("only references projected normalized table names", () => {
    const projectedTableNames = new Set(Object.keys(createNormalizedPersistenceProjection(createSeedState())));

    for (const [groupName, tables] of Object.entries(scopedWriteTableGroups)) {
      expect(tables.length, groupName).toBeGreaterThan(0);
      for (const table of tables) {
        expect(projectedTableNames.has(table), `${groupName}.${table}`).toBe(true);
      }
    }
  });

  it("keeps each scope unique and auditable", () => {
    for (const [groupName, tables] of Object.entries(scopedWriteTableGroups)) {
      expect(new Set(tables).size, groupName).toBe(tables.length);
      expect(tables, groupName).toContain("auditLogs");
    }
  });

  it("assigns major Phase 6 workflow categories to the expected normalized tables", () => {
    expect(leadGenerationWriteTables).toEqual(expect.arrayContaining([
      "searchProfiles",
      "leadJobs",
      "rawLeads",
      "normalizedRecords",
      "asyncJobRuns",
      "jobLogs",
      "jobIdempotencyRecords",
      "companies",
      "contacts",
      "verificationResults",
      "dedupeMatches"
    ]));
    expect(enrichmentWriteTables).toEqual(expect.arrayContaining([
      "fieldSources",
      "providerCache",
      "providerMetricsDaily"
    ]));
    expect(crmWriteTables).toEqual(expect.arrayContaining([
      "accounts",
      "crmContacts",
      "opportunities",
      "activities",
      "tasks",
      "notes",
      "callLogs",
      "customFields"
    ]));
    expect(sdrWriteTables).toEqual(expect.arrayContaining([
      "sdrTeams",
      "sdrAssignments",
      "followUpReminders",
      "reassignmentRules"
    ]));
    expect(complianceWriteTables).toEqual(expect.arrayContaining([
      "suppressionRecords",
      "dataSubjectRequests",
      "complianceChecklistItems",
      "deliverabilityAlerts"
    ]));
    expect(providerJobWriteTables).toEqual(expect.arrayContaining([
      "providerJobs",
      "providerJobRuns",
      "providerMetricsDaily",
      "providerUsageLedger"
    ]));
    expect(outreachEmailWriteTables).toContain("webhookEvents");
    expect(outreachSmsWriteTables).toContain("webhookEvents");
    expect(outreachCampaignSendWriteTables).toContain("webhookEvents");
    expect(exportRuleWriteTables).toEqual(["exportRules", "auditLogs"]);
    expect(waterfallTemplateWriteTables).toEqual(["waterfallTemplates", "auditLogs"]);
    expect(authWriteTables).toEqual(expect.arrayContaining([
      "users",
      "workspaceMembers",
      "authAccounts",
      "authSessions",
      "userInvites",
      "passwordResetTokens"
    ]));
  });
});
