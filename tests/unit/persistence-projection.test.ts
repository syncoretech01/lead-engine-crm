import { describe, expect, it } from "vitest";
import {
  createNormalizedPersistenceProjection,
  normalizedProjectionHash,
  normalizedProjectionSummary,
  syncNormalizedProjectionToPrisma
} from "@/lib/phase1/persistence-projection";
import { resolveSession } from "@/lib/phase1/auth";
import { createProviderJob } from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { createSeedState } from "@/lib/phase1/seed";

describe("normalized persistence projection", () => {
  it("projects seeded state into normalized table rows with compliance fields", () => {
    const state = createSeedState();
    const projection = createNormalizedPersistenceProjection(state);
    const summary = normalizedProjectionSummary(projection);
    const contact = projection.contacts.find((row) => row.id === state.contacts[0].id);
    const account = projection.accounts.find((row) => row.id === state.companies[0].id);
    const crmContact = projection.crmContacts.find((row) => row.id === state.contacts[0].id);
    const opportunity = projection.opportunities.find((row) => row.id === state.opportunities[0].id);
    const emailEvent = projection.emailEvents.find((row) => row.id === state.emailEvents[0].id);
    const smsEvent = projection.smsEvents.find((row) => row.id === state.smsEvents[0].id);
    const emailStep = projection.sequenceSteps.find((row) => row.channel === "Email");
    const trackedCall = projection.trackedCalls.find((row) => row.recordingConsent === "Granted");

    expect(summary.tables.workspaces).toBe(state.workspaces.length);
    expect(summary.tables.authAccounts).toBe(state.authAccounts.length);
    expect(summary.tables.authSessions).toBe(state.authSessions.length);
    expect(summary.tables.userInvites).toBe(state.userInvites.length);
    expect(summary.tables.passwordResetTokens).toBe(state.passwordResetTokens.length);
    expect(summary.tables.providerConnections).toBe(state.providerConnections.length);
    expect(summary.tables.providerCredentialAudits).toBe(state.providerCredentialAudits.length);
    expect(summary.tables.providerEncryptedSecrets).toBe(state.providerEncryptedSecrets.length);
    expect(summary.tables.providerJobs).toBe(state.providerJobs.length);
    expect(summary.tables.providerJobRuns).toBe(state.providerJobRuns.length);
    expect(summary.tables.providerUsageLedger).toBe(state.providerUsageLedger.length);
    expect(summary.tables.contacts).toBe(state.contacts.length);
    expect(summary.tables.verificationResults).toBe(state.verificationResults.length);
    expect(summary.tables.enrichmentResults).toBe(state.enrichmentResults.length);
    expect(summary.tables.segments).toBe(state.segmentRules.length);
    expect(summary.tables.recordSegments).toBe(state.recordSegments.length);
    expect(summary.tables.leadScores).toBe(state.leadScores.length);
    expect(summary.tables.accounts).toBe(state.companies.length);
    expect(summary.tables.crmContacts).toBe(state.contacts.length);
    expect(summary.tables.opportunities).toBe(state.opportunities.length);
    expect(summary.tables.activities).toBe(state.activities.length);
    expect(summary.tables.tasks).toBe(state.tasks.length);
    expect(summary.tables.notes).toBe(state.notes.length);
    expect(summary.tables.callLogs).toBe(state.callLogs.length);
    expect(summary.tables.customFields).toBe(state.customFields.length);
    expect(summary.tables.customFieldValues).toBe(state.customFieldValues.length);
    expect(summary.tables.sdrTeams).toBe(state.sdrTeams.length);
    expect(summary.tables.sdrAssignments).toBe(state.sdrAssignments.length);
    expect(summary.tables.followUpReminders).toBe(state.followUpReminders.length);
    expect(summary.tables.reassignmentRules).toBe(state.reassignmentRules.length);
    expect(summary.tables.exports).toBe(state.exports.length);
    expect(summary.tables.outreachProviders).toBe(state.outreachProviders.length);
    expect(summary.tables.emailEvents).toBe(state.emailEvents.length);
    expect(summary.tables.smsEvents).toBe(state.smsEvents.length);
    expect(summary.tables.reportSnapshots).toBe(state.reportSnapshots.length);
    expect(summary.tables.retentionPolicies).toBe(state.retentionPolicies.length);
    expect(summary.tables.retentionRuns).toBe(state.retentionRuns.length);
    expect(summary.tables.complianceChecklistItems).toBe(state.complianceChecklistItems.length);
    expect(summary.tables.deliverabilityAlerts).toBe(state.deliverabilityAlerts.length);
    expect(summary.tables.aiPersonalizations).toBe(state.aiPersonalizations.length);
    expect(summary.tables.aiReplyClassifications).toBe(state.aiReplyClassifications.length);
    expect(summary.tables.aiCallSummaries).toBe(state.aiCallSummaries.length);
    expect(summary.tables.aiLeadScorePredictions).toBe(state.aiLeadScorePredictions.length);
    expect(summary.tables.aiIcpRecommendations).toBe(state.aiIcpRecommendations.length);
    expect(summary.tables.aiDeliverabilityRecommendations).toBe(state.aiDeliverabilityRecommendations.length);
    expect(summary.tables.aiRevenueInsights).toBe(state.aiRevenueInsights.length);
    expect(summary.tables.aiAutomationRuns).toBe(state.aiAutomationRuns.length);
    expect(summary.tables.rawLeads).toBe(state.rawLeads.length);
    expect(summary.tables.normalizedRecords).toBe(state.normalizedRecords.length);
    expect(contact?.lawfulBasis).toBe(state.contacts[0].lawfulBasis);
    expect(account?.companyId).toBe(state.companies[0].id);
    expect(crmContact?.accountId).toBe(state.contacts[0].companyId);
    expect(opportunity?.accountId).toBe(state.opportunities[0].companyId);
    expect(opportunity?.expectedCloseDate).toMatch(/T00:00:00\.000Z$/);
    expect(emailEvent?.rawPayload).toMatchObject({ leadContactId: state.emailEvents[0].contactId });
    expect(smsEvent?.rawPayload).toMatchObject({ leadContactId: state.smsEvents[0].contactId });
    expect(contact?.consentStatus).toBe(state.contacts[0].consentStatus);
    expect(emailStep?.unsubscribeFooterRequired).toBe(true);
    expect(emailStep?.complianceStatus).toBe("Compliant");
    expect(trackedCall?.leadContactId).toBeTruthy();
    expect(trackedCall?.accountId).toBeTruthy();
    expect(summary.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("projects provider connection metadata without raw credentials", () => {
    const state = createSeedState();
    const projection = createNormalizedPersistenceProjection(state);
    const connection = projection.providerConnections.find((row) => row.providerId === "apollo");

    expect(projection.providerConnections).toHaveLength(20);
    expect(connection).toMatchObject({
      displayName: "Apollo",
      status: "Not configured",
      enabled: false,
      executionMode: "mock",
      secretStorage: "Not configured",
      secretVersion: 0,
      lastTestStatus: "Not tested"
    });
    expect(connection?.capabilities).toContain("discover_companies");
    expect(connection?.secretRef).toBeUndefined();
    expect(connection?.maskedSecretSuffix).toBeUndefined();
    expect(JSON.stringify(connection)).not.toMatch(/api[_-]?key|secret-value|token-value/i);
    expect(projection.providerEncryptedSecrets).toHaveLength(0);
    expect(projection.providerJobs).toHaveLength(0);
    expect(projection.providerJobRuns).toHaveLength(0);
  });

  it("projects provider job/run records without raw credentials", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      secretValue: "apollo-secret-value",
      allowedOperations: ["discover_companies"]
    });
    const created = createProviderJob(state, session, {
      providerId: "apollo",
      operation: "discover_companies",
      inputSummary: { industry: "SaaS", apiToken: "never-project-this" },
      startImmediately: true
    });
    const projection = createNormalizedPersistenceProjection(state);
    const job = projection.providerJobs.find((row) => row.id === created.job.id);
    const run = projection.providerJobRuns.find((row) => row.id === created.run.id);

    expect(job).toMatchObject({
      providerId: "apollo",
      operation: "discover_companies",
      status: "Running"
    });
    expect(run).toMatchObject({
      providerId: "apollo",
      operation: "discover_companies",
      status: "Running",
      attempt: 1
    });
    expect(JSON.stringify(job)).not.toContain("never-project-this");
    expect(JSON.stringify(run)).not.toContain("never-project-this");
  });

  it("produces deterministic hashes and changes when projected state changes", () => {
    const state = createSeedState();
    const first = createNormalizedPersistenceProjection(state);
    const second = createNormalizedPersistenceProjection(state);
    const firstHash = normalizedProjectionHash(first);

    expect(firstHash).toBe(normalizedProjectionHash(second));

    state.contacts[0].consentSource = "Unit test source update";
    const changed = createNormalizedPersistenceProjection(state);
    expect(normalizedProjectionHash(changed)).not.toBe(firstHash);
  });

  it("mirrors projection rows through prisma-like delegates", async () => {
    const state = createSeedState();
    const summary = normalizedProjectionSummary(createNormalizedPersistenceProjection(state));
    const calls = { deletes: 0, upserts: 0 };
    const client = new Proxy({}, {
      get() {
        return {
          deleteMany: async () => {
            calls.deletes += 1;
          },
          upsert: async () => {
            calls.upserts += 1;
          }
        };
      }
    });
    const result = await syncNormalizedProjectionToPrisma(state, client);
    const projectedRows = Object.values(summary.tables).reduce((total, count) => total + count, 0);

    expect(result.skippedTables).toEqual([]);
    expect(calls.upserts).toBe(projectedRows);
    expect(calls.deletes).toBeGreaterThan(0);
    expect(result.hash).toBe(summary.hash);
  });

  it("can mirror only requested normalized tables for selected write paths", async () => {
    const state = createSeedState();
    const projection = createNormalizedPersistenceProjection(state);
    const touchedDelegates = new Set<string>();
    const client = new Proxy({}, {
      get(_target, property) {
        return {
          deleteMany: async () => {
            touchedDelegates.add(`${String(property)}.deleteMany`);
          },
          upsert: async () => {
            touchedDelegates.add(`${String(property)}.upsert`);
          }
        };
      }
    });

    const result = await syncNormalizedProjectionToPrisma(state, client, {
      tables: ["exports", "emailEvents", "auditLogs"]
    });

    expect(result.syncedTables).toEqual(["exports", "emailEvents", "auditLogs"]);
    expect(result.skippedTables).toEqual([]);
    expect(touchedDelegates).toEqual(new Set([
      "auditLog.deleteMany",
      "emailEvent.deleteMany",
      "export.deleteMany",
      "export.upsert",
      "emailEvent.upsert",
      "auditLog.upsert"
    ]));
    expect(result.tables.exports).toBe(projection.exports.length);
    expect(result.tables.emailEvents).toBe(projection.emailEvents.length);
  });

  it("can mirror only provider credential tables for integration settings writes", async () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      secretValue: "apollo-secret-value"
    });
    const touchedDelegates = new Set<string>();
    const client = new Proxy({}, {
      get(_target, property) {
        return {
          deleteMany: async () => {
            touchedDelegates.add(`${String(property)}.deleteMany`);
          },
          upsert: async () => {
            touchedDelegates.add(`${String(property)}.upsert`);
          }
        };
      }
    });

    const result = await syncNormalizedProjectionToPrisma(state, client, {
      tables: ["providerConnections", "providerCredentialAudits", "providerEncryptedSecrets", "auditLogs"]
    });

    expect(result.syncedTables).toEqual([
      "providerConnections",
      "providerCredentialAudits",
      "providerEncryptedSecrets",
      "auditLogs"
    ]);
    expect(result.skippedTables).toEqual([]);
    expect(touchedDelegates).toEqual(new Set([
      "auditLog.deleteMany",
      "providerEncryptedSecret.deleteMany",
      "providerCredentialAudit.deleteMany",
      "providerConnection.deleteMany",
      "providerConnection.upsert",
      "providerCredentialAudit.upsert",
      "providerEncryptedSecret.upsert",
      "auditLog.upsert"
    ]));
  });

  it("can mirror only provider job tables for provider execution writes", async () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret",
      allowedOperations: ["verify_email"]
    });
    createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "nora@syncore.tech" }
    });
    const touchedDelegates = new Set<string>();
    const client = new Proxy({}, {
      get(_target, property) {
        return {
          deleteMany: async () => {
            touchedDelegates.add(`${String(property)}.deleteMany`);
          },
          upsert: async () => {
            touchedDelegates.add(`${String(property)}.upsert`);
          }
        };
      }
    });

    const result = await syncNormalizedProjectionToPrisma(state, client, {
      tables: ["providerJobs", "providerJobRuns", "providerUsageLedger", "auditLogs"]
    });

    expect(result.syncedTables).toEqual(["providerJobs", "providerJobRuns", "providerUsageLedger", "auditLogs"]);
    expect(result.skippedTables).toEqual([]);
    expect(touchedDelegates).toEqual(new Set([
      "auditLog.deleteMany",
      "providerUsageLedger.deleteMany",
      "providerJobRun.deleteMany",
      "providerJob.deleteMany",
      "providerJob.upsert",
      "providerJobRun.upsert",
      "providerUsageLedger.upsert",
      "auditLog.upsert"
    ]));
  });
});
