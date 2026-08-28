import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { cache } from "react";
import { ensureAiDefaults } from "@/lib/phase1/ai";
import {
  authSessionCookieName,
  isProductionBuildPhase,
  legacyDemoSessionCookieNames,
  verifySignedAuthSessionCookie
} from "@/lib/phase1/auth-security";
import { ensureAuthDefaults, resolveAuthenticatedSessionSelection } from "@/lib/phase1/auth-service";
import { ensureComplianceDefaults } from "@/lib/phase1/compliance";
import { ensureCrmDefaults } from "@/lib/phase1/crm";
import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import { defaultExportRules } from "@/lib/phase1/exporting";
import { ensureJobObservabilityDefaults } from "@/lib/phase1/jobs";
import { phase4JobDefaults } from "@/lib/phase1/lead-planning";
import { ensureMoneyLedgerDefaults } from "@/lib/phase1/money";
import { ensureOutreachDefaults } from "@/lib/phase1/outreach";
import {
  captureProjectionRowStrings,
  createNormalizedPersistenceProjection,
  mapCallLogsToRows,
  mapNotesToRows,
  syncNormalizedProjectionToPrisma,
  type ProjectionTableName,
  type SyncNormalizedProjectionOptions
} from "@/lib/phase1/persistence-projection";
import {
  createDefaultProviderConnections,
  ensureProviderConnectionsForRegistry,
  pruneProviderConnectionsNotInRegistry
} from "@/lib/phase1/provider-connections";
import { ensureReportingDefaults } from "@/lib/phase1/reporting";
import { createSeedState } from "@/lib/phase1/seed";
import { defaultSegmentRules } from "@/lib/phase1/scoring";
import { ensureSdrDefaults } from "@/lib/phase1/sdr";
import { ensureWaterfallDefaults, pruneWaterfallTemplateProviders } from "@/lib/phase1/waterfall-templates";
import { timeAsync } from "@/lib/phase1/performance";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, AuditLog, AuthAccountStatus, Permission, Session, UserInviteStatus } from "@/lib/phase1/types";
import {
  defaultWorkspacePath,
  hasPermission,
  resolveSession,
  rolePermissions,
  workspaceRoleFromPrisma,
  type SessionSelection
} from "@/lib/phase1/auth";
import { runWorkspaceVerification } from "@/lib/phase1/verification";

export const stateSnapshotId = "syncore-primary-state";

type PrismaStoreClient = PrismaClient | Prisma.TransactionClient;
type UpdateStateOptions = {
  normalizedTables?: ProjectionTableName[];
  /** Persist only the JSON snapshot; skip the normalized projection sync. */
  skipNormalizedProjection?: boolean;
  /** Override Prisma's interactive transaction budget for known heavy writes. */
  transactionTimeoutMs?: number;
};

const DEFAULT_STATE_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_STATE_TRANSACTION_TIMEOUT_MS = 180_000;

function stateTransactionTimeoutMs(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_STATE_TRANSACTION_TIMEOUT_MS;
  return Math.min(MAX_STATE_TRANSACTION_TIMEOUT_MS, Math.max(1_000, Math.round(value as number)));
}

export const sessionCookieNames = {
  userId: legacyDemoSessionCookieNames.userId,
  workspaceId: legacyDemoSessionCookieNames.workspaceId
} as const;

// writeSeq observed when a state object was handed out by readState, so a later
// writeState of THAT object can compare-and-set instead of clobbering whatever
// committed in between. Keyed weakly on the state object itself: ops scripts do
// readState → mutate for minutes → writeState, and threading a sequence number
// through every script signature is exactly the kind of change that would be
// skipped under pressure.
const observedWriteSeqs = new WeakMap<AppState, number>();

export async function readState(): Promise<AppState> {
  // resolveStorageDriver() validates the env (throws on the removed "file" driver)
  // and is the metadata label; prisma is now the only storage backend.
  const driver = resolveStorageDriver();
  return timeAsync("state.read", async () => {
    const { state, writeSeq } = await readStateFromPrisma(await getPrismaClient());
    observedWriteSeqs.set(state, writeSeq);
    return state;
  }, { driver });
}

export async function writeState(state: AppState) {
  const driver = resolveStorageDriver();
  // States born from readState carry their writeSeq and get the CAS; a state built
  // from scratch (provisioning) has nothing to compare against and writes
  // unconditionally — that branch still bumps writeSeq so concurrent updateState
  // transactions detect the interleave and retry on fresh state.
  const casWriteSeq = observedWriteSeqs.get(state);
  await timeAsync("state.write", async () => {
    try {
      await writeStateToPrisma(state, await getPrismaClient(), {}, casWriteSeq);
      // The CAS bumped the row to casWriteSeq+1; remember that for this object so
      // a checkpoint-style script that writes the same state twice CASes on the
      // seq it actually holds instead of false-conflicting against its own write.
      if (casWriteSeq !== undefined) {
        observedWriteSeqs.set(state, casWriteSeq + 1);
      }
    } catch (error) {
      if (error instanceof WriteConflictError) {
        // Bulk callers mutate in memory for minutes; a transparent retry would
        // need the whole mutation replayed, so fail loud with the operator move.
        throw new Error(
          "The app state changed while this script was running (another write committed " +
            "after readState). Nothing was written — re-run the script so it works from " +
            "the current state."
        );
      }
      throw error;
    }
  }, { driver, cas: casWriteSeq !== undefined, ...stateCountMetadata(state) });
}

