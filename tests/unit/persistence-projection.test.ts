import { describe, expect, it } from "vitest";
import {
  createNormalizedPersistenceProjection,
  normalizedProjectionHash,
  normalizedProjectionSummary,
  syncNormalizedProjectionToPrisma
} from "@/lib/phase1/persistence-projection";
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
    expect(summary.tables.contacts).toBe(state.contacts.length);
    expect(summary.tables.accounts).toBe(state.companies.length);
    expect(summary.tables.crmContacts).toBe(state.contacts.length);
    expect(summary.tables.opportunities).toBe(state.opportunities.length);
    expect(summary.tables.activities).toBe(state.activities.length);
    expect(summary.tables.tasks).toBe(state.tasks.length);
    expect(summary.tables.notes).toBe(state.notes.length);
    expect(summary.tables.callLogs).toBe(state.callLogs.length);
    expect(summary.tables.exports).toBe(state.exports.length);
    expect(summary.tables.emailEvents).toBe(state.emailEvents.length);
    expect(summary.tables.smsEvents).toBe(state.smsEvents.length);
    expect(summary.tables.rawLeads).toBe(state.rawLeads.length);
    expect(summary.tables.normalizedRecords).toBe(state.normalizedRecords.length);
    expect(contact?.lawfulBasis).toBe(state.contacts[0].lawfulBasis);
    expect(account?.companyId).toBe(state.companies[0].id);
    expect(crmContact?.accountId).toBe(state.contacts[0].companyId);
    expect(opportunity?.accountId).toBe(state.opportunities[0].companyId);
    expect(emailEvent?.rawPayload).toMatchObject({ leadContactId: state.emailEvents[0].contactId });
    expect(smsEvent?.rawPayload).toMatchObject({ leadContactId: state.smsEvents[0].contactId });
    expect(contact?.consentStatus).toBe(state.contacts[0].consentStatus);
    expect(emailStep?.unsubscribeFooterRequired).toBe(true);
    expect(emailStep?.complianceStatus).toBe("Compliant");
    expect(trackedCall?.leadContactId).toBeTruthy();
    expect(trackedCall?.accountId).toBeTruthy();
    expect(summary.hash).toMatch(/^[a-f0-9]{64}$/);
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
});
