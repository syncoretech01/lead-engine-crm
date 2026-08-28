import { randomUUID } from "node:crypto";
import type { $Enums, Prisma, PrismaClient } from "@prisma/client";
import {
  assertPermission,
  rolePermissions,
  workspaceRoleFromPrisma,
  workspaceRoleToPrisma
} from "@/lib/phase1/auth";
import {
  MANAGER_TRANSFER_PROVIDER,
  normalizeTransferNumber,
  parseTransferContacts
} from "@/lib/phase1/manager-transfer-contacts";
import {
  createSignedAuthSessionCookie,
  defaultAuthSessionMaxAgeSeconds,
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
  verifySignedAuthSessionCookie
} from "@/lib/phase1/auth-security";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import {
  MAX_SIGNATURE_LENGTH,
  MIN_PASSWORD_LENGTH,
  isValidTimezone,
  type AuthLoginResult,
  type AuthTokenResult
} from "@/lib/phase1/auth-service";
import { encryptSecretString } from "@/lib/phase1/secret-box";
import type { Session, WorkspaceRole } from "@/lib/phase1/types";

type LoginInput = {
  email: string;
  password: string;
  workspaceId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type AcceptInviteInput = {
  token: string;
  name: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
};

type LogoutInput = {
  cookieValue?: string;
  ipAddress?: string;
  userAgent?: string;
};

type PasswordResetRequestInput = {
  email: string;
};

type PasswordResetInput = {
  token: string;
  password: string;
};

type PrismaAuthAccountWithUser = {
  id: string;
  userId: string;
  email: string;
  passwordHash: string;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  superadmin: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
  };
};

type PrismaWorkspaceMembership = {
  role: string;
  workspace: {
    id: string;
    name: string;
    market: string | null;
    seats: number;
    health: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

type PrismaAuthClient = PrismaClient | Prisma.TransactionClient;

export async function loginWithPasswordPrismaFast(input: LoginInput): Promise<AuthLoginResult | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const now = new Date();
  const account = await prisma.authAccount.findUnique({
    where: { email: normalizeEmail(input.email) },
    include: { user: true }
  });
  const genericMessage = "Invalid email or password.";

  if (!account || account.status !== "Active") {
    throw new Error(genericMessage);
  }
  if (account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) {
    throw new Error("Account is temporarily locked. Try again later.");
  }
  if (!verifyPassword(input.password, account.passwordHash)) {
    await registerFailedLogin(account.id, account.failedLoginCount, now);
    throw new Error(genericMessage);
  }

  const membership = await findMembership(account.userId, input.workspaceId);
  if (!membership) {
    throw new Error("User is not a workspace member.");
  }

  return prisma.$transaction((tx) => createSessionForAccount(tx, account, membership, {
    now,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  }));
}

export async function acceptInvitePrismaFast(input: AcceptInviteInput): Promise<AuthLoginResult | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const now = new Date();
  const tokenHash = hashToken(input.token);
  const genericMessage = "Invite is invalid or expired.";

  return prisma.$transaction(async (tx) => {
    const invite = await tx.userInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.status !== "Pending" || invite.expiresAt.getTime() <= now.getTime()) {
      throw new Error(genericMessage);
    }

    const email = normalizeEmail(invite.email);
    const user = await tx.user.upsert({
      where: { email },
      update: {
        name: input.name.trim() || invite.email.split("@")[0]
      },
      create: {
        id: `user-${randomUUID()}`,
        email,
        name: input.name.trim() || invite.email.split("@")[0]
      }
    });

    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: invite.workspaceId,
          userId: user.id
        }
      },
      update: { role: invite.role },
      create: {
        id: `member-${randomUUID()}`,
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role
      }
    });

    await tx.authAccount.upsert({
      where: { userId: user.id },
      update: {
        email,
        passwordHash: hashPassword(input.password),
        status: "Active",
        emailVerifiedAt: now,
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null
      },
      create: {
        id: `auth-${randomUUID()}`,
        userId: user.id,
        email,
        passwordHash: hashPassword(input.password),
        status: "Active",
        emailVerifiedAt: now,
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        mfaEnabled: false,
        superadmin: false
      }
    });

    await tx.userInvite.update({
      where: { id: invite.id },
      data: { status: "Accepted", acceptedAt: now }
    });

    await tx.auditLog.create({
      data: {
        id: `audit-${randomUUID()}`,
        workspaceId: invite.workspaceId,
        actorUserId: user.id,
        objectType: "user_invite",
        objectId: invite.id,
        action: "accepted",
        createdAt: now
      }
    });

    const account = await tx.authAccount.findUnique({
      where: { userId: user.id },
      include: { user: true }
    });
    const membership = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invite.workspaceId,
          userId: user.id
        }
      },
      include: { workspace: true }
    });

    if (!account || !membership) {
      throw new Error(genericMessage);
    }

    return createSessionForAccount(tx, account, membership, {
      now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });
  });
}