/**
 * Thrown by the CAS write path when the snapshot's writeSeq moved between our read
 * and our write — i.e. another transaction committed first. Caught by
 * runWithWriteConflictRetry, which re-runs the whole transaction against the
 * now-current state. Callers never see it.
 */
export class WriteConflictError extends Error {
  constructor() {
    super("AppState snapshot write conflict (a concurrent update committed first).");
    this.name = "WriteConflictError";
  }
}

// The single snapshot row serializes all writes (inherent to the blob until the
// migration peels domains off it), so a burst of concurrent writers queue on it and
// the later ones conflict cumulatively. Retry generously; exhausting this throws
// (fail-loud) rather than losing a write.
const MAX_WRITE_CONFLICT_RETRIES = 10;

async function runWithWriteConflictRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof WriteConflictError && attempt < MAX_WRITE_CONFLICT_RETRIES) {
        // Brief jittered backoff so racing writers don't lock-step and livelock.
        await new Promise((resolve) => setTimeout(resolve, attempt * 8 + Math.floor(Math.random() * 12)));
        continue;
      }
      throw error;
    }
  }
}

export async function updateState<T>(
  mutator: (state: AppState, session: Session) => T,
  options: UpdateStateOptions = {}
): Promise<T> {
  const driver = resolveStorageDriver();
  return timeAsync("state.update", async () => {
    const client = await getPrismaClient();
    return runWithWriteConflictRetry(() =>
      client.$transaction(
        async (tx) => {
          const { state, writeSeq } = await readStateFromPrisma(tx);
          const session = await resolveCurrentRequestSession(state, tx);
          const syncOptions = normalizedSyncOptions(options);
          // Capture the pre-mutation baseline for the scoped tables so the diff
          // write path can upsert only the rows this mutation changes.
          const previousRowStrings =
            projectionDiffEnabled() && !syncOptions.skip && options.normalizedTables?.length
              ? captureProjectionRowStrings(createNormalizedPersistenceProjection(state), options.normalizedTables)
              : undefined;
          const result = mutator(state, session);
          await writeStateToPrisma(
            state,
            tx,
            previousRowStrings ? { ...syncOptions, previousRowStrings } : syncOptions,
            writeSeq
          );
          return result;
        },
        { maxWait: 10_000, timeout: stateTransactionTimeoutMs(options.transactionTimeoutMs) }
      )
    );
  }, { driver, tables: normalizedTablesLabel(options.normalizedTables) });
}

export async function updateAuthState<T>(
  mutator: (state: AppState) => T,
  options: UpdateStateOptions = {}
): Promise<T> {
  const driver = resolveStorageDriver();
  return timeAsync("state.authUpdate", async () => {
    const client = await getPrismaClient();
    return runWithWriteConflictRetry(() =>
      client.$transaction(
        async (tx) => {
          const { state, writeSeq } = await readStateFromPrisma(tx);
          const syncOptions = normalizedSyncOptions(options);
          // Capture the pre-mutation baseline for the scoped tables so the diff
          // write path upserts only the rows this mutation changes — parity with
          // updateState. Without it, a worker flipping one field (e.g. a call's
          // recordingId) re-syncs entire append-only tables (activities/auditLogs).
          const previousRowStrings =
            projectionDiffEnabled() && !syncOptions.skip && options.normalizedTables?.length
              ? captureProjectionRowStrings(createNormalizedPersistenceProjection(state), options.normalizedTables)
              : undefined;
          const result = mutator(state);
          await writeStateToPrisma(
            state,
            tx,
            previousRowStrings ? { ...syncOptions, previousRowStrings } : syncOptions,
            writeSeq
          );
          return result;
        },
        { maxWait: 10_000, timeout: stateTransactionTimeoutMs(options.transactionTimeoutMs) }
      )
    );
  }, { driver, tables: normalizedTablesLabel(options.normalizedTables) });
}

async function getPrismaClient() {
  const prismaModule = await import("@/lib/prisma");
  return prismaModule.prisma;
}

export function appendAudit(
  state: AppState,
  session: Session,
  input: Omit<AuditLog, "id" | "workspaceId" | "actorUserId" | "createdAt">
) {
  state.auditLogs.unshift({
    id: `audit-${randomUUID()}`,
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    createdAt: new Date().toISOString(),
    ...input
  });
}

export async function getSession(state?: AppState) {
  try {
    if (state) {
      return await resolveCurrentRequestSession(state);
    }

    const prismaSession = await getPrismaSession();
    if (prismaSession) {
      return prismaSession;
    }

    return (await getRequestStateSession()).session;
  } catch (error) {
    if (isAuthRequiredError(error)) {
      const { redirect } = await import("next/navigation");
      redirect("/login");
    }
    throw error;
  }
}

export async function getWorkspaceContext(permission?: Permission) {
  return timeAsync("workspace.context", async () => {
    const { state, session } = await getRequestStateSession();

    if (permission && !hasPermission(session, permission)) {
      const { redirect } = await import("next/navigation");
      redirect(defaultWorkspacePath(session));
    }

    return { state, session, workspaceId: session.workspace.id };
  }, { permission: permission ?? "none" });
}

