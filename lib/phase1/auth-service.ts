import { randomUUID } from "node:crypto";
import { assertPermission, resolveSession, type SessionSelection } from "@/lib/phase1/auth";
import { encryptSecretString } from "@/lib/phase1/secret-box";
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

// --- Self-service (a user editing THEIR OWN profile) ---------------------------
// These intentionally omit an `assertPermission(manage_*)` gate: they resolve the
// target from `session.user.id`, so a caller can only ever mutate their own row.

export const MAX_SIGNATURE_LENGTH = 2000;
export const MIN_PASSWORD_LENGTH = 10;

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Update the signed-in user's own display name, email signature, and timezone.
 *  Presence-based: only the fields provided are touched. */
export function updateOwnProfile(
  state: AppState,
  session: Session,
  input: { name?: string; emailSignature?: string; timezone?: string }
) {
  const user = state.users.find((record) => record.id === session.user.id);
  if (!user) {
    throw new Error("Your account could not be found.");
  }
  const now = new Date().toISOString();
  const before = { name: user.name, emailSignature: user.emailSignature, timezone: user.timezone };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Name cannot be empty.");
    }
    user.name = name;
  }
  if (input.emailSignature !== undefined) {
    const signature = input.emailSignature.trim();
    if (signature.length > MAX_SIGNATURE_LENGTH) {
      throw new Error(`Email signature must be ${MAX_SIGNATURE_LENGTH} characters or fewer.`);
    }
    user.emailSignature = signature || undefined;
  }
  if (input.timezone !== undefined) {
    const timezone = input.timezone.trim();
    if (timezone && !isValidTimezone(timezone)) {
      throw new Error("That timezone is not recognized.");
    }
    user.timezone = timezone || undefined;
  }

  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "user",
    objectId: user.id,
    action: "profile_updated",
    oldValue: before,
    newValue: { name: user.name, emailSignature: user.emailSignature, timezone: user.timezone }
  });
  return user;
}

/** Change the signed-in user's own password. Verifies the current password,
 *  then revokes every OTHER live session (the current one stays signed in). */
export function changeOwnPassword(
  state: AppState,
  session: Session,
  input: { currentPassword: string; newPassword: string }
) {
  ensureAuthDefaults(state);
  const now = new Date().toISOString();
  const account = state.authAccounts.find((record) => record.userId === session.user.id);
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

  account.passwordHash = hashPassword(input.newPassword);
  account.passwordUpdatedAt = now;
  account.failedLoginCount = 0;
  account.lockedUntil = undefined;
  account.updatedAt = now;
  // Revoke other live sessions; keep the current one so the user stays signed in.
  for (const active of state.authSessions.filter(
    (record) => record.userId === account.userId && !record.revokedAt && record.id !== session.authSessionId
  )) {
    active.revokedAt = now;
    active.lastSeenAt = now;
  }
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "auth_account",
    objectId: account.id,
    action: "password_changed"
  });
}

/** Admin/owner sets a new password for another member of their workspace (e.g. an
 *  SDR who forgot theirs, or to regain access to an account). Revokes all of the
 *  target's sessions so they must sign in again with the new password. */
export function adminResetUserPassword(
  state: AppState,
  session: Session,
  input: { userId: string; newPassword: string }
): { email: string; name: string } {
  assertPermission(session, "manage_workspace");
  if (input.userId === session.user.id) {
    throw new Error("Use your own Settings page to change your password.");
  }
  ensureAuthDefaults(state);
  const member = state.workspaceMembers.find(
    (record) => record.workspaceId === session.workspace.id && record.userId === input.userId
  );
  if (!member) {
    throw new Error("That user is not a member of this workspace.");
  }
  const user = state.users.find((record) => record.id === input.userId);
  const account = state.authAccounts.find((record) => record.userId === input.userId);
  if (!user || !account) {
    throw new Error("That user's account could not be found.");
  }
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const now = new Date().toISOString();
  account.passwordHash = hashPassword(input.newPassword);
  account.passwordUpdatedAt = now;
  account.failedLoginCount = 0;
  account.lockedUntil = undefined;
  account.updatedAt = now;
  // Force the target to re-authenticate everywhere with the new password.
  for (const active of state.authSessions.filter((record) => record.userId === input.userId && !record.revokedAt)) {
    active.revokedAt = now;
    active.lastSeenAt = now;
  }
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "auth_account",
    objectId: account.id,
    action: "password_reset_by_admin",
    newValue: { targetUserId: input.userId }
  });
  return { email: account.email, name: user.name };
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