export async function revokeAuthSessionPrismaFast(input: LogoutInput): Promise<boolean | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const payload = verifySignedAuthSessionCookie(input.cookieValue);
  if (!payload) {
    return false;
  }

  const { prisma } = await import("@/lib/prisma");
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const session = await tx.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        revokedAt: null
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true
      }
    });

    if (!session) {
      return false;
    }

    await tx.authSession.update({
      where: { id: session.id },
      data: {
        revokedAt: now,
        lastSeenAt: now
      }
    });
    await tx.auditLog.create({
      data: {
        id: `audit-${randomUUID()}`,
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        objectType: "auth_session",
        objectId: session.id,
        action: "logout",
        reason: "Session revoked",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        createdAt: now
      }
    });

    return true;
  });
}

export async function createPasswordResetTokenPrismaFast(
  input: PasswordResetRequestInput
): Promise<AuthTokenResult | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const email = normalizeEmail(input.email);
  const account = await prisma.authAccount.findUnique({
    where: { email },
    select: {
      id: true,
      userId: true,
      status: true
    }
  });

  if (!account || account.status !== "Active") {
    return undefined;
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: account.userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });

  if (!membership) {
    return undefined;
  }

  const now = new Date();
  const token = randomToken();
  const resetId = `reset-${randomUUID()}`;

  await prisma.$transaction([
    prisma.passwordResetToken.create({
      data: {
        id: resetId,
        userId: account.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdAt: now
      }
    }),
    prisma.auditLog.create({
      data: {
        id: `audit-${randomUUID()}`,
        workspaceId: membership.workspaceId,
        actorUserId: account.userId,
        objectType: "password_reset_token",
        objectId: resetId,
        action: "created",
        reason: "Password reset requested",
        createdAt: now
      }
    })
  ]);

  return { token, url: `/reset-password/${token}` };
}

export async function resetPasswordWithTokenPrismaFast(input: PasswordResetInput): Promise<boolean | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const now = new Date();
  const genericMessage = "Reset link is invalid or expired.";

  return prisma.$transaction(async (tx) => {
    const reset = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true
      }
    });

    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= now.getTime()) {
      throw new Error(genericMessage);
    }

    const account = await tx.authAccount.findUnique({
      where: { userId: reset.userId },
      select: {
        id: true,
        status: true
      }
    });

    if (!account || account.status !== "Active") {
      throw new Error(genericMessage);
    }

    const membership = await tx.workspaceMember.findFirst({
      where: { userId: reset.userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true }
    });

    if (!membership) {
      throw new Error(genericMessage);
    }

    await tx.authAccount.update({
      where: { id: account.id },
      data: {
        passwordHash: hashPassword(input.password),
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now
      }
    });
    await tx.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: now }
    });
    await tx.authSession.updateMany({
      where: {
        userId: reset.userId,
        revokedAt: null
      },
      data: {
        revokedAt: now,
        lastSeenAt: now
      }
    });
    await tx.auditLog.create({
      data: {
        id: `audit-${randomUUID()}`,
        workspaceId: membership.workspaceId,
        actorUserId: reset.userId,
        objectType: "auth_account",
        objectId: account.id,
        action: "password_reset",
        createdAt: now
      }
    });

    return true;
  });
}

// --- Post-auth admin fast paths (blob-migration Phase 1) --------------------
// These mirror the blob helpers in auth-service.ts (updateMemberRole,
// adminResetUserPassword, updateUserTelephony) but write the identity rows
// directly to Prisma so they no longer round-trip through the AppState blob +
// projection. Each returns `undefined` ONLY in file-driver mode, so the server
// action falls back to the blob path; in prisma mode it always resolves or
// throws (matching the blob helper's error messages verbatim so the callers'
// try/catch redirects are unchanged).