export async function getDeveloperWorkspaceContext() {
  return getWorkspaceContext("manage_workspace");
}

export async function getWorkspaceSessionContext(permission?: Permission) {
  return timeAsync("workspace.sessionContext", async () => {
    const session = await getSession();

    if (permission && !hasPermission(session, permission)) {
      const { redirect } = await import("next/navigation");
      redirect(defaultWorkspacePath(session));
    }

    return { session, workspaceId: session.workspace.id };
  }, { permission: permission ?? "none" });
}

const getCachedRequestStateSession = cache(async () => {
  const [state, prismaSession] = await Promise.all([readState(), getPrismaSession()]);
  const session = prismaSession ?? await resolveCurrentSession(state);
  return { state, session };
});

async function getRequestStateSession() {
  return timeAsync("state.requestContext", () => getCachedRequestStateSession());
}

// Exported so the native auth fast paths (auth-fast-path.ts) can resolve the
// current session without a full blob read. Returns undefined in file-driver
// mode or when there is no auth cookie; throws when the cookie is present but
// the session/membership/account is invalid.
export async function getPrismaSession(client?: PrismaStoreClient): Promise<Session | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const payload = await readSignedAuthPayload();
  if (!payload) {
    return undefined;
  }

  const prismaClient = client ?? (await import("@/lib/prisma")).prisma;
  const [authSession, membership, account] = await Promise.all([
    prismaClient.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: {
        user: true,
        workspace: true
      }
    }),
    prismaClient.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: payload.workspaceId,
          userId: payload.userId
        }
      }
    }),
    prismaClient.authAccount.findUnique({
      where: { userId: payload.userId }
    })
  ]);

  if (!authSession || !membership || !account || account.status !== "Active") {
    throw new Error("Authentication required.");
  }

  const role = workspaceRoleFromPrisma(membership.role);
  return {
    user: {
      id: authSession.user.id,
      email: authSession.user.email,
      name: authSession.user.name,
      ringCentralPhoneNumber: authSession.user.ringCentralPhoneNumber ?? undefined,
      ringCentralExtensionId: authSession.user.ringCentralExtensionId ?? undefined,
      emailSignature: authSession.user.emailSignature ?? undefined,
      timezone: authSession.user.timezone ?? undefined,
      createdAt: authSession.user.createdAt.toISOString()
    },
    workspace: {
      id: authSession.workspace.id,
      name: authSession.workspace.name,
      market: authSession.workspace.market ?? "",
      seats: authSession.workspace.seats,
      health: authSession.workspace.health ?? "",
      createdAt: authSession.workspace.createdAt.toISOString(),
      updatedAt: authSession.workspace.updatedAt.toISOString()
    },
    role,
    permissions: rolePermissions(role),
    authSessionId: authSession.id,
    superadmin: account.superadmin
  };
}

async function readSignedAuthPayload() {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return verifySignedAuthSessionCookie(cookieStore.get(authSessionCookieName)?.value);
  } catch {
    return undefined;
  }
}

function authAccountStatusFromPrisma(status: string): AuthAccountStatus {
  if (status === "Invited" || status === "Disabled") {
    return status;
  }
  return "Active";
}

function inviteStatusFromPrisma(status: string): UserInviteStatus {
  if (status === "Accepted" || status === "Expired" || status === "Revoked") {
    return status;
  }
  return "Pending";
}

export async function resetStore() {
  await writeState(createSeedState());
}

/**
 * Whether persisted application state already exists for the active storage
 * driver. Used by the provisioning script to avoid overwriting a live
 * workspace. Unlike `readState`, this never seeds initial state as a side
 * effect of being called.
 */
export async function persistedStateExists(): Promise<boolean> {
  resolveStorageDriver();
  const client = await getPrismaClient();
  const snapshot = await client.appStateSnapshot.findUnique({ where: { id: stateSnapshotId } });
  return Boolean(snapshot);
}

async function resolveCurrentSession(state: AppState) {
  const selection = await readSessionSelection(state);
  return resolveSession(state, selection);
}

async function resolveCurrentRequestSession(state: AppState, client?: PrismaStoreClient) {
  const prismaSession = await getPrismaSession(client);
  if (prismaSession) {
    return prismaSession;
  }

  return resolveCurrentSession(state);
}

async function readSessionSelection(state: AppState): Promise<SessionSelection> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(authSessionCookieName)?.value;
    const payload = verifySignedAuthSessionCookie(authCookie);
    if (payload) {
      return resolveAuthenticatedSessionSelection(state, payload);
    }

    if (allowLegacyDemoSession()) {
      return {
        userId: cookieStore.get(sessionCookieNames.userId)?.value,
        workspaceId: cookieStore.get(sessionCookieNames.workspaceId)?.value
      };
    }
  } catch {
    if (isProductionBuildPhase()) {
      return {};
    }
  }

  if (isProductionBuildPhase()) {
    return {};
  }

  if (allowLegacyDemoSession()) {
    return {
      userId: process.env.SYNCORE_SESSION_USER_ID,
      workspaceId: process.env.SYNCORE_SESSION_WORKSPACE_ID
    };
  }

  throw new Error("Authentication required.");
}

