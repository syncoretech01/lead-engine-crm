import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { rolePermissions } from "@/lib/phase1/auth";
import {
  createSignedAuthSessionCookie,
  defaultAuthSessionMaxAgeSeconds,
  hashPassword,
  hashToken,
  verifyPassword,
  verifySignedAuthSessionCookie
} from "@/lib/phase1/auth-security";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AuthLoginResult } from "@/lib/phase1/auth-service";
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

function workspaceRoleFromPrisma(role: string): WorkspaceRole {
  const roles: Record<string, WorkspaceRole> = {
    ADMIN: "Admin",
    MANAGER: "Manager",
    SDR: "SDR",
    DATA_OPERATOR: "Data Operator",
    VIEWER: "Viewer",
    COMPLIANCE_ADMIN: "Compliance Admin"
  };

  return roles[role] ?? "Viewer";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