export async function updateMemberRolePrismaFast(input: {
  userId: string;
  role: WorkspaceRole;
}): Promise<boolean | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: session.workspace.id, userId: input.userId }
      }
    });
    if (!member) {
      throw new Error("Workspace member not found.");
    }
    const oldRole = workspaceRoleFromPrisma(member.role);
    await tx.workspaceMember.update({
      where: { id: member.id },
      data: { role: workspaceRoleToPrisma(input.role) as $Enums.WorkspaceRole }
    });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "workspace_member",
        objectId: member.id,
        action: "role_updated",
        oldValue: { role: oldRole },
        newValue: { role: input.role }
      },
      now
    );
  });

  return true;
}

export async function adminResetPasswordPrismaFast(input: {
  userId: string;
  newPassword: string;
}): Promise<{ name: string } | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  if (input.userId === session.user.id) {
    throw new Error("Use your own Settings page to change your password.");
  }
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: session.workspace.id, userId: input.userId }
      },
      include: { user: true }
    });
    if (!member) {
      throw new Error("That user is not a member of this workspace.");
    }
    const account = await tx.authAccount.findUnique({ where: { userId: input.userId } });
    if (!account) {
      throw new Error("That user's account could not be found.");
    }

    await tx.authAccount.update({
      where: { id: account.id },
      data: {
        passwordHash: hashPassword(input.newPassword),
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        // Admin-set password activates the seat (mirrors invite acceptance and the
        // blob path in auth-service.ts — keep the two in step). This is also the
        // recovery route for the locked "Invited" placeholders ensureAuthDefaults
        // backfills for script-created users. The token-based self-serve reset
        // deliberately does NOT do this — it requires an Active account.
        status: "Active",
        updatedAt: now
      }
    });
    // Force the target to re-authenticate everywhere with the new password.
    await tx.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now, lastSeenAt: now }
    });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "auth_account",
        objectId: account.id,
        action: "password_reset_by_admin",
        newValue: { targetUserId: input.userId }
      },
      now
    );

    return { name: member.user.name };
  });
}

export async function updateUserTelephonyPrismaFast(input: {
  userId: string;
  phoneNumber: string;
  callerId: string;
  jwt: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<boolean | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: session.workspace.id, userId: input.userId }
      },
      include: { user: true }
    });
    if (!member) {
      throw new Error("Workspace member not found.");
    }
    const user = member.user;
    // Audit records only whether a JWT is present, never the secret itself.
    const oldValue = {
      ringCentralPhoneNumber: user.ringCentralPhoneNumber ?? undefined,
      ringCentralCallerId: user.ringCentralCallerId ?? undefined,
      hasJwt: Boolean(user.ringCentralJwt)
    };
    const nextPhone = input.phoneNumber.trim() || null;
    const nextCallerId = input.callerId.trim() || null;
    const jwt = input.jwt.trim();
    const data: Prisma.UserUncheckedUpdateInput = {
      ringCentralPhoneNumber: nextPhone,
      ringCentralCallerId: nextCallerId
    };
    if (jwt) {
      // A pasted JWT replaces the stored one (encrypted at rest). Blank keeps the
      // existing JWT so an admin can edit the number without re-pasting the key.
      const clientId = input.clientId?.trim() ?? "";
      const clientSecret = input.clientSecret?.trim() ?? "";
      const payload = clientId || clientSecret ? JSON.stringify({ jwt, clientId, clientSecret }) : jwt;
      data.ringCentralJwt = encryptSecretString(payload);
    }
    await tx.user.update({ where: { id: user.id }, data });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "user",
        objectId: user.id,
        action: "telephony_updated",
        oldValue,
        newValue: {
          ringCentralPhoneNumber: nextPhone ?? undefined,
          ringCentralCallerId: nextCallerId ?? undefined,
          hasJwt: jwt ? true : oldValue.hasJwt
        }
      },
      now
    );
  });

  return true;
}

