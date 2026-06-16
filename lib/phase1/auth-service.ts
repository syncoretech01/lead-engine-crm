import { randomUUID } from "node:crypto";
import { assertPermission, resolveSession, type SessionSelection } from "@/lib/phase1/auth";
import {
  createSignedAuthSessionCookie,
  defaultAuthSessionMaxAgeSeconds,
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
  type SignedAuthSessionPayload
} from "@/lib/phase1/auth-security";
import type {
  AppState,
  AuthAccount,
  AuthSessionRecord,
  PasswordResetToken,
  Session,
  User,
  UserInvite,
  WorkspaceRole
} from "@/lib/phase1/types";

export const seededAuthPassword = "Syncore!2026";

export type AuthLoginResult = {
  cookieValue: string;
  expiresAt: string;
  session: Session;
};

export type AuthTokenResult = {
  token: string;
  url: string;
};

export function createSeedAuthAccounts(users: User[], now: string): AuthAccount[] {
  return users.map((user) => ({
    id: `auth-${user.id}`,
    userId: user.id,
    email: normalizeEmail(user.email),
    passwordHash: hashPassword(seededAuthPassword, `seed-${user.id}`),
    status: "Active",
    emailVerifiedAt: now,
    passwordUpdatedAt: now,
    failedLoginCount: 0,
    mfaEnabled: false,
    superadmin: user.id === "user-nora",
    createdAt: now,
    updatedAt: now
  }));
}

export function ensureAuthDefaults(state: AppState, now = new Date().toISOString()) {
  if (!Array.isArray(state.authAccounts)) state.authAccounts = [];
  if (!Array.isArray(state.authSessions)) state.authSessions = [];
  if (!Array.isArray(state.userInvites)) state.userInvites = [];
  if (!Array.isArray(state.passwordResetTokens)) state.passwordResetTokens = [];

  for (const user of state.users) {
    if (state.authAccounts.some((account) => account.userId === user.id)) continue;
    state.authAccounts.push(createSeedAuthAccounts([user], now)[0]);
  }
}

export function loginWithPassword(
  state: AppState,
  input: {
    email: string;
    password: string;
    workspaceId?: string;
    now?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): AuthLoginResult {
  ensureAuthDefaults(state);
  const now = input.now ?? new Date().toISOString();
  const account = authAccountByEmail(state, input.email);
  const genericMessage = "Invalid email or password.";

  if (!account || account.status !== "Active") {
    throw new Error(genericMessage);
  }
  if (account.lockedUntil && Date.parse(account.lockedUntil) > Date.parse(now)) {
    throw new Error("Account is temporarily locked. Try again later.");
  }
  if (!verifyPassword(input.password, account.passwordHash)) {
    registerFailedLogin(account, now);
    throw new Error(genericMessage);
  }

  const workspaceId = input.workspaceId || firstWorkspaceIdForUser(state, account.userId);
  const session = createAuthSession(state, {
    userId: account.userId,
    workspaceId,
    now,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });
  account.failedLoginCount = 0;
  account.lockedUntil = undefined;
  account.lastLoginAt = now;
  account.updatedAt = now;
  appendAuthAudit(state, {
    workspaceId,
    actorUserId: account.userId,
    objectType: "auth_session",
    objectId: session.id,
    action: "login",
    reason: "Password login"
  });

  const resolved = resolveSession(state, {
    userId: account.userId,
    workspaceId,
    authSessionId: session.id
  });
  return {
    cookieValue: createSignedAuthSessionCookie({
      sessionId: session.id,
      userId: account.userId,
      workspaceId,
      expiresAt: session.expiresAt
    }),
    expiresAt: session.expiresAt,
    session: {
      ...resolved,
      authSessionId: session.id,
      superadmin: account.superadmin
    }
  };
}

export function resolveAuthenticatedSessionSelection(
  state: AppState,
  payload: SignedAuthSessionPayload,
  now = new Date().toISOString()
): SessionSelection {
  ensureAuthDefaults(state);
  const session = state.authSessions.find((record) => record.id === payload.sessionId);
  const account = state.authAccounts.find((record) => record.userId === payload.userId);

  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.parse(now)) {
    throw new Error("Authentication required.");
  }
  if (session.userId !== payload.userId || session.workspaceId !== payload.workspaceId) {
    throw new Error("Authentication required.");
  }
  if (!account || account.status !== "Active") {
    throw new Error("Authentication required.");
  }

  return {
    userId: session.userId,
    workspaceId: session.workspaceId,
    authSessionId: session.id
  };
}