/**
 * Legacy demo sessions authenticate from unsigned `syncore_user_id` /
 * `syncore_workspace_id` cookies (or the matching `SYNCORE_SESSION_*` env vars)
 * with no password, signature, or HMAC — a full-impersonation path intended
 * only for local development. It is force-disabled whenever `NODE_ENV` is
 * `production`, regardless of `SYNCORE_ALLOW_DEMO_SESSION`, so the flag can
 * never open a backdoor on a live deployment (fail closed, not merely
 * off-by-default). See P0.2 in docs/REMEDIATION_LOG.md.
 */
export function allowLegacyDemoSession(
  env: { NODE_ENV?: string; SYNCORE_ALLOW_DEMO_SESSION?: string } = process.env
) {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env.SYNCORE_ALLOW_DEMO_SESSION === "true";
}

function isAuthRequiredError(error: unknown) {
  return error instanceof Error && /Authentication required/i.test(error.message);
}

type StateSeedEnv = { NODE_ENV?: string; SYNCORE_SEED_SNAPSHOT?: string };

/**
 * Whether an empty store may be auto-seeded on read. In dev/test this is the
 * expected behaviour; in production it must be opted into via SYNCORE_SEED_SNAPSHOT
 * (the same flag the seed-prisma script honours) so a fresh or wiped database can
 * never silently recreate the seeded demo workspace — which ships a well-known
 * superadmin credential. Provisioning and tests seed explicitly via
 * writeState/createSeedState and do not depend on this read-path fallback.
 */
export function stateSeedingAllowed(env: StateSeedEnv = process.env as StateSeedEnv): boolean {
  if (env.SYNCORE_SEED_SNAPSHOT?.toLowerCase() === "true") {
    return true;
  }

  return env.NODE_ENV !== "production";
}

// Returns the migrated state AND the writeSeq from the SAME snapshot read, so the
// caller's compare-and-set checks the exact baseline it mutated. Reading writeSeq
// in a separate query would let a concurrent commit slip in between and defeat the
// CAS (we'd mutate old state but check a newer seq).
async function readStateFromPrisma(client: PrismaStoreClient): Promise<{ state: AppState; writeSeq: number }> {
  const snapshot = await timeAsync("state.prisma.snapshotRead", () => client.appStateSnapshot.findUnique({
    where: { id: stateSnapshotId }
  }), { snapshotId: stateSnapshotId });

  if (!snapshot) {
    if (!stateSeedingAllowed()) {
      throw new Error(
        "No AppState snapshot found and auto-seeding is disabled in production. Provision explicitly " +
          "(scripts/provision-workspace.ts) or set SYNCORE_SEED_SNAPSHOT=true. Refusing to silently seed " +
          "demo state, which includes a well-known seeded superadmin."
      );
    }
    const state = readInitialStateForPrisma();
    await writeStateToPrisma(state, client);
    return { state, writeSeq: 0 };
  }

  const parsed = snapshot.state as unknown as AppState;
  const { state, changed } = migrateState(parsed);
  // Blob-migration Phase 2: callLogs + notes are native-only (flushed to prisma on
  // write). Drop any rows carried in the blob (pre-peel history, already native) so
  // reads never surface or re-flush them; new rows come from the mutator this cycle.
  state.callLogs = [];
  state.notes = [];
  // Reconcile the natively-written identity rows (the auth fast path owns them) INTO
  // the in-memory state so callers see fresh identity — but do NOT persist that on
  // read. Blob migration Phase 1: reads stop writing. The old identity self-heal
  // rewrote the blob on every read on benign session-lastSeenAt churn (the
  // egress/OOM lineage). Correctness holds because EVERY read re-merges, and every
  // write re-merges before persisting — so a projection can't reset a
  // natively-accepted invite, and reproject (which also readState()s) stays correct.
  // A schema migration or version bump still re-projects.
  await mergePrismaIdentityRows(client, state);
  let writeSeq = snapshot.writeSeq;
  if (changed || snapshot.version !== state.version) {
    // A schema migration or version bump can touch any table — re-project all.
    await writeStateToPrisma(state, client);
    // That self-heal bumped writeSeq; report the bumped value so a caller's own
    // CAS (updateState's final write, or a script's writeState) compares against
    // the row as it now stands rather than conflicting with our own write.
    writeSeq += 1;
  }

  return { state, writeSeq };
}