// Standalone "Transfer to manager" lines (no CRM login) — stored per-workspace on
// the generic Integration config row. manage_workspace-gated, Prisma-native.
export async function addManagerTransferContactPrismaFast(input: {
  name: string;
  phoneNumber: string;
}): Promise<boolean | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const name = input.name.trim();
  const phoneNumber = normalizeTransferNumber(input.phoneNumber);
  if (!name || !phoneNumber) {
    throw new Error("A manager name and phone number are both required.");
  }
  const workspaceId = session.workspace.id;
  const existing = await prisma.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER } },
    select: { config: true }
  });
  const contacts = parseTransferContacts(existing?.config);
  contacts.push({ id: `line-${randomUUID()}`, name, phoneNumber });
  const config = { contacts } as Prisma.InputJsonValue;
  await prisma.integration.upsert({
    where: { workspaceId_provider: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER } },
    update: { config, status: "active" },
    create: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER, status: "active", config }
  });
  return true;
}

export async function removeManagerTransferContactPrismaFast(input: {
  id: string;
}): Promise<boolean | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const workspaceId = session.workspace.id;
  const existing = await prisma.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER } },
    select: { config: true }
  });
  if (!existing) {
    return true;
  }
  const contacts = parseTransferContacts(existing.config).filter((contact) => contact.id !== input.id);
  await prisma.integration.update({
    where: { workspaceId_provider: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER } },
    data: { config: { contacts } as Prisma.InputJsonValue }
  });
  return true;
}

export async function createUserInvitePrismaFast(input: {
  email: string;
  role: WorkspaceRole;
}): Promise<{ url: string; workspaceId: string; workspaceName: string } | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const now = new Date();
  const token = randomToken();
  const inviteId = `invite-${randomUUID()}`;
  const email = normalizeEmail(input.email);
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.userInvite.create({
      data: {
        id: inviteId,
        workspaceId: session.workspace.id,
        email,
        role: workspaceRoleToPrisma(input.role) as $Enums.WorkspaceRole,
        tokenHash: hashToken(token),
        invitedById: session.user.id,
        status: "Pending",
        expiresAt,
        createdAt: now
      }
    });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "user_invite",
        objectId: inviteId,
        action: "created",
        newValue: { email, role: input.role, expiresAt: expiresAt.toISOString() }
      },
      now
    );
  });

  return {
    url: `/invite/${token}`,
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name
  };
}

export async function deactivateUserPrismaFast(input: { userId: string }): Promise<boolean | undefined> {
  const ctx = await requireManageWorkspaceSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  if (input.userId === session.user.id) {
    throw new Error("You cannot deactivate your own account.");
  }
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Matches the blob helper: look the account up by userId (no workspace scope).
    const account = await tx.authAccount.findUnique({ where: { userId: input.userId } });
    if (!account) {
      throw new Error("Auth account not found.");
    }
    await tx.authAccount.update({
      where: { id: account.id },
      data: { status: "Disabled", updatedAt: now }
    });
    await tx.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now, lastSeenAt: now }
    });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "auth_account",
        objectId: account.id,
        action: "disabled"
      },
      now
    );
  });

  return true;
}

// Not an admin op — any member may switch to a workspace they belong to — so it
// resolves the session directly rather than through requireManageWorkspaceSessionFast.
// Re-points the caller's existing (non-revoked) session to the target workspace,
// mirroring the blob switchAuthWorkspace (same session id, same expiry).
export async function switchWorkspacePrismaFast(input: {
  workspaceId: string;
}): Promise<AuthLoginResult | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }
  const { getPrismaSession } = await import("@/lib/phase1/store");
  const session = await getPrismaSession();
  const authSessionId = session?.authSessionId;
  if (!session || !authSessionId) {
    throw new Error("Authenticated session is required.");
  }
  const { prisma } = await import("@/lib/prisma");
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const membership = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: session.user.id } },
      include: { workspace: true }
    });
    if (!membership) {
      throw new Error("User is not a member of that workspace.");
    }
    const repointed = await tx.authSession.updateMany({
      where: { id: authSessionId, userId: session.user.id, revokedAt: null },
      data: { workspaceId: input.workspaceId, lastSeenAt: now }
    });
    if (repointed.count !== 1) {
      throw new Error("Authenticated session is required.");
    }
    const authSession = await tx.authSession.findUniqueOrThrow({ where: { id: authSessionId } });
    const account = await tx.authAccount.findUnique({
      where: { userId: session.user.id },
      include: { user: true }
    });
    if (!account) {
      throw new Error("Authenticated session is required.");
    }
    const resolved = sessionFromRows(account, membership, authSession.id);
    return {
      cookieValue: createSignedAuthSessionCookie({
        sessionId: authSession.id,
        userId: authSession.userId,
        workspaceId: authSession.workspaceId,
        expiresAt: authSession.expiresAt.toISOString()
      }),
      expiresAt: authSession.expiresAt.toISOString(),
      session: resolved
    };
  });
}

