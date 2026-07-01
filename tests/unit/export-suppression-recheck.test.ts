import { describe, expect, it } from "vitest";
import { suppressContact } from "@/lib/phase1/compliance";
import { exportCsvForRecord, isContactCurrentlySuppressed, rowsForExport } from "@/lib/phase1/exporting";
import { createSeedState } from "@/lib/phase1/seed";

type SeedState = ReturnType<typeof createSeedState>;

function exportableContacts(state: SeedState, workspaceId: string, count: number) {
  const contacts = state.contacts.filter(
    (contact) =>
      contact.workspaceId === workspaceId && Boolean(contact.email) && !contact.isSuppressed && !contact.doNotContact
  );
  if (contacts.length < count) {
    throw new Error(`Expected at least ${count} non-suppressed seeded contacts with emails.`);
  }
  return contacts.slice(0, count);
}

function contactsExportRecord(workspaceId: string, createdById: string, recordIds: string[]) {
  // Mirrors what createExportRecord persists: recordIds are frozen at creation.
  return {
    id: "export-p2-2",
    workspaceId,
    name: "Contacts export",
    type: "contacts" as const,
    columns: ["contact", "email"],
    recordIds,
    recordCount: recordIds.length,
    createdById,
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "Ready" as const
  };
}

describe("export suppression re-check at download (P2.2)", () => {
  it("omits a contact suppressed after the export was created", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const [target, keeper] = exportableContacts(state, workspaceId, 2);
    const record = contactsExportRecord(workspaceId, "user-nora", [target.id, keeper.id]);

    // Baseline: both contacts are in the export before suppression.
    expect(rowsForExport(state, record)).toHaveLength(2);
    const csvBefore = exportCsvForRecord(state, record);
    expect(csvBefore).toContain(target.email);
    expect(csvBefore).toContain(keeper.email);

    // Suppress AFTER creation — the export's frozen recordIds still include it.
    suppressContact(target, "post-export unsubscribe");
    expect(record.recordIds).toContain(target.id);

    const after = rowsForExport(state, record);
    expect(after).toHaveLength(1);
    const csvAfter = exportCsvForRecord(state, record);
    expect(csvAfter).not.toContain(target.email);
    expect(csvAfter).toContain(keeper.email);
  });

  it("omits a contact suppressed via a workspace suppression record (email match, no contact flag)", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const [target, keeper] = exportableContacts(state, workspaceId, 2);
    const record = contactsExportRecord(workspaceId, "user-nora", [target.id, keeper.id]);

    expect(isContactCurrentlySuppressed(state, target)).toBe(false);

    state.suppressionRecords.unshift({
      id: "supp-test",
      workspaceId: target.workspaceId,
      type: "Unsubscribe",
      email: target.email,
      reason: "manual suppression import",
      source: "Compliance import",
      createdAt: "2026-06-30T00:00:00.000Z"
    });

    expect(isContactCurrentlySuppressed(state, target)).toBe(true);
    const csv = exportCsvForRecord(state, record);
    expect(csv).not.toContain(target.email);
    expect(csv).toContain(keeper.email);
  });

  it("does not affect the companies export (no suppression concept)", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const companyIds = state.companies.filter((company) => company.workspaceId === workspaceId).map((company) => company.id);
    const record = {
      id: "export-companies-p2-2",
      workspaceId,
      name: "Companies export",
      type: "companies" as const,
      columns: ["company", "domain"],
      recordIds: companyIds,
      recordCount: companyIds.length,
      createdById: "user-nora",
      createdAt: "2026-06-30T00:00:00.000Z",
      status: "Ready" as const
    };

    expect(rowsForExport(state, record)).toHaveLength(companyIds.length);
  });
});
