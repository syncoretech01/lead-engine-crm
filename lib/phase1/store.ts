import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
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
  syncNormalizedProjectionToPrisma,
  type ProjectionTableName,
  type SyncNormalizedProjectionOptions
} from "@/lib/phase1/persistence-projection";
import { createDefaultProviderConnections } from "@/lib/phase1/provider-connections";
import { ensureReportingDefaults } from "@/lib/phase1/reporting";
import { createSeedState } from "@/lib/phase1/seed";
import { defaultSegmentRules } from "@/lib/phase1/scoring";
import { ensureSdrDefaults } from "@/lib/phase1/sdr";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, AuditLog, Permission, Session } from "@/lib/phase1/types";
import { defaultWorkspacePath, hasPermission, resolveSession, type SessionSelection } from "@/lib/phase1/auth";
import { runWorkspaceVerification } from "@/lib/phase1/verification";

const dataDir = path.join(process.cwd(), ".syncore-data");
const dataFile = path.join(dataDir, "store.json");
export const stateSnapshotId = "syncore-primary-state";

type PrismaStoreClient = PrismaClient | Prisma.TransactionClient;
type UpdateStateOptions = {
  normalizedTables?: ProjectionTableName[];
};

export const sessionCookieNames = {
  userId: legacyDemoSessionCookieNames.userId,
  workspaceId: legacyDemoSessionCookieNames.workspaceId
} as const;

export async function readState(): Promise<AppState> {
  if (resolveStorageDriver() === "prisma") {
    return readStateFromPrisma(await getPrismaClient());
  }

  return readStateFromFile();
}

export async function writeState(state: AppState) {
  if (resolveStorageDriver() === "prisma") {
    await writeStateToPrisma(state, await getPrismaClient());
    return;
  }

  writeStateToFile(state);
}

export async function updateState<T>(
  mutator: (state: AppState, session: Session) => T,
  options: UpdateStateOptions = {}
): Promise<T> {
  if (resolveStorageDriver() === "prisma") {
    const client = await getPrismaClient();
    return client.$transaction(
      async (tx) => {
        const state = await readStateFromPrisma(tx);
        const session = await resolveCurrentSession(state);
        const result = mutator(state, session);
        await writeStateToPrisma(state, tx, normalizedSyncOptions(options));
        return result;
      },
      { maxWait: 5_000, timeout: 20_000 }
    );
  }

  const state = readStateFromFile();
  const session = await resolveCurrentSession(state);
  const result = mutator(state, session);
  writeStateToFile(state);
  return result;
}

export async function updateAuthState<T>(
  mutator: (state: AppState) => T,
  options: UpdateStateOptions = {}
): Promise<T> {
  if (resolveStorageDriver() === "prisma") {
    const client = await getPrismaClient();
    return client.$transaction(
      async (tx) => {
        const state = await readStateFromPrisma(tx);
        const result = mutator(state);
        await writeStateToPrisma(state, tx, normalizedSyncOptions(options));
        return result;
      },
      { maxWait: 5_000, timeout: 20_000 }
    );
  }

  const state = readStateFromFile();
  const result = mutator(state);
  writeStateToFile(state);
  return result;
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
    return await resolveCurrentSession(state ?? (await readState()));
  } catch (error) {
    if (isAuthRequiredError(error)) {
      const { redirect } = await import("next/navigation");
      redirect("/login");
    }
    throw error;
  }
}

export async function getWorkspaceContext(permission?: Permission) {
  const state = await readState();
  const session = await getSession(state);

  if (permission && !hasPermission(session, permission)) {
    const { redirect } = await import("next/navigation");
    redirect(defaultWorkspacePath(session));
  }

  return { state, session, workspaceId: session.workspace.id };
}

export async function getDeveloperWorkspaceContext() {
  return getWorkspaceContext("manage_workspace");
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
  if (resolveStorageDriver() === "prisma") {
    const client = await getPrismaClient();
    const snapshot = await client.appStateSnapshot.findUnique({ where: { id: stateSnapshotId } });
    return Boolean(snapshot);
  }

  return existsSync(dataFile);
}

async function resolveCurrentSession(state: AppState) {
  const selection = await readSessionSelection(state);
  return resolveSession(state, selection);
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

function allowLegacyDemoSession() {
  return process.env.SYNCORE_ALLOW_DEMO_SESSION === "true";
}

function isAuthRequiredError(error: unknown) {
  return error instanceof Error && /Authentication required/i.test(error.message);
}

function readStateFromFile(): AppState {
  ensureFileStore();
  const raw = readFileSync(dataFile, "utf8");
  const parsed = JSON.parse(raw) as AppState;
  const { state, changed } = migrateState(parsed);
  if (changed) {
    writeStateToFile(state);
  }
  return state;
}

function writeStateToFile(state: AppState) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function ensureFileStore() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (!existsSync(dataFile)) {
    writeStateToFile(createSeedState());
  }
}

async function readStateFromPrisma(client: PrismaStoreClient): Promise<AppState> {
  const snapshot = await client.appStateSnapshot.findUnique({
    where: { id: stateSnapshotId }
  });

  if (!snapshot) {
    const state = readInitialStateForPrisma();
    await writeStateToPrisma(state, client);
    return state;
  }

  const parsed = snapshot.state as unknown as AppState;
  const { state, changed } = migrateState(parsed);
  if (changed || snapshot.version !== state.version) {
    await writeStateToPrisma(state, client);
  }

  return state;
}

async function writeStateToPrisma(
  state: AppState,
  client: PrismaStoreClient,
  normalizedOptions: SyncNormalizedProjectionOptions = {}
) {
  await client.appStateSnapshot.upsert({
    where: { id: stateSnapshotId },
    update: {
      version: state.version,
      state: state as unknown as Prisma.InputJsonValue
    },
    create: {
      id: stateSnapshotId,
      version: state.version,
      state: state as unknown as Prisma.InputJsonValue
    }
  });
  await syncNormalizedProjectionToPrisma(
    state,
    client as unknown as Parameters<typeof syncNormalizedProjectionToPrisma>[1],
    normalizedOptions
  );
}

function normalizedSyncOptions(options: UpdateStateOptions): SyncNormalizedProjectionOptions {
  return options.normalizedTables?.length ? { tables: options.normalizedTables } : {};
}

function readInitialStateForPrisma() {
  if (existsSync(dataFile)) {
    return readStateFromFile();
  }

  return createSeedState();
}

function migrateState(input: AppState): { state: AppState; changed: boolean } {
  let changed = false;
  const state = input;
  const workspaceId = state.workspaces[0]?.id;

  if ((state as { version: number }).version !== 15) {
    state.version = 15;
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

  if (!Array.isArray(state.passwordResetTokens)) {
    state.passwordResetTokens = [];
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
    changed = true;
  }

  if (workspaceId && state.dedupeMatches.length === 0 && (state.contacts.length > 0 || state.companies.length > 0)) {
    detectWorkspaceDuplicates(state, workspaceId);
    changed = true;
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
    changed = true;
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
  }

  return { state, changed };
}
