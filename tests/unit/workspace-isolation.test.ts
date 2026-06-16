import { describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import { exportCsvForRecord, rowsForExport } from "@/lib/phase1/exporting";
import { createProviderJob, providerJobSnapshot, startProviderJobRun } from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { accountViews, contactRowsForStaging, contactViews, opportunityViews } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";
import { recordFirstTouch } from "@/lib/phase1/sdr";
import { workspaceStoragePath } from "@/lib/phase1/tenant-isolation";
import { processEmailWebhook } from "@/lib/phase1/webhooks";

describe("workspace-scoped query helpers", () => {
  it("filters CRM and staging views by workspace", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.workspaces.push({
      ...state.workspaces[0],
      id: otherWorkspaceId,
      name: "Other Workspace"
    });

    state.companies.push({
      ...state.companies[0],
      id: "company-other",
      workspaceId: otherWorkspaceId,
      name: "Other Workspace Co"
    });
    state.contacts.push({
      ...state.contacts[0],
      id: "contact-other",
      workspaceId: otherWorkspaceId,
      companyId: "company-other",
      email: "other@example.com"
    });
    state.opportunities.push({
      ...state.opportunities[0],
      id: "opp-other",
      workspaceId: otherWorkspaceId,
      companyId: "company-other",
      contactId: "contact-other",
      name: "Other workspace deal"
    });
    state.normalizedRecords.push({
      ...state.normalizedRecords[0],
      id: "norm-other",
      workspaceId: otherWorkspaceId,
      rawLeadId: "raw-other",
      email: "other@example.com"
    });

    expect(accountViews(state, workspaceId).map((account) => account.id)).not.toContain("company-other");
    expect(contactViews(state, workspaceId).map((contact) => contact.id)).not.toContain("contact-other");
    expect(opportunityViews(state, workspaceId).map((opportunity) => opportunity.id)).not.toContain("opp-other");
    expect(contactRowsForStaging(state, workspaceId).map((row) => row.id)).not.toContain("norm-other");
  });

  it("does not render export rows from another workspace even if record IDs are injected", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const { otherContact } = addSecondWorkspace(state);
    const exportRecord = {
      id: "export-cross-tenant",
      workspaceId,
      name: "Cross tenant guard",
      type: "contacts" as const,
      columns: ["contact", "email"],
      recordIds: [state.contacts[0].id, otherContact.id],
      recordCount: 2,
      createdById: state.users[0].id,
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "Ready" as const
    };

    const rows = rowsForExport(state, exportRecord);
    const csv = exportCsvForRecord(state, exportRecord);

    expect(rows).toHaveLength(1);
    expect(csv).toContain(state.contacts[0].email);
    expect(csv).not.toContain(otherContact.email);
  });

  it("rejects signed webhook payloads that point at another workspace contact", () => {
    const state = createSeedState();
    const { otherWorkspaceId, otherUserId } = addSecondWorkspace(state);
    const currentContact = state.contacts.find((contact) => contact.workspaceId === state.workspaces[0].id);
    const otherActor = state.users.find((user) => user.id === otherUserId);

    if (!currentContact || !otherActor) {
      throw new Error("Expected seeded contacts and second workspace actor.");
    }

    expect(() =>
      processEmailWebhook(
        state,
        {
          workspaceId: otherWorkspaceId,
          contactId: currentContact.id,
          eventType: "Opened",
          providerEventId: "evt-cross-tenant"
        },
        otherActor
      )
    ).toThrow(/Webhook contact not found in workspace/);
  });

  it("rejects SDR action helper IDs from another workspace", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const { otherWorkspaceId, otherUserId, otherContact, otherCompany } = addSecondWorkspace(state);
    const sourceAssignment = state.sdrAssignments[0];

    state.sdrAssignments.push({
      ...sourceAssignment,
      id: "assignment-other",
      workspaceId: otherWorkspaceId,
      companyId: otherCompany.id,
      contactId: otherContact.id,
      assignedSdrId: otherUserId,
      assignedById: otherUserId
    });

    expect(() =>
      recordFirstTouch(state, {
        workspaceId,
        assignmentId: "assignment-other",
        actorUserId: state.users[0].id,
        channel: "Email",
        outcome: "Contacted",
        notes: "Should not cross tenants."
      })
    ).toThrow(/SDR assignment not found in workspace/);
  });

  it("keeps provider job IDs scoped to the active workspace", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const { otherWorkspaceId } = addSecondWorkspace(state);
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      secretValue: "apollo-secret",
      allowedOperations: ["discover_companies"]
    });
    const { job, run } = createProviderJob(state, session, {
      providerId: "apollo",
      operation: "discover_companies",
      inputSummary: { segment: "SaaS" }
    });

    expect(providerJobSnapshot(state, otherWorkspaceId, job.id).job).toBeUndefined();
    expect(() => startProviderJobRun(state, run.id, otherWorkspaceId)).toThrow(/Provider job run not found/);
  });

  it("stores generated file paths under a sanitized workspace prefix", () => {
    const path = workspaceStoragePath("workspace-syncore", "../recordings", "call.mp3");

    expect(path.startsWith("workspaces/workspace-syncore/")).toBe(true);
    expect(path).not.toContain("../");
    expect(path).not.toContain("..\\");
  });
});

function addSecondWorkspace(state: ReturnType<typeof createSeedState>) {
  const otherWorkspaceId = "workspace-other";
  const otherUserId = "user-other-admin";
  const otherCompany = {
    ...state.companies[0],
    id: "company-other",
    workspaceId: otherWorkspaceId,
    name: "Other Workspace Co",
    domain: "other.example.com",
    website: "https://other.example.com"
  };
  const otherContact = {
    ...state.contacts[0],
    id: "contact-other",
    workspaceId: otherWorkspaceId,
    companyId: otherCompany.id,
    name: "Other Contact",
    email: "other@example.com",
    owner: "Other Admin"
  };

  state.workspaces.push({
    ...state.workspaces[0],
    id: otherWorkspaceId,
    name: "Other Workspace"
  });
  state.users.push({
    id: otherUserId,
    name: "Other Admin",
    email: "other-admin@example.com",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  state.workspaceMembers.push({
    id: "member-other-admin",
    workspaceId: otherWorkspaceId,
    userId: otherUserId,
    role: "Admin"
  });
  state.companies.push(otherCompany);
  state.contacts.push(otherContact);

  return { otherWorkspaceId, otherUserId, otherCompany, otherContact };
}
