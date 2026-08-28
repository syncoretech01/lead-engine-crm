import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  acceptUserInvite,
  assertPasswordPolicy,
  createUserInvite,
  loginWithPassword
} from "@/lib/phase1/auth-service";
import { getDemoSession } from "@/lib/phase1/auth";
import { createSeedState } from "@/lib/phase1/seed";

/**
 * Invite acceptance and token reset enforced the minimum password length only
 * through the form's minLength attribute, so a direct POST — curl, or a browser
 * with the attribute stripped — could set a one-character password on a
 * production account. Every path that sets a password now shares one assertion.
 */
describe("password policy", () => {
  it("rejects anything under the minimum and accepts at the boundary", () => {
    expect(() => assertPasswordPolicy("")).toThrow(/at least/);
    expect(() => assertPasswordPolicy("a")).toThrow(/at least/);
    expect(() => assertPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(/at least/);
    expect(() => assertPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it("blocks a short password at invite acceptance, before any account is written", () => {
    const state = createSeedState();
    const session = getDemoSession(state);
    const { token } = createUserInvite(state, session, { email: "newhire@example.com", role: "SDR" });
    const accountsBefore = state.authAccounts.length;

    expect(() => acceptUserInvite(state, { token, name: "New Hire", password: "x" })).toThrow(/at least/);
    // Nothing partially applied: no account, and the invite is still usable.
    expect(state.authAccounts.length).toBe(accountsBefore);
    expect(state.userInvites.find((invite) => invite.email === "newhire@example.com")?.status).toBe("Pending");
  });

  it("still accepts a compliant password at invite acceptance", () => {
    const state = createSeedState();
    const session = getDemoSession(state);
    const { token } = createUserInvite(state, session, { email: "newhire2@example.com", role: "SDR" });

    const result = acceptUserInvite(state, { token, name: "New Hire", password: "Str0ng!Passphrase" });
    expect(result.session.user.email).toBe("newhire2@example.com");
    expect(
      loginWithPassword(state, { email: "newhire2@example.com", password: "Str0ng!Passphrase" }).session.user.email
    ).toBe("newhire2@example.com");
  });
});