async function mergePrismaIdentityRows(client: PrismaStoreClient, state: AppState) {
  let changed = false;
  const [workspaces, users, members, authAccounts, authSessions, userInvites] = await Promise.all([
    client.workspace.findMany(),
    client.user.findMany(),
    client.workspaceMember.findMany(),
    client.authAccount.findMany(),
    client.authSession.findMany(),
    client.userInvite.findMany()
  ]);

  for (const workspace of workspaces) {
    const existing = state.workspaces.find((item) => item.id === workspace.id);
    const next = {
      id: workspace.id,
      name: workspace.name,
      market: workspace.market ?? "",
      seats: workspace.seats,
      health: workspace.health ?? "",
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString()
    };

    if (existing) {
      if (
        existing.name !== next.name ||
        existing.market !== next.market ||
        existing.seats !== next.seats ||
        existing.health !== next.health ||
        existing.updatedAt !== next.updatedAt
      ) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.workspaces.push(next);
      changed = true;
    }
  }

  for (const user of users) {
    const existing = state.users.find((item) => item.id === user.id);
    // Hydrate the full native user, including telephony/signature/timezone — the
    // /access page reads those off state.users, and the native auth fast paths
    // (updateUserTelephonyPrismaFast) write them straight to Prisma, so the merge
    // is now the only thing that surfaces them back into the blob.
    const next = {
      id: user.id,
      email: user.email,
      name: user.name,
      ringCentralPhoneNumber: user.ringCentralPhoneNumber ?? undefined,
      ringCentralExtensionId: user.ringCentralExtensionId ?? undefined,
      ringCentralCallerId: user.ringCentralCallerId ?? undefined,
      ringCentralJwt: user.ringCentralJwt ?? undefined,
      emailSignature: user.emailSignature ?? undefined,
      timezone: user.timezone ?? undefined,
      createdAt: user.createdAt.toISOString()
    };

    if (existing) {
      if (
        existing.email !== next.email ||
        existing.name !== next.name ||
        existing.ringCentralPhoneNumber !== next.ringCentralPhoneNumber ||
        existing.ringCentralExtensionId !== next.ringCentralExtensionId ||
        existing.ringCentralCallerId !== next.ringCentralCallerId ||
        existing.ringCentralJwt !== next.ringCentralJwt ||
        existing.emailSignature !== next.emailSignature ||
        existing.timezone !== next.timezone ||
        existing.createdAt !== next.createdAt
      ) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.users.push(next);
      changed = true;
    }
  }

  for (const member of members) {
    const existing = state.workspaceMembers.find((item) => item.id === member.id);
    const next = {
      id: member.id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      role: workspaceRoleFromPrisma(member.role)
    };

    if (existing) {
      if (
        existing.workspaceId !== next.workspaceId ||
        existing.userId !== next.userId ||
        existing.role !== next.role
      ) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.workspaceMembers.push(next);
      changed = true;
    }
  }

  for (const account of authAccounts) {
    const existing = state.authAccounts.find((item) => item.id === account.id);
    const next = {
      id: account.id,
      userId: account.userId,
      email: account.email,
      passwordHash: account.passwordHash,
      status: authAccountStatusFromPrisma(account.status),
      emailVerifiedAt: account.emailVerifiedAt?.toISOString(),
      passwordUpdatedAt: account.passwordUpdatedAt?.toISOString(),
      lastLoginAt: account.lastLoginAt?.toISOString(),
      failedLoginCount: account.failedLoginCount,
      lockedUntil: account.lockedUntil?.toISOString(),
      mfaEnabled: account.mfaEnabled,
      superadmin: account.superadmin,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };

    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.authAccounts.push(next);
      changed = true;
    }
  }

  for (const session of authSessions) {
    const existing = state.authSessions.find((item) => item.id === session.id);
    const next = {
      id: session.id,
      userId: session.userId,
      workspaceId: session.workspaceId,
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString(),
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      ipAddress: session.ipAddress ?? undefined,
      userAgent: session.userAgent ?? undefined
    };

    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.authSessions.push(next);
      changed = true;
    }
  }

  // Invites are also written by the prisma fast path (accept flips status to
  // "Accepted"), so reconcile them like the rows above — otherwise the blob
  // keeps stale "Pending" invites and the /access page never clears them.
  if (!Array.isArray(state.userInvites)) {
    state.userInvites = [];
  }
  for (const invite of userInvites) {
    const existing = state.userInvites.find((item) => item.id === invite.id);
    const next = {
      id: invite.id,
      workspaceId: invite.workspaceId,
      email: invite.email,
      role: workspaceRoleFromPrisma(invite.role),
      tokenHash: invite.tokenHash,
      invitedById: invite.invitedById,
      status: inviteStatusFromPrisma(invite.status),
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString(),
      createdAt: invite.createdAt.toISOString()
    };

    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        Object.assign(existing, next);
        changed = true;
      }
    } else {
      state.userInvites.push(next);
      changed = true;
    }
  }

  // Self-heal: an invite whose invitee already has an active account has, by
  // definition, been accepted. The prisma fast path sets the invite "Accepted"
  // but only in the DB, and a later blob→prisma projection resets it from the
  // stale snapshot — so a plain reconcile can't clear it. Key off the account.
  for (const invite of state.userInvites) {
    if (invite.status !== "Pending") continue;
    const email = invite.email.toLowerCase();
    const user = state.users.find((item) => item.email.toLowerCase() === email);
    const account = user && state.authAccounts.find((item) => item.userId === user.id && item.status === "Active");
    if (account) {
      invite.status = "Accepted";
      invite.acceptedAt = invite.acceptedAt ?? account.emailVerifiedAt ?? account.updatedAt;
      changed = true;
    }
  }

  return { changed };
}