/**
 * Permanently remove a member from the workspace (unlike deactivate, which only
 * disables). Drops the membership; if the user has no other membership, also
 * removes their sessions, auth account, pending invites, and the user record.
 * Returns the (normalized) email + whether the user was fully removed so the
 * caller can prune the non-workspace-scoped prisma rows the projection leaves.
 */
export function removeWorkspaceMember(
  state: AppState,
  session: Session,
  userId: string
): { email?: string; fullyRemoved: boolean } {
  assertPermission(session, "manage_workspace");
  if (userId === session.user.id) {
    throw new Error("You cannot remove your own access.");
  }
  const workspaceId = session.workspace.id;
  const member = state.workspaceMembers.find(
    (record) => record.workspaceId === workspaceId && record.userId === userId
  );
  if (!member) {
    throw new Error("Workspace member not found.");
  }
  const memberId = member.id;
  const user = state.users.find((record) => record.id === userId);

  state.workspaceMembers = state.workspaceMembers.filter((record) => record.id !== memberId);

  const fullyRemoved = !state.workspaceMembers.some((record) => record.userId === userId);
  if (fullyRemoved) {
    state.authSessions = state.authSessions.filter((record) => record.userId !== userId);
    state.authAccounts = state.authAccounts.filter((record) => record.userId !== userId);
    if (user) {
      const email = normalizeEmail(user.email);
      state.userInvites = state.userInvites.filter((record) => normalizeEmail(record.email) !== email);
    }
    state.users = state.users.filter((record) => record.id !== userId);
  }

  appendAuthAudit(state, {
    workspaceId,
    actorUserId: session.user.id,
    objectType: "workspace_member",
    objectId: memberId,
    action: "removed"
  });

  return { email: user ? normalizeEmail(user.email) : undefined, fullyRemoved };
}

// Admin-provisioned RingCentral line for a workspace member. Blank values clear
// the line. Requires manage_workspace; the member must belong to the actor's
// workspace even though the User record itself is workspace-agnostic.
export function updateUserTelephony(
  state: AppState,
  session: Session,
  input: {
    userId: string;
    phoneNumber: string;
    callerId: string;
    jwt: string;
    clientId?: string;
    clientSecret?: string;
  }
) {
  assertPermission(session, "manage_workspace");
  const member = state.workspaceMembers.find(
    (record) => record.workspaceId === session.workspace.id && record.userId === input.userId
  );
  if (!member) {
    throw new Error("Workspace member not found.");
  }
  const user = state.users.find((record) => record.id === input.userId);
  if (!user) {
    throw new Error("User not found.");
  }
  // Audit records only whether a JWT is present, never the secret itself.
  const oldValue = {
    ringCentralPhoneNumber: user.ringCentralPhoneNumber,
    ringCentralCallerId: user.ringCentralCallerId,
    hasJwt: Boolean(user.ringCentralJwt)
  };
  user.ringCentralPhoneNumber = input.phoneNumber.trim() || undefined;
  user.ringCentralCallerId = input.callerId.trim() || undefined;
  const jwt = input.jwt.trim();
  if (jwt) {
    // A pasted JWT replaces the stored one (encrypted at rest). Blank keeps the
    // existing JWT so an admin can edit the number without re-pasting the key.
    // When the SDR is on their OWN RingCentral account, their app's client
    // id/secret are packed alongside the JWT (see resolveUserRingCentralCredential);
    // blank client fields mean the shared Syncore app (e.g. Sam).
    const clientId = input.clientId?.trim() ?? "";
    const clientSecret = input.clientSecret?.trim() ?? "";
    const payload = clientId || clientSecret ? JSON.stringify({ jwt, clientId, clientSecret }) : jwt;
    user.ringCentralJwt = encryptSecretString(payload);
  }
  appendAuthAudit(state, {
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    objectType: "user",
    objectId: user.id,
    action: "telephony_updated",
    oldValue,
    newValue: {
      ringCentralPhoneNumber: user.ringCentralPhoneNumber,
      ringCentralCallerId: user.ringCentralCallerId,
      hasJwt: Boolean(user.ringCentralJwt)
    }
  });
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
