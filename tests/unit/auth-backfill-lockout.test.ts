import { describe, expect, it } from "vitest";

import { getDemoSession } from "@/lib/phase1/auth";
import {
  adminResetUserPassword,
  ensureAuthDefaults,
  loginWithPassword,
  seededAuthPassword
} from "@/lib/phase1/auth-service";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, User } from "@/lib/phase1/types";

// The hole this guards: any User row without an AuthAccount — a bulk import, a
// seat-handover script, a partial removal — used to be backfilled as an ACTIVE
// login with the source-committed seeded password on the next read. Backfilled
// accounts must be locked placeholders until an admin deliberately sets a
// password, which activates the seat.

function stateWithScriptCreatedUser(): { state: AppState; user: User } {
  const state = createSeedState();
  const user: User = {
    id: "user-script-created",
    name: "Script Created",
    email: "script.created@example.com",
    createdAt: new Date().toISOString()
  };
  state.users.push(user);
  state.workspaceMembers.push({
    id: "member-script-created",
    workspaceId: state.workspaces[0].id,
    userId: user.id,
    role: "SDR"
  });
  return { state, user };
}

describe("auth account backfill lockout", () => {
  it("backfills a locked Invited placeholder, never an Active seeded login", () => {
    const { state, user } = stateWithScriptCreatedUser();
    ensureAuthDefaults(state);

    const account = state.authAccounts.find((item) => item.userId === user.id);
    expect(account).toBeDefined();
    expect(account?.status).toBe("Invited");
    expect(account?.emailVerifiedAt).toBeUndefined();
    // The salt marks the origin; it must not be the seeded-password salt.
    expect(account?.passwordHash).toContain(`backfill-${user.id}`);

    expect(() =>
      loginWithPassword(state, { email: user.email, password: seededAuthPassword })
    ).toThrow();
  });

  it("keeps seed-state accounts working (dev/e2e seeding is a different path)", () => {
    const state = createSeedState();
    ensureAuthDefaults(state);
    const seeded = state.users[0];
    const result = loginWithPassword(state, { email: seeded.email, password: seededAuthPassword });
    expect(result.session.user.id).toBe(seeded.id);
  });

  it("admin password reset activates a backfilled seat", () => {
    const { state, user } = stateWithScriptCreatedUser();
    ensureAuthDefaults(state);
    const session = getDemoSession(state);

    adminResetUserPassword(state, session, { userId: user.id, newPassword: "Fresh!Password9" });
    const account = state.authAccounts.find((item) => item.userId === user.id);
    expect(account?.status).toBe("Active");

    const login = loginWithPassword(state, { email: user.email, password: "Fresh!Password9" });
    expect(login.session.user.id).toBe(user.id);
  });
});
