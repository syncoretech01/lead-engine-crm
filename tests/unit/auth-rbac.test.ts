import { describe, expect, it } from "vitest";
import {
  assertPermission,
  canUseCrmWorkspace,
  canUseDeveloperWorkspace,
  canUseLeadGenerationWorkspace,
  defaultWorkspacePath,
  resolveSession,
  rolePermissions
} from "@/lib/phase1/auth";
import { createSeedState } from "@/lib/phase1/seed";

describe("auth and RBAC session resolution", () => {
  it("uses the seeded admin session when no user or workspace is selected", () => {
    const state = createSeedState();
    const session = resolveSession(state, {});

    expect(session.user.id).toBe("user-nora");
    expect(session.workspace.id).toBe("workspace-syncore");
    expect(session.role).toBe("Admin");
    expect(session.permissions).toContain("manage_workspace");
  });

  it("resolves a selected workspace member and applies role permissions", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-ari",
      workspaceId: "workspace-syncore"
    });

    expect(session.role).toBe("SDR");
    expect(session.permissions).toContain("manage_sdr");
    expect(session.permissions).not.toContain("manage_profiles");
  });

  it("scopes SDR visibility via view_records and withholds team management", () => {
    const state = createSeedState();
    const sdr = resolveSession(state, { userId: "user-ari", workspaceId: "workspace-syncore" });
    const manager = resolveSession(state, { userId: "user-mina", workspaceId: "workspace-syncore" });

    expect(sdr.permissions).toContain("view_records");
    expect(sdr.permissions).not.toContain("view_all_records");
    expect(sdr.permissions).not.toContain("manage_sdr_team");

    expect(sdr.permissions).toContain("send_direct_outreach");
    expect(sdr.permissions).not.toContain("manage_outreach");

    expect(manager.permissions).toContain("view_all_records");
    expect(manager.permissions).toContain("manage_sdr_team");
    expect(manager.permissions).toContain("manage_outreach");
  });

  it("scopes manage_waterfalls to Admin and Manager only", () => {
    expect(rolePermissions("Admin")).toContain("manage_waterfalls");
    expect(rolePermissions("Manager")).toContain("manage_waterfalls");
    expect(rolePermissions("SDR")).not.toContain("manage_waterfalls");
    expect(rolePermissions("Data Operator")).not.toContain("manage_waterfalls");
    expect(rolePermissions("Viewer")).not.toContain("manage_waterfalls");
  });

  it("rejects users who are not members of the selected workspace", () => {
    const state = createSeedState();
    state.workspaces.push({
      ...state.workspaces[0],
      id: "workspace-locked",
      name: "Locked Workspace"
    });

    expect(() =>
      resolveSession(state, {
        userId: "user-ari",
        workspaceId: "workspace-locked"
      })
    ).toThrow(/not a member/);
  });

  it("throws when a role does not have the requested permission", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-ari",
      workspaceId: "workspace-syncore"
    });

    expect(() => assertPermission(session, "manage_profiles")).toThrow(/does not have/);
  });

  it("keeps workspace views scoped to the intended roles", () => {
    const state = createSeedState();
    const admin = resolveSession(state, {});
    const sdr = resolveSession(state, {
      userId: "user-ari",
      workspaceId: "workspace-syncore"
    });
    const manager = resolveSession(state, {
      userId: "user-mina",
      workspaceId: "workspace-syncore"
    });
    const leadOperator = resolveSession(state, {
      userId: "user-leo",
      workspaceId: "workspace-syncore"
    });

    expect(canUseDeveloperWorkspace(admin)).toBe(true);
    expect(canUseLeadGenerationWorkspace(admin)).toBe(true);
    expect(canUseCrmWorkspace(admin)).toBe(true);

    expect(canUseLeadGenerationWorkspace(sdr)).toBe(false);
    expect(canUseCrmWorkspace(sdr)).toBe(true);
    expect(canUseDeveloperWorkspace(sdr)).toBe(false);
    expect(defaultWorkspacePath(sdr)).toBe("/crm");

    expect(manager.role).toBe("Manager");
    expect(canUseLeadGenerationWorkspace(manager)).toBe(true);
    expect(canUseCrmWorkspace(manager)).toBe(true);
    expect(canUseDeveloperWorkspace(manager)).toBe(false);
    expect(defaultWorkspacePath(manager)).toBe("/");

    expect(canUseLeadGenerationWorkspace(leadOperator)).toBe(true);
    expect(canUseCrmWorkspace(leadOperator)).toBe(false);
    expect(canUseDeveloperWorkspace(leadOperator)).toBe(false);
    expect(defaultWorkspacePath(leadOperator)).toBe("/");

    expect(rolePermissions("Manager")).toContain("manage_profiles");
    expect(rolePermissions("Manager")).toContain("manage_crm");
    expect(rolePermissions("Manager")).not.toContain("manage_workspace");
    expect(rolePermissions("Data Operator")).not.toContain("manage_crm");
  });
});
