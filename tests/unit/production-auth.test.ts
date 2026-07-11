import { describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import {
  createSignedAuthSessionCookie,
  hashPassword,
  verifyPassword,
  verifySignedAuthSessionCookie
} from "@/lib/phase1/auth-security";
import {
  acceptUserInvite,
  createUserInvite,
  deactivateUserAccount,
  loginWithPassword,
  seededAuthPassword,
  updateMemberRole
} from "@/lib/phase1/auth-service";
import { createSeedState } from "@/lib/phase1/seed";

describe("production auth", () => {
  it("hashes passwords and signs session cookies", () => {
    const hash = hashPassword("StrongPassword!2026", "fixed-test-salt");
    const payload = {
      sessionId: "auth-session-test",
      userId: "user-nora",
      workspaceId: "workspace-syncore",
      expiresAt: "2099-01-01T00:00:00.000Z"
    };
    const cookie = createSignedAuthSessionCookie(payload, {
      SYNCORE_AUTH_SECRET: "unit-test-secret"
    });

    expect(hash).not.toContain("StrongPassword!2026");
    expect(verifyPassword("StrongPassword!2026", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifySignedAuthSessionCookie(cookie, { SYNCORE_AUTH_SECRET: "unit-test-secret" })).toEqual(payload);
    expect(verifySignedAuthSessionCookie(`${cookie}tampered`, { SYNCORE_AUTH_SECRET: "unit-test-secret" })).toBeUndefined();
  });

  it("logs in seeded users with a signed session record and no demo selector", () => {
    const state = createSeedState();
    const result = loginWithPassword(state, {
      email: "nora@syncore.tech",
      password: seededAuthPassword,
      now: "2026-06-16T12:00:00.000Z"
    });

    expect(result.session.user.id).toBe("user-nora");
    expect(result.session.authSessionId).toBeTruthy();
    expect(result.cookieValue).toContain(".");
    expect(state.authSessions).toHaveLength(1);
    expect(state.authAccounts.find((account) => account.userId === "user-nora")?.lastLoginAt).toBe("2026-06-16T12:00:00.000Z");
  });

  it("creates and accepts invites with hashed tokens and assigned roles", () => {
    const state = createSeedState();
    const admin = resolveSession(state, { userId: "user-nora", workspaceId: "workspace-syncore" });
    const invite = createUserInvite(state, admin, {
      email: "new.sdr@syncore.tech",
      role: "SDR",
      now: "2026-06-16T12:00:00.000Z"
    });

    expect(state.userInvites[0].tokenHash).not.toBe(invite.token);
    const accepted = acceptUserInvite(state, {
      token: invite.token,
      name: "New SDR",
      password: "InvitedUser!2026",
      now: "2026-06-16T12:05:00.000Z"
    });

    expect(accepted.session.role).toBe("SDR");
    expect(state.userInvites[0].status).toBe("Accepted");
    expect(state.authAccounts.some((account) => account.email === "new.sdr@syncore.tech" && account.status === "Active")).toBe(true);
  });

  // Password reset now runs entirely through the native Prisma fast paths
  // (createPasswordResetTokenPrismaFast / resetPasswordWithTokenPrismaFast); the
  // blob reset helpers were removed with the passwordResetTokens peel. Native
  // reset-flow coverage lives in tests/integration/auth-native-fast-paths.test.ts.

  it("updates roles and disables accounts with session revocation", () => {
    const state = createSeedState();
    const admin = resolveSession(state, { userId: "user-nora", workspaceId: "workspace-syncore" });
    const ariLogin = loginWithPassword(state, {
      email: "ari@syncore.tech",
      password: seededAuthPassword
    });

    updateMemberRole(state, admin, { userId: "user-ari", role: "Manager" });
    deactivateUserAccount(state, admin, "user-ari");

    expect(state.workspaceMembers.find((member) => member.userId === "user-ari")?.role).toBe("Manager");
    expect(state.authAccounts.find((account) => account.userId === "user-ari")?.status).toBe("Disabled");
    expect(state.authSessions.find((session) => session.id === ariLogin.session.authSessionId)?.revokedAt).toBeTruthy();
  });
});