export function revokeAuthSession(state: AppState, sessionId: string, now = new Date().toISOString()) {
  const session = state.authSessions.find((record) => record.id === sessionId);
  if (!session || session.revokedAt) return;
  session.revokedAt = now;
  session.lastSeenAt = now;
  appendAuthAudit(state, {
    workspaceId: session.workspaceId,
    actorUserId: session.userId,
    objectType: "auth_session",
    objectId: session.id,
    action: "logout",
    reason: "Session revoked"
  });
}

export function switchAuthWorkspace(
  state: AppState,
  session: Session,
  workspaceId: string,
  now = new Date().toISOString()
): AuthLoginResult {
  const authSessionId = session.authSessionId;
  if (!authSessionId) {
    throw new Error("Authenticated session is required.");
  }
  const authSession = state.authSessions.find((record) => record.id === authSessionId && record.userId === session.user.id);
  if (!authSession || authSession.revokedAt) {
    throw new Error("Authenticated session is required.");
  }
  const membership = state.workspaceMembers.find((member) => member.userId === session.user.id && member.workspaceId === workspaceId);
  if (!membership) {
    throw new Error("User is not a member of that workspace.");
  }

  authSession.workspaceId = workspaceId;
  authSession.lastSeenAt = now;
  const resolved = resolveSession(state, {
    userId: session.user.id,
    workspaceId,
    authSessionId
  });
  return {
    cookieValue: createSignedAuthSessionCookie({
      sessionId: authSession.id,
      userId: authSession.userId,
      workspaceId: authSession.workspaceId,
      expiresAt: authSession.expiresAt
    }),
    expiresAt: authSession.expiresAt,
    session: resolved
  };
}

export function createUserInvite(
  state: AppState,
  session: Session,
  input: { email: string; role: WorkspaceRole; now?: string }
): AuthTokenResult {
  assertPermission(session, "manage_workspace");
  const now = input.now ?? new Date().toISOString();
  const token = randomToken();
  const invite: UserInvite = {
    id: `invite-${randomUUID()}`,
    workspaceId: session.workspace.id,
    email: normalizeEmail(input.email),
    role: input.role,
    tokenHash: hashToken(token),
    invitedById: session.user.id,
    status: "Pending",
    expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now
  };

  state.userInvites.unshift(invite);
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "user_invite",
    objectId: invite.id,
    action: "created",
    newValue: { email: invite.email, role: invite.role, expiresAt: invite.expiresAt }
  });

  return { token, url: `/invite/${token}` };
}

export function acceptUserInvite(
  state: AppState,
  input: { token: string; name: string; password: string; now?: string }
): AuthLoginResult {
  ensureAuthDefaults(state);
  const now = input.now ?? new Date().toISOString();
  const invite = state.userInvites.find((record) => record.tokenHash === hashToken(input.token));
  if (!invite || invite.status !== "Pending" || Date.parse(invite.expiresAt) <= Date.parse(now)) {
    throw new Error("Invite is invalid or expired.");
  }

  let user = state.users.find((record) => normalizeEmail(record.email) === invite.email);
  if (!user) {
    user = {
      id: `user-${randomUUID()}`,
      name: input.name.trim() || invite.email.split("@")[0],
      email: invite.email,
      createdAt: now
    };
    state.users.unshift(user);
  }

  if (!state.workspaceMembers.some((member) => member.workspaceId === invite.workspaceId && member.userId === user.id)) {
    state.workspaceMembers.unshift({
      id: `member-${randomUUID()}`,
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role
    });
  }

  const existingAccount = state.authAccounts.find((account) => account.userId === user.id);
  if (existingAccount) {
    existingAccount.passwordHash = hashPassword(input.password);
    existingAccount.status = "Active";
    existingAccount.emailVerifiedAt = now;
    existingAccount.passwordUpdatedAt = now;
    existingAccount.updatedAt = now;
  } else {
    state.authAccounts.unshift({
      id: `auth-${randomUUID()}`,
      userId: user.id,
      email: invite.email,
      passwordHash: hashPassword(input.password),
      status: "Active",
      emailVerifiedAt: now,
      passwordUpdatedAt: now,
      failedLoginCount: 0,
      mfaEnabled: false,
      superadmin: false,
      createdAt: now,
      updatedAt: now
    });
  }

  invite.status = "Accepted";
  invite.acceptedAt = now;
  appendAuthAudit(state, {
    workspaceId: invite.workspaceId,
    actorUserId: user.id,
    objectType: "user_invite",
    objectId: invite.id,
    action: "accepted"
  });

  return loginWithPassword(state, {
    email: invite.email,
    password: input.password,
    workspaceId: invite.workspaceId,
    now
  });
}

