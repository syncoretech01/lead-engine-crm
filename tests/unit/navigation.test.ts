import { describe, expect, it } from "vitest";

import { rolePermissions } from "@/lib/phase1/auth";
import { accessibleNav, findActiveNav, resolveNavLabel } from "@/lib/navigation";
import type { Session, WorkspaceRole } from "@/lib/phase1/types";

// The navigation functions only read `role` and `permissions`, so build a
// minimal session and cast — this test intentionally does not couple to the
// full User/Workspace shape.
function sessionForRole(role: WorkspaceRole): Session {
  return { role, permissions: rolePermissions(role) } as unknown as Session;
}

// The rendered nav each role must see, by group id -> item labels (via
// resolveNavLabel, so SDR label rewrites are included). This mirrors the current
// nav config in lib/navigation.ts (SDR-first CRM ordering; the "All Contacts" /
// "Assigned Contacts" labels), including the Lead-Generation fallback for roles
// that can access no group.
const EXPECTED: Record<WorkspaceRole, Record<string, string[]>> = {
  Admin: {
    "lead-generation": [
      "Lead Dashboard",
      "Build a Lead List",
      "Search Profiles",
      "Lead Jobs",
      "Data Staging",
      "Data Quality",
      "Enrichment",
      "Waterfalls",
      "Exports"
    ],
    crm: [
      "CRM Dashboard",
      "SDR Queue",
      "Focus",
      "Assigned Contacts",
      "Accounts",
      "All Contacts",
      "Opportunities",
      "Call Log",
      "Manager Dashboard",
      "Campaigns",
      "Outreach Events"
    ],
    admin: [
      "Integration Center",
      "User Access",
      "Admin Reports",
      "Compliance Workflows",
      "AI Automation",
      "Compliance Controls"
    ]
  },
  Manager: {
    "lead-generation": [
      "Lead Dashboard",
      "Build a Lead List",
      "Search Profiles",
      "Lead Jobs",
      "Data Staging",
      "Data Quality",
      "Enrichment",
      "Waterfalls",
      "Exports"
    ],
    crm: [
      "CRM Dashboard",
      "SDR Queue",
      "Focus",
      "Assigned Contacts",
      "Accounts",
      "All Contacts",
      "Opportunities",
      "Call Log",
      "Manager Dashboard",
      "Campaigns",
      "Outreach Events"
    ]
  },
  SDR: {
    crm: ["My Day", "Focus", "My Contacts", "Accounts", "All Contacts", "Opportunities", "My Calls"]
  },
  "Data Operator": {
    "lead-generation": [
      "Lead Dashboard",
      "Build a Lead List",
      "Search Profiles",
      "Lead Jobs",
      "Data Staging",
      "Data Quality",
      "Enrichment",
      "Exports"
    ]
  },
  Viewer: {
    "lead-generation": ["Lead Dashboard"]
  },
  "Compliance Admin": {
    "lead-generation": ["Lead Dashboard", "Exports"]
  }
};

describe("navigation access model (parity with the pre-redesign shell)", () => {
  (Object.keys(EXPECTED) as WorkspaceRole[]).forEach((role) => {
    it(`shows exactly the right groups + items for ${role}`, () => {
      const session = sessionForRole(role);
      const actual: Record<string, string[]> = {};
      for (const { group, items } of accessibleNav(session)) {
        actual[group.id] = items.map((item) => resolveNavLabel(item, session));
      }
      expect(actual).toEqual(EXPECTED[role]);
    });
  });

  it("hides CRM Dashboard from SDRs but keeps Opportunities", () => {
    const crm = accessibleNav(sessionForRole("SDR")).find((entry) => entry.group.id === "crm");
    const labels = crm?.items.map((item) => item.label) ?? [];
    expect(labels).not.toContain("CRM Dashboard");
    expect(labels).toContain("Opportunities");
  });

  it("renames SDR Queue to My Day only for SDRs", () => {
    const sdr = sessionForRole("SDR");
    const sdrCrm = accessibleNav(sdr).find((entry) => entry.group.id === "crm");
    expect(sdrCrm?.items.map((item) => resolveNavLabel(item, sdr))).toContain("My Day");

    const manager = sessionForRole("Manager");
    const managerCrm = accessibleNav(manager).find((entry) => entry.group.id === "crm");
    expect(managerCrm?.items.map((item) => resolveNavLabel(item, manager))).toContain("SDR Queue");
  });

  it("hides the Admin group from every role without manage_workspace", () => {
    (["Manager", "SDR", "Data Operator", "Viewer", "Compliance Admin"] as WorkspaceRole[]).forEach((role) => {
      const nav = accessibleNav(sessionForRole(role));
      expect(nav.find((entry) => entry.group.id === "admin")).toBeUndefined();
    });
    expect(accessibleNav(sessionForRole("Admin")).find((entry) => entry.group.id === "admin")).toBeDefined();
  });

  it("resolves the most specific active item for nested routes", () => {
    const admin = sessionForRole("Admin");
    expect(findActiveNav("/reports/compliance", admin)?.item.href).toBe("/reports/compliance");
    expect(findActiveNav("/reports", admin)?.item.href).toBe("/reports");
    expect(findActiveNav("/crm/accounts/acc_123", admin)?.item.href).toBe("/crm/accounts");
    expect(findActiveNav("/crm", admin)?.item.href).toBe("/crm");
    expect(findActiveNav("/", admin)?.item.href).toBe("/");
  });
});