async function writeStateToPrisma(
  state: AppState,
  client: PrismaStoreClient,
  normalizedOptions: SyncNormalizedProjectionOptions = {},
  casWriteSeq?: number
) {
  // Blob-migration Phase 2: callLogs + notes are native-only. Capture the append-only
  // rows with the FK-safe mapping, then clear them from the state BEFORE the snapshot
  // write (so the blob JSON stays small) and flush them into prisma AFTER the
  // projection below (so their FK parents — accounts/crmContacts/users — exist).
  const callLogRows = mapCallLogsToRows(state);
  const noteRows = mapNotesToRows(state);
  state.callLogs = [];
  state.notes = [];

  if (casWriteSeq === undefined) {
    // Unconditional write: first-boot seed, the read-path self-heal, and a
    // writeState of freshly-built (never-read) state. These don't compare — but
    // they DO increment writeSeq, so any concurrent CAS writer whose baseline
    // predates this write conflicts and retries on fresh state instead of
    // silently reverting it.
    await timeAsync("state.prisma.snapshotUpsert", () => client.appStateSnapshot.upsert({
      where: { id: stateSnapshotId },
      update: {
        version: state.version,
        state: state as unknown as Prisma.InputJsonValue,
        writeSeq: { increment: 1 }
      },
      create: {
        id: stateSnapshotId,
        version: state.version,
        state: state as unknown as Prisma.InputJsonValue
      }
    }), { snapshotId: stateSnapshotId, ...stateCountMetadata(state) });
  } else {
    // Compare-and-set: persist only if writeSeq is still what we read at the start
    // of this transaction. A concurrent commit bumped it, so this matches 0 rows —
    // throw so updateState/updateAuthState retry the whole transaction against the
    // now-current state instead of clobbering the other writer's changes.
    const cas = await timeAsync("state.prisma.snapshotCas", () => client.appStateSnapshot.updateMany({
      where: { id: stateSnapshotId, writeSeq: casWriteSeq },
      data: {
        version: state.version,
        state: state as unknown as Prisma.InputJsonValue,
        writeSeq: casWriteSeq + 1
      }
    }), { snapshotId: stateSnapshotId, expectedWriteSeq: casWriteSeq, ...stateCountMetadata(state) });
    if (cas.count !== 1) {
      throw new WriteConflictError();
    }
  }
  await syncNormalizedProjectionToPrisma(
    state,
    client as unknown as Parameters<typeof syncNormalizedProjectionToPrisma>[1],
    normalizedOptions
  );

  if (callLogRows.length > 0) {
    await client.callLog.createMany({ data: callLogRows, skipDuplicates: true });
  }
  if (noteRows.length > 0) {
    await client.note.createMany({ data: noteRows, skipDuplicates: true });
  }
}

function normalizedSyncOptions(options: UpdateStateOptions): SyncNormalizedProjectionOptions {
  if (options.skipNormalizedProjection) {
    return { skip: true };
  }
  return options.normalizedTables?.length ? { tables: options.normalizedTables } : {};
}

// Fast write path (now the default): scoped writes delete only removed IDs and
// upsert only rows that actually changed (baseline captured pre-mutation), instead
// of scanning/re-upserting every row in the scoped tables. Diff is proven
// equivalent to full (see projection-diff-equivalence.test.ts); set
// SYNCORE_PROJECTION_MODE=full only to fall back to the slower, fully self-healing
// sync. Only applies to scoped (normalizedTables) writes.
function projectionDiffEnabled() {
  return (process.env.SYNCORE_PROJECTION_MODE ?? "diff").trim().toLowerCase() !== "full";
}

function normalizedTablesLabel(tables: ProjectionTableName[] | undefined) {
  return tables?.length ? tables.join(",") : "all";
}

function stateCountMetadata(state: AppState) {
  return {
    contacts: state.contacts.length,
    companies: state.companies.length,
    emailEvents: state.emailEvents.length,
    sdrAssignments: state.sdrAssignments.length,
    activities: state.activities.length,
    auditLogs: state.auditLogs.length
  };
}

function readInitialStateForPrisma() {
  return createSeedState();
}

