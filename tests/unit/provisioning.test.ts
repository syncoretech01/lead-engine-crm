import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/phase1/auth-security";
import { createProvisionedState, type ProvisionAccountInput } from "@/lib/phase1/provisioning";

function team(): ProvisionAccountInput[] {
  return [
    { name: "Owner", email: "owner@acme.com", role: "Admin", superadmin: true, passwordHash: hashPassword("owner-pw") },
    { name: "Manager", email: "mgr@acme.com", role: "Manager", passwordHash: hashPassword("mgr-pw") },
    { name: "SDR One", email: "sdr1@acme.com", role: "SDR", passwordHash: hashPassword("sdr1-pw") },
    { name: "SDR Two", email: "sdr2@acme.com", role: "SDR", passwordHash: hashPassword("sdr2-pw") }
  ];
}

describe("createProvisionedState", () => {
  it("builds a clean workspace with the real team and no demo data", () => {
    const state = createProvisionedState({ workspace: { name: "Acme Outbound" }, accounts: team() });

    expect(state.version).toBe(15);
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe("Acme Outbound");
    expect(state.workspaces[0].id).toBe("workspace-acme-outbound");

    // Real accounts, no leftover demo records.
    expect(state.users).toHaveLength(4);
    expect(state.workspaceMembers.map((m) => m.role).sort()).toEqual(["Admin", "Manager", "SDR", "SDR"]);
    expect(state.contacts).toHaveLength(0);
    expect(state.companies).toHaveLength(0);
    expect(state.leadJobs).toHaveLength(0);
    expect(state.opportunities).toHaveLength(0);
    expect(state.users.some((u) => u.email.endsWith("@syncore.tech"))).toBe(false);
  });

  it("creates active auth accounts with the supplied password hashes and superadmin flag", () => {
    const accounts = team();
    const state = createProvisionedState({ workspace: { name: "Acme" }, accounts });

    expect(state.authAccounts).toHaveLength(4);
    for (const account of state.authAccounts) {
      expect(account.status).toBe("Active");
      expect(account.passwordHash.startsWith("scrypt$")).toBe(true);
    }
    const owner = state.authAccounts.find((a) => a.email === "owner@acme.com");
    expect(owner?.superadmin).toBe(true);
    expect(verifyPassword("owner-pw", owner!.passwordHash)).toBe(true);
    expect(state.authAccounts.filter((a) => a.superadmin)).toHaveLength(1);
  });

  it("seeds structural defaults so the workspace is immediately usable", () => {
    const state = createProvisionedState({ workspace: { name: "Acme" }, accounts: team() });
    const workspaceId = state.workspaces[0].id;

    expect(state.providerConnections.length).toBeGreaterThan(0);
    expect(state.exportRules.length).toBeGreaterThan(0);
    expect(state.segmentRules.length).toBeGreaterThan(0);
    expect(state.providerConnections.every((c) => c.workspaceId === workspaceId)).toBe(true);
    expect(state.exportRules.every((r) => r.workspaceId === workspaceId)).toBe(true);
  });

  it("rejects a team with no Admin", () => {
    const accounts = team().map((a) => ({ ...a, role: "SDR" as const }));
    expect(() => createProvisionedState({ workspace: { name: "Acme" }, accounts })).toThrow(/Admin/);
  });

  it("rejects duplicate emails", () => {
    const accounts = team();
    accounts[1].email = "owner@acme.com";
    expect(() => createProvisionedState({ workspace: { name: "Acme" }, accounts })).toThrow(/Duplicate/);
  });

  it("rejects an empty account list", () => {
    expect(() => createProvisionedState({ workspace: { name: "Acme" }, accounts: [] })).toThrow(/At least one account/);
  });
});