// --- Self-service settings fast paths (blob-migration Phase 1) ---------------
// Mirror updateOwnProfile / changeOwnPassword in auth-service.ts, writing the
// user's own identity rows straight to Prisma. Not admin ops — any authenticated
// user edits their own profile/password — so they use requireSessionFast (no
// manage_workspace assertion). Both update/upsert only (changeOwnPassword revokes
// = soft update), so the upsert-only mergePrismaIdentityRows stays correct.

export async function updateOwnProfilePrismaFast(input: {
  name?: string;
  emailSignature?: string;
  timezone?: string;
}): Promise<boolean | undefined> {
  const ctx = await requireSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: session.user.id } });
    if (!user) {
      throw new Error("Your account could not be found.");
    }
    const before = {
      name: user.name,
      emailSignature: user.emailSignature ?? undefined,
      timezone: user.timezone ?? undefined
    };
    const next = { ...before };
    const data: Prisma.UserUncheckedUpdateInput = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new Error("Name cannot be empty.");
      }
      data.name = name;
      next.name = name;
    }
    if (input.emailSignature !== undefined) {
      const signature = input.emailSignature.trim();
      if (signature.length > MAX_SIGNATURE_LENGTH) {
        throw new Error(`Email signature must be ${MAX_SIGNATURE_LENGTH} characters or fewer.`);
      }
      data.emailSignature = signature || null;
      next.emailSignature = signature || undefined;
    }
    if (input.timezone !== undefined) {
      const timezone = input.timezone.trim();
      if (timezone && !isValidTimezone(timezone)) {
        throw new Error("That timezone is not recognized.");
      }
      data.timezone = timezone || null;
      next.timezone = timezone || undefined;
    }

    await tx.user.update({ where: { id: user.id }, data });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "user",
        objectId: user.id,
        action: "profile_updated",
        oldValue: before,
        newValue: next
      },
      now
    );
  });

  return true;
}

export async function changeOwnPasswordPrismaFast(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<boolean | undefined> {
  const ctx = await requireSessionFast();
  if (!ctx) {
    return undefined;
  }
  const { session, prisma } = ctx;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const account = await tx.authAccount.findUnique({ where: { userId: session.user.id } });
    if (!account || account.status !== "Active") {
      throw new Error("Your account could not be found.");
    }
    if (!verifyPassword(input.currentPassword, account.passwordHash)) {
      throw new Error("Your current password is incorrect.");
    }
    if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (verifyPassword(input.newPassword, account.passwordHash)) {
      throw new Error("New password must be different from your current password.");
    }

    await tx.authAccount.update({
      where: { id: account.id },
      data: {
        passwordHash: hashPassword(input.newPassword),
        passwordUpdatedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now
      }
    });
    // Revoke every OTHER live session; keep the current one signed in.
    await tx.authSession.updateMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
        ...(session.authSessionId ? { id: { not: session.authSessionId } } : {})
      },
      data: { revokedAt: now, lastSeenAt: now }
    });
    await writeAuthAuditLog(
      tx,
      {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        objectType: "auth_account",
        objectId: account.id,
        action: "password_changed"
      },
      now
    );
  });

  return true;
}

type AuthSessionFastContext = {
  session: Session;
  prisma: PrismaClient;
};

// Resolve the current prisma-native session (any authenticated user), shared by the
// self-service fast paths. Returns undefined ONLY in file-driver mode (so the caller
// falls back to the blob path); in prisma mode it resolves or throws.
async function requireSessionFast(): Promise<AuthSessionFastContext | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }
  const { getPrismaSession } = await import("@/lib/phase1/store");
  const session = await getPrismaSession();
  if (!session) {
    throw new Error("Authentication required.");
  }
  const { prisma } = await import("@/lib/prisma");
  return { session, prisma };
}

