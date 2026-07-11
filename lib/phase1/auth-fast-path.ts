import { randomUUID } from "node:crypto";
import type { $Enums, Prisma, PrismaClient } from "@prisma/client";
import {
  assertPermission,
  rolePermissions,
  workspaceRoleFromPrisma,
  workspaceRoleToPrisma
} from "@/lib/phase1/auth";
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
import { MIN_PASSWORD_LENGTH, type AuthLoginResult, type AuthTokenResult } from "@/lib/phase1/auth-service";
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

type ManageWorkspaceFastContext = {
  session: Session;
  prisma: PrismaClient;
};

// Resolve the current prisma-native session and assert manage_workspace, shared by
// the post-auth admin fast paths. Returns undefined ONLY in file-driver mode (so the
// caller falls back to the blob path); in prisma mode it resolves or throws.
async function requireManageWorkspaceSessionFast(): Promise<ManageWorkspaceFastContext | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }
  const { getPrismaSession } = await import("@/lib/phase1/store");
  const session = await getPrismaSession();
  if (!session) {
    throw new Error("Authentication required.");
  }
  assertPermission(session, "manage_workspace");
  const { prisma } = await import("@/lib/prisma");
  return { session, prisma };
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
