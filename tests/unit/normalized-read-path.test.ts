import { describe, expect, it } from "vitest";
import {
  accountViews,
  accountViewsFromRows,
  contactViews,
  contactViewsFromRows
} from "@/lib/phase1/queries";
import { createSeedState } from "@/lib/phase1/seed";

describe("normalized CRM read path", () => {
  it("builds account and contact list views with snapshot parity", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;

    expect(accountViewsFromRows(state, workspaceId, state.companies, state.contacts)).toEqual(
      accountViews(state, workspaceId)
    );
    expect(contactViewsFromRows(state, workspaceId, state.companies, state.contacts)).toEqual(
      contactViews(state, workspaceId)
    );
  });

  it("keeps normalized account and contact rows workspace-scoped", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";
    const companies = [
      ...state.companies,
      {
        ...state.companies[0],
        id: "company-other",
        workspaceId: otherWorkspaceId,
        name: "Other Workspace Co"
      }
    ];
    const contacts = [
      ...state.contacts,
      {
        ...state.contacts[0],
        id: "contact-other",
        workspaceId: otherWorkspaceId,
        companyId: "company-other",
        email: "other@example.com"
      }
    ];

    expect(accountViewsFromRows(state, workspaceId, companies, contacts).map((account) => account.id)).not.toContain(
      "company-other"
    );
    expect(contactViewsFromRows(state, workspaceId, companies, contacts).map((contact) => contact.id)).not.toContain(
      "contact-other"
    );
  });
});
