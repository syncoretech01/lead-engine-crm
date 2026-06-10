import { describe, expect, it } from "vitest";
import { assertPermission, resolveSession } from "@/lib/phase1/auth";
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
});