export function createPasswordResetToken(
  state: AppState,
  email: string,
  now = new Date().toISOString()
): AuthTokenResult | undefined {
  ensureAuthDefaults(state);
  const account = authAccountByEmail(state, email);
  if (!account || account.status !== "Active") {
    return undefined;
  }

  const token = randomToken();
  const reset: PasswordResetToken = {
    id: `reset-${randomUUID()}`,
    userId: account.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
    createdAt: now
  };
  state.passwordResetTokens.unshift(reset);
  appendAuthAudit(state, {
    workspaceId: firstWorkspaceIdForUser(state, account.userId),
    actorUserId: account.userId,
    objectType: "password_reset_token",
    objectId: reset.id,
    action: "created",
    reason: "Password reset requested"
  });
  return { token, url: `/reset-password/${token}` };
}

export function resetPasswordWithToken(
  state: AppState,
  input: { token: string; password: string; now?: string }
) {
  ensureAuthDefaults(state);
  const now = input.now ?? new Date().toISOString();
  const reset = state.passwordResetTokens.find((record) => record.tokenHash === hashToken(input.token));
  if (!reset || reset.usedAt || Date.parse(reset.expiresAt) <= Date.parse(now)) {
    throw new Error("Reset link is invalid or expired.");
  }
  const account = state.authAccounts.find((record) => record.userId === reset.userId);
  if (!account || account.status !== "Active") {
    throw new Error("Reset link is invalid or expired.");
  }

  account.passwordHash = hashPassword(input.password);
  account.passwordUpdatedAt = now;
  account.failedLoginCount = 0;
  account.lockedUntil = undefined;
  account.updatedAt = now;
  reset.usedAt = now;
  for (const session of state.authSessions.filter((record) => record.userId === account.userId && !record.revokedAt)) {
    session.revokedAt = now;
    session.lastSeenAt = now;
  }
  appendAuthAudit(state, {
    workspaceId: firstWorkspaceIdForUser(state, account.userId),
    actorUserId: account.userId,
    objectType: "auth_account",
    objectId: account.id,
    action: "password_reset"
  });
}

export function updateMemberRole(
  state: AppState,
  session: Session,
  input: { userId: string; role: WorkspaceRole }
) {
  assertPermission(session, "manage_workspace");
  const member = state.workspaceMembers.find(
    (record) => record.workspaceId === session.workspace.id && record.userId === input.userId
  );
  if (!member) {
    throw new Error("Workspace member not found.");
  }
  const oldRole = member.role;
  member.role = input.role;
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "workspace_member",
    objectId: member.id,
    action: "role_updated",
    oldValue: { role: oldRole },
    newValue: { role: member.role }
  });
  return member;
}

export function deactivateUserAccount(state: AppState, session: Session, userId: string) {
  assertPermission(session, "manage_workspace");
  if (userId === session.user.id) {
    throw new Error("You cannot deactivate your own account.");
  }
  const account = state.authAccounts.find((record) => record.userId === userId);
  if (!account) {
    throw new Error("Auth account not found.");
  }
  const now = new Date().toISOString();
  account.status = "Disabled";
  account.updatedAt = now;
  for (const authSession of state.authSessions.filter((record) => record.userId === userId && !record.revokedAt)) {
    authSession.revokedAt = now;
    authSession.lastSeenAt = now;
  }
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "auth_account",
    objectId: account.id,
    action: "disabled"
  });
  return account;
}

function createAuthSession(
  state: AppState,
  input: { userId: string; workspaceId: string; now: string; ipAddress?: string; userAgent?: string }
): AuthSessionRecord {
  if (!state.workspaceMembers.some((member) => member.userId === input.userId && member.workspaceId === input.workspaceId)) {
    throw new Error("User is not a member of the selected workspace.");
  }
  const session: AuthSessionRecord = {
    id: `auth-session-${randomUUID()}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    expiresAt: new Date(Date.parse(input.now) + defaultAuthSessionMaxAgeSeconds * 1000).toISOString(),
    createdAt: input.now,
    lastSeenAt: input.now,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  };
  state.authSessions.unshift(session);
  return session;
}

function registerFailedLogin(account: AuthAccount, now: string) {
  account.failedLoginCount += 1;
  account.updatedAt = now;
  if (account.failedLoginCount >= 5) {
    account.lockedUntil = new Date(Date.parse(now) + 10 * 60 * 1000).toISOString();
  }
}

function authAccountByEmail(state: AppState, email: string) {
  const normalized = normalizeEmail(email);
  return state.authAccounts.find((account) => account.email === normalized);
}

function firstWorkspaceIdForUser(state: AppState, userId: string) {
  const membership = state.workspaceMembers.find((member) => member.userId === userId);
  if (!membership) {
    throw new Error("User is not a workspace member.");
  }
  return membership.workspaceId;
}

function appendAuthAudit(
  state: AppState,
  input: {
    workspaceId: string;
    actorUserId: string;
    objectType: string;
    objectId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }
) {
  state.auditLogs.unshift({
    id: `audit-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...input
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
