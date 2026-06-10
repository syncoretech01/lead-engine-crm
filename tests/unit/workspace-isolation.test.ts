import { describe, expect, it } from "vitest";
import { accountViews, contactRowsForStaging, contactViews, opportunityViews } from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";

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
});
