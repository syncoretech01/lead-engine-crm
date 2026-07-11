import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Native auth admin fast paths (blob-migration Phase 1, step 1).
 *
 * updateMemberRole / adminResetPassword / updateUserTelephony now write identity
 * rows straight to Prisma instead of mutating the AppState blob + projecting. This
 * exercises each against real Postgres: the native row changes, the read-time merge
 * (mergePrismaIdentityRows) surfaces it back into the blob so blob-reading UIs like
 * /access stay correct, and the snapshot itself is never rewritten.
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI `integration` job / local
 * docker-compose.dev.yml); otherwise skipped so the unit lane needs no DB.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const SNAPSHOT_ID = "syncore-primary-state";

// The fast paths resolve the current session from the auth cookie via
// getPrismaSession → next/headers cookies(). Mock cookies() so the test can present
// a real signed session cookie (created per test) for a seeded Admin.
const authCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "syncore_auth_session" && authCookie.value ? { value: authCookie.value } : undefined
  })
}));

describe.skipIf(!enabled)("native auth admin fast paths", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";
  process.env.SYNCORE_AUTH_SECRET = process.env.SYNCORE_AUTH_SECRET ?? "integration-auth-secret";

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("updateMemberRolePrismaFast: native write, surfaced via merge, no blob write", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { readState } = await import("@/lib/phase1/store");
    const { updateMemberRolePrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { admin, target } = await seedAndAuthenticate();

    const before = await readSnapshotMeta();
    const result = await updateMemberRolePrismaFast({ userId: target.userId, role: "Manager" });
    expect(result).toBe(true);

    // Native row updated.
    const nativeMember = await prisma.workspaceMember.findUniqueOrThrow({ where: { id: target.id } });
    expect(nativeMember.role).toBe("MANAGER");

    // Merge surfaces it on read.
    const state = await readState();
    expect(state.workspaceMembers.find((m) => m.id === target.id)?.role).toBe("Manager");

    // Native audit row written; snapshot untouched.
    const audit = await prisma.auditLog.findFirst({
      where: { objectType: "workspace_member", objectId: target.id, action: "role_updated" }
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(admin.userId);

    const after = await readSnapshotMeta();
    expect(after.writeSeq).toBe(before.writeSeq);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("adminResetPasswordPrismaFast: rehashes password + revokes the target's sessions", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { adminResetPasswordPrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { admin, target } = await seedAndAuthenticate();

    // A live session for the target that the reset must revoke.
    const liveSession = await prisma.authSession.create({
      data: {
        id: `auth-session-live-${target.userId}`,
        userId: target.userId,
        workspaceId: admin.workspaceId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
        lastSeenAt: new Date()
      }
    });
    const beforeHash = (
      await prisma.authAccount.findUniqueOrThrow({ where: { userId: target.userId } })
    ).passwordHash;

    const result = await adminResetPasswordPrismaFast({ userId: target.userId, newPassword: "BrandNewPass99" });
    expect(result?.name).toBe(target.userName);

    const account = await prisma.authAccount.findUniqueOrThrow({ where: { userId: target.userId } });
    expect(account.passwordHash).not.toBe(beforeHash);
    expect(account.failedLoginCount).toBe(0);

    const revoked = await prisma.authSession.findUniqueOrThrow({ where: { id: liveSession.id } });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("adminResetPasswordPrismaFast: rejects a too-short password and a self-reset", async () => {
    const { adminResetPasswordPrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { admin, target } = await seedAndAuthenticate();

    await expect(
      adminResetPasswordPrismaFast({ userId: target.userId, newPassword: "short" })
    ).rejects.toThrow(/at least/);
    await expect(
      adminResetPasswordPrismaFast({ userId: admin.userId, newPassword: "BrandNewPass99" })
    ).rejects.toThrow(/Settings page/);
  });

  it("updateUserTelephonyPrismaFast: encrypts the JWT + surfaces telephony via merge", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { readState } = await import("@/lib/phase1/store");
    const { updateUserTelephonyPrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { target } = await seedAndAuthenticate();

    const before = await readSnapshotMeta();
    const rawJwt = "test.jwt.value";
    const result = await updateUserTelephonyPrismaFast({
      userId: target.userId,
      phoneNumber: "+15551230000",
      callerId: "+15559990000",
      jwt: rawJwt
    });
    expect(result).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(user.ringCentralPhoneNumber).toBe("+15551230000");
    expect(user.ringCentralCallerId).toBe("+15559990000");
    expect(user.ringCentralJwt).toBeTruthy();
    expect(user.ringCentralJwt).not.toBe(rawJwt); // encrypted at rest

    // The /access page reads telephony off the blob state.users — the merge must surface it.
    const state = await readState();
    const blobUser = state.users.find((u) => u.id === target.userId);
    expect(blobUser?.ringCentralPhoneNumber).toBe("+15551230000");
    expect(blobUser?.ringCentralCallerId).toBe("+15559990000");
    expect(blobUser?.ringCentralJwt).toBeTruthy();

    const after = await readSnapshotMeta();
    expect(after.writeSeq).toBe(before.writeSeq);
  });

  it("createUserInvitePrismaFast: creates a native pending invite + returns url/workspace", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { createUserInvitePrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { admin } = await seedAndAuthenticate();

    const before = await readSnapshotMeta();
    const result = await createUserInvitePrismaFast({ email: "New.Invitee@example.com", role: "SDR" });
    expect(result?.url).toMatch(/^\/invite\//);
    expect(result?.workspaceId).toBe(admin.workspaceId);
    expect(result?.workspaceName).toBeTruthy();

    const invite = await prisma.userInvite.findFirstOrThrow({
      where: { workspaceId: admin.workspaceId, email: "new.invitee@example.com" }
    });
    expect(invite.status).toBe("Pending");
    expect(invite.role).toBe("SDR");
    expect(invite.invitedById).toBe(admin.userId);

    const audit = await prisma.auditLog.findFirst({
      where: { objectType: "user_invite", objectId: invite.id, action: "created" }
    });
    expect(audit).not.toBeNull();

    const after = await readSnapshotMeta();
    expect(after.writeSeq).toBe(before.writeSeq);
  });

  it("deactivateUserPrismaFast: disables the account, revokes sessions, surfaces via merge, blocks self", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { readState } = await import("@/lib/phase1/store");
    const { deactivateUserPrismaFast } = await import("@/lib/phase1/auth-fast-path");
    const { admin, target } = await seedAndAuthenticate();

    const liveSession = await prisma.authSession.create({
      data: {
        id: `auth-session-live-deact-${target.userId}`,
        userId: target.userId,
        workspaceId: admin.workspaceId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(),
        lastSeenAt: new Date()
      }
    });

    const result = await deactivateUserPrismaFast({ userId: target.userId });
    expect(result).toBe(true);

    const account = await prisma.authAccount.findUniqueOrThrow({ where: { userId: target.userId } });
    expect(account.status).toBe("Disabled");

    const revoked = await prisma.authSession.findUniqueOrThrow({ where: { id: liveSession.id } });
    expect(revoked.revokedAt).not.toBeNull();

    // Merge surfaces the disabled status on read (authAccounts merge).
    const state = await readState();
    expect(state.authAccounts.find((a) => a.userId === target.userId)?.status).toBe("Disabled");

    // Cannot deactivate your own account.
    await expect(deactivateUserPrismaFast({ userId: admin.userId })).rejects.toThrow(/your own account/);
  });

  it("returns undefined in file-driver mode so the caller falls back to the blob path", async () => {
    const previous = process.env.SYNCORE_STORAGE_DRIVER;
    process.env.SYNCORE_STORAGE_DRIVER = "file";
    try {
      const { updateMemberRolePrismaFast } = await import("@/lib/phase1/auth-fast-path");
      expect(await updateMemberRolePrismaFast({ userId: "whoever", role: "Manager" })).toBeUndefined();
    } finally {
      process.env.SYNCORE_STORAGE_DRIVER = previous;
    }
  });
});

// Reset to seeded state, pick a seeded Admin actor + an SDR target, and install a
// real signed session cookie for the actor (upserted so it survives the reset wipe).
async function seedAndAuthenticate() {
  const { resetStore, readState } = await import("@/lib/phase1/store");
  const { prisma } = await import("@/lib/prisma");
  const { createSignedAuthSessionCookie } = await import("@/lib/phase1/auth-security");

  await resetStore();
  await readState(); // settle migrateState so the snapshot is in steady state

  const admin = await prisma.workspaceMember.findFirstOrThrow({ where: { role: "ADMIN" } });
  const target = await prisma.workspaceMember.findFirstOrThrow({
    where: { role: "SDR", workspaceId: admin.workspaceId },
    include: { user: true }
  });

  const sessionId = `auth-session-actor-${admin.userId}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.authSession.upsert({
    where: { id: sessionId },
    update: { revokedAt: null, expiresAt, lastSeenAt: new Date() },
    create: {
      id: sessionId,
      userId: admin.userId,
      workspaceId: admin.workspaceId,
      expiresAt,
      createdAt: new Date(),
      lastSeenAt: new Date()
    }
  });
  authCookie.value = createSignedAuthSessionCookie({
    sessionId,
    userId: admin.userId,
    workspaceId: admin.workspaceId,
    expiresAt: expiresAt.toISOString()
  });

  return {
    admin: { userId: admin.userId, workspaceId: admin.workspaceId },
    target: { id: target.id, userId: target.userId, userName: target.user.name }
  };
}

async function readSnapshotMeta() {
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.appStateSnapshot.findUniqueOrThrow({
    where: { id: SNAPSHOT_ID },
    select: { updatedAt: true, writeSeq: true }
  });
  return { writeSeq: row.writeSeq, updatedAt: row.updatedAt.getTime() };
}