export function migrateState(input: AppState): { state: AppState; changed: boolean } {
  let changed = false;
  const state = input;
  const workspaceId = state.workspaces[0]?.id;

  if ((state as { version: number }).version !== 16) {
    state.version = 16;
    changed = true;
  }

  if (!Array.isArray(state.waterfallTemplates)) {
    state.waterfallTemplates = [];
    changed = true;
  }

  if (!Array.isArray(state.fieldSources)) {
    state.fieldSources = [];
    changed = true;
  }

  if (!Array.isArray(state.providerMetricsDaily)) {
    state.providerMetricsDaily = [];
    changed = true;
  }

  const seededManagerMember = state.workspaceMembers.find((member) => member.id === "member-mina");
  if (seededManagerMember?.role === "SDR") {
    seededManagerMember.role = "Manager";
    changed = true;
  }

  if (!Array.isArray(state.providerConnections)) {
    state.providerConnections = workspaceId
      ? createDefaultProviderConnections({
          workspaceId,
          now: new Date().toISOString(),
          actorUserId: state.users[0]?.id
        })
      : [];
    changed = true;
  }

  if (!Array.isArray(state.authAccounts)) {
    state.authAccounts = [];
    changed = true;
  }

  if (!Array.isArray(state.authSessions)) {
    state.authSessions = [];
    changed = true;
  }

  if (!Array.isArray(state.userInvites)) {
    state.userInvites = [];
    changed = true;
  }

  if (!Array.isArray(state.userTileLayouts)) {
    state.userTileLayouts = [];
    changed = true;
  }

  if (!Array.isArray(state.directSendClaims)) {
    state.directSendClaims = [];
    changed = true;
  }

  const authAccountCount = state.authAccounts.length;
  ensureAuthDefaults(state);
  if (state.authAccounts.length !== authAccountCount) {
    changed = true;
  }

  if (!Array.isArray(state.providerCredentialAudits)) {
    state.providerCredentialAudits = [];
    changed = true;
  }

  if (!Array.isArray(state.providerEncryptedSecrets)) {
    state.providerEncryptedSecrets = [];
    changed = true;
  }

  if (!Array.isArray(state.providerJobs)) {
    state.providerJobs = [];
    changed = true;
  }

  if (!Array.isArray(state.providerJobRuns)) {
    state.providerJobRuns = [];
    changed = true;
  }

  if (!Array.isArray(state.providerUsageLedger)) {
    state.providerUsageLedger = [];
    changed = true;
  }

  if (!Array.isArray(state.verificationResults)) {
    state.verificationResults = [];
    changed = true;
  }

  if (!Array.isArray(state.dedupeMatches)) {
    state.dedupeMatches = [];
    changed = true;
  }

  if (!Array.isArray(state.asyncJobRuns)) {
    state.asyncJobRuns = [];
    changed = true;
  }

  if (!Array.isArray(state.jobLogs)) {
    state.jobLogs = [];
    changed = true;
  }

  if (!Array.isArray(state.jobIdempotencyRecords)) {
    state.jobIdempotencyRecords = [];
    changed = true;
  }

  if (!Array.isArray(state.exportRules)) {
    state.exportRules = [];
    changed = true;
  }

  if (!Array.isArray(state.providerCache)) {
    state.providerCache = [];
    changed = true;
  }

  if (!Array.isArray(state.enrichmentResults)) {
    state.enrichmentResults = [];
    changed = true;
  }

  if (!Array.isArray(state.segmentRules)) {
    state.segmentRules = [];
    changed = true;
  }

  if (!Array.isArray(state.recordSegments)) {
    state.recordSegments = [];
    changed = true;
  }

  if (!Array.isArray(state.leadScores)) {
    state.leadScores = [];
    changed = true;
  }

  if (!Array.isArray(state.opportunities)) {
    state.opportunities = [];
    changed = true;
  }

  if (!Array.isArray(state.activities)) {
    state.activities = [];
    changed = true;
  }

  if (!Array.isArray(state.tasks)) {
    state.tasks = [];
    changed = true;
  }

  if (!Array.isArray(state.notes)) {
    state.notes = [];
    changed = true;
  }

  if (!Array.isArray(state.callLogs)) {
    state.callLogs = [];
    changed = true;
  }

  if (!Array.isArray(state.customFields)) {
    state.customFields = [];
    changed = true;
  }

  if (!Array.isArray(state.customFieldValues)) {
    state.customFieldValues = [];
    changed = true;
  }

  if (!Array.isArray(state.sdrTeams)) {
    state.sdrTeams = [];
    changed = true;
  }

  if (!Array.isArray(state.sdrAssignments)) {
    state.sdrAssignments = [];
    changed = true;
  }

  if (!Array.isArray(state.followUpReminders)) {
    state.followUpReminders = [];
    changed = true;
  }

  if (!Array.isArray(state.reassignmentRules)) {
    state.reassignmentRules = [];
    changed = true;
  }

  if (!Array.isArray(state.outreachProviders)) {
    state.outreachProviders = [];
    changed = true;
  }

  if (!Array.isArray(state.outreachCampaigns)) {
    state.outreachCampaigns = [];
    changed = true;
  }

  if (!Array.isArray(state.campaignSequences)) {
    state.campaignSequences = [];
    changed = true;
  }

  if (!Array.isArray(state.sequenceSteps)) {
    state.sequenceSteps = [];
    changed = true;
  }

  if (!Array.isArray(state.emailEvents)) {
    state.emailEvents = [];
    changed = true;
  }

  if (!Array.isArray(state.smsEvents)) {
    state.smsEvents = [];
    changed = true;
  }

  if (!Array.isArray(state.webhookEvents)) {
    state.webhookEvents = [];
    changed = true;
  }

  if (!Array.isArray(state.trackedCalls)) {
    state.trackedCalls = [];
    changed = true;
  }

  if (!Array.isArray(state.sdrCallingSessions)) {
    state.sdrCallingSessions = [];
    changed = true;
  }

  if (!Array.isArray(state.sdrDailyReports)) {
    state.sdrDailyReports = [];
    changed = true;
  }

  if (!Array.isArray(state.reportSnapshots)) {
    state.reportSnapshots = [];
    changed = true;
  }

  if (!Array.isArray(state.retentionPolicies)) {
    state.retentionPolicies = [];
    changed = true;
  }

  if (!Array.isArray(state.retentionRuns)) {
    state.retentionRuns = [];
    changed = true;
  }

  if (!Array.isArray(state.complianceChecklistItems)) {
    state.complianceChecklistItems = [];
    changed = true;
  }

  if (!Array.isArray(state.dataSubjectRequests)) {
    state.dataSubjectRequests = [];
    changed = true;
  }

  if (!Array.isArray(state.deliverabilityAlerts)) {
    state.deliverabilityAlerts = [];
    changed = true;
  }

  if (!Array.isArray(state.aiPersonalizations)) {
    state.aiPersonalizations = [];
    changed = true;
  }

  if (!Array.isArray(state.aiReplyClassifications)) {
    state.aiReplyClassifications = [];
    changed = true;
  }

  if (!Array.isArray(state.aiCallSummaries)) {
    state.aiCallSummaries = [];
    changed = true;
  }

  if (!Array.isArray(state.aiLeadScorePredictions)) {
    state.aiLeadScorePredictions = [];
    changed = true;
  }

  if (!Array.isArray(state.aiIcpRecommendations)) {
    state.aiIcpRecommendations = [];
    changed = true;
  }

  if (!Array.isArray(state.aiDeliverabilityRecommendations)) {
    state.aiDeliverabilityRecommendations = [];
    changed = true;
  }

  if (!Array.isArray(state.aiRevenueInsights)) {
    state.aiRevenueInsights = [];
    changed = true;
  }

  if (!Array.isArray(state.aiAutomationRuns)) {
    state.aiAutomationRuns = [];
    changed = true;
  }

  if (workspaceId) {
    for (const defaultRule of defaultExportRules(workspaceId)) {
      const exists = state.exportRules.some(
        (rule) => rule.id === defaultRule.id && rule.workspaceId === workspaceId
      );

      if (!exists) {
        state.exportRules.push(defaultRule);
        changed = true;
      }
    }
  }

  if (workspaceId && state.segmentRules.length === 0) {
    state.segmentRules = defaultSegmentRules(workspaceId);
    changed = true;
  }

  if (workspaceId && state.verificationResults.length === 0 && state.contacts.length > 0) {
    runWorkspaceVerification(state, workspaceId);
    // Only mark changed if the backfill actually produced rows. Otherwise the
    // empty-array guard re-fires on every read, forcing a self-heal forever.
    if (state.verificationResults.length > 0) changed = true;
  }

  if (workspaceId && state.dedupeMatches.length === 0 && (state.contacts.length > 0 || state.companies.length > 0)) {
    detectWorkspaceDuplicates(state, workspaceId);
    // detectWorkspaceDuplicates on a workspace with no duplicates (e.g. the
    // seeded demo workspace at workspaces[0]) leaves dedupeMatches empty, so an
    // unconditional `changed = true` here re-triggered a full projection on
    // EVERY read. Only mark changed when it actually recorded matches.
    if (state.dedupeMatches.length > 0) changed = true;
  }

  if (workspaceId) {
    const jobDefaults = ensureJobObservabilityDefaults(state, workspaceId);
    changed = jobDefaults.changed || changed;
  }

  if (workspaceId) {
    for (const job of state.leadJobs.filter((item) => item.workspaceId === workspaceId)) {
      if (
        job.estimatedRecords === undefined ||
        job.estimatedCostCents === undefined ||
        job.estimatedCredits === undefined ||
        job.budgetCapCents === undefined ||
        job.budgetStatus === undefined ||
        !Array.isArray(job.preflightSourceEstimates) ||
        job.enrichmentBudgetCents === undefined ||
        job.highValueOnlyEnrichment === undefined
      ) {
        Object.assign(job, phase4JobDefaults(job));
        changed = true;
      }
    }
  }

  if (workspaceId && state.enrichmentResults.length === 0 && (state.contacts.length > 0 || state.companies.length > 0)) {
    runWorkspaceEnrichment(state, workspaceId);
    if (state.enrichmentResults.length > 0) changed = true;
  }

  if (workspaceId) {
    const moneyDefaults = ensureMoneyLedgerDefaults(state, workspaceId);
    changed = moneyDefaults.changed || changed;
  }

  if (workspaceId) {
    const crmDefaults = ensureCrmDefaults(state, workspaceId);
    changed = crmDefaults.changed || changed;
    const sdrDefaults = ensureSdrDefaults(state, workspaceId);
    changed = sdrDefaults.changed || changed;
    const outreachDefaults = ensureOutreachDefaults(state, workspaceId);
    changed = outreachDefaults.changed || changed;
    const complianceDefaults = ensureComplianceDefaults(state, workspaceId);
    changed = complianceDefaults.changed || changed;
    const reportingDefaults = ensureReportingDefaults(state, workspaceId);
    changed = reportingDefaults.changed || changed;
    const aiDefaults = ensureAiDefaults(state, workspaceId);
    changed = aiDefaults.changed || changed;
    const waterfallDefaults = ensureWaterfallDefaults(state, workspaceId);
    changed = waterfallDefaults.changed || changed;
    const prunedTemplates = pruneWaterfallTemplateProviders(state);
    changed = prunedTemplates.changed || changed;
    const providerConnectionDefaults = ensureProviderConnectionsForRegistry(state, workspaceId);
    changed = providerConnectionDefaults.changed || changed;
    const prunedConnections = pruneProviderConnectionsNotInRegistry(state);
    changed = prunedConnections.changed || changed;
  }

  return { state, changed };
}