// As above, plus the manage_workspace assertion — shared by the post-auth admin fast paths.
async function requireManageWorkspaceSessionFast(): Promise<AuthSessionFastContext | undefined> {
  const ctx = await requireSessionFast();
  if (!ctx) {
    return undefined;
  }
  assertPermission(ctx.session, "manage_workspace");
  return ctx;
}

type AuthAuditInput = {
  workspaceId: string;
  actorUserId: string;
  objectType: string;
  objectId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
};

// Native audit row matching the blob appendAuthAudit shape. auditLogs is still
// blob-projected today, so on a full reproject these native-only rows are pruned —
// the same latent gap the existing login/accept fast paths already have; resolved
// when the audit stream is peeled to native-only (blob-migration Phase 2).
async function writeAuthAuditLog(client: PrismaAuthClient, input: AuthAuditInput, now: Date) {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    id: `audit-${randomUUID()}`,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    objectType: input.objectType,
    objectId: input.objectId,
    action: input.action,
    reason: input.reason,
    createdAt: now
  };
  if (input.oldValue !== undefined) {
    data.oldValue = input.oldValue as Prisma.InputJsonValue;
  }
  if (input.newValue !== undefined) {
    data.newValue = input.newValue as Prisma.InputJsonValue;
  }
  await client.auditLog.create({ data });
}

async function registerFailedLogin(accountId: string, currentFailedCount: number, now: Date) {
  const failedLoginCount = currentFailedCount + 1;
  const lockedUntil = failedLoginCount >= 5 ? new Date(now.getTime() + 10 * 60 * 1000) : null;
  const { prisma } = await import("@/lib/prisma");

  await prisma.authAccount.update({
    where: { id: accountId },
    data: {
      failedLoginCount,
      updatedAt: now,
      ...(lockedUntil ? { lockedUntil } : {})
    }
  });
}

async function findMembership(userId: string, workspaceId?: string): Promise<PrismaWorkspaceMembership | null> {
  const { prisma } = await import("@/lib/prisma");
  if (workspaceId) {
    return prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId
        }
      },
      include: { workspace: true }
    });
  }

  return prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" }
  });
}

async function createSessionForAccount(
  client: PrismaAuthClient,
  account: PrismaAuthAccountWithUser,
  membership: PrismaWorkspaceMembership,
  input: { now: Date; ipAddress?: string; userAgent?: string }
): Promise<AuthLoginResult> {
  const expiresAt = new Date(input.now.getTime() + defaultAuthSessionMaxAgeSeconds * 1000);
  const authSessionId = `auth-session-${randomUUID()}`;

  await client.authSession.create({
    data: {
      id: authSessionId,
      userId: account.userId,
      workspaceId: membership.workspace.id,
      expiresAt,
      createdAt: input.now,
      lastSeenAt: input.now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  });
  await client.authAccount.update({
    where: { id: account.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: input.now,
      updatedAt: input.now
    }
  });
  await client.auditLog.create({
    data: {
      id: `audit-${randomUUID()}`,
      workspaceId: membership.workspace.id,
      actorUserId: account.userId,
      objectType: "auth_session",
      objectId: authSessionId,
      action: "login",
      reason: "Password login",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      createdAt: input.now
    }
  });

  const session = sessionFromRows(account, membership, authSessionId);
  const expiresAtIso = expiresAt.toISOString();
  return {
    cookieValue: createSignedAuthSessionCookie({
      sessionId: authSessionId,
      userId: account.userId,
      workspaceId: membership.workspace.id,
      expiresAt: expiresAtIso
    }),
    expiresAt: expiresAtIso,
    session
  };
}

function sessionFromRows(
  account: PrismaAuthAccountWithUser,
  membership: PrismaWorkspaceMembership,
  authSessionId: string
): Session {
  const role = workspaceRoleFromPrisma(membership.role);
  return {
    user: {
      id: account.user.id,
      email: account.user.email,
      name: account.user.name,
      createdAt: account.user.createdAt.toISOString()
    },
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      market: membership.workspace.market ?? "",
      seats: membership.workspace.seats,
      health: membership.workspace.health ?? "",
      createdAt: membership.workspace.createdAt.toISOString(),
      updatedAt: membership.workspace.updatedAt.toISOString()
    },
    role,
    permissions: rolePermissions(role),
    authSessionId,
    superadmin: account.superadmin
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
