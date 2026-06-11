import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ensureAiDefaults } from "@/lib/phase1/ai";
import { ensureComplianceDefaults } from "@/lib/phase1/compliance";
import { ensureCrmDefaults } from "@/lib/phase1/crm";
import { detectWorkspaceDuplicates } from "@/lib/phase1/dedupe";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import { defaultExportRules } from "@/lib/phase1/exporting";
import { ensureJobObservabilityDefaults } from "@/lib/phase1/jobs";
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
import { hasPermission, resolveSession, type SessionSelection } from "@/lib/phase1/auth";
import { runWorkspaceVerification } from "@/lib/phase1/verification";

const dataDir = path.join(process.cwd(), ".syncore-data");
const dataFile = path.join(dataDir, "store.json");
const stateSnapshotId = "syncore-primary-state";

type PrismaStoreClient = PrismaClient | Prisma.TransactionClient;
type UpdateStateOptions = {
  normalizedTables?: ProjectionTableName[];
};

export const sessionCookieNames = {
  userId: "syncore_user_id",
  workspaceId: "syncore_workspace_id"
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

async function getPrismaClient() {
  const module = await import("@/lib/prisma");
  return module.prisma;
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
  return resolveCurrentSession(state ?? (await readState()));
}

export async function getWorkspaceContext(permission?: Permission) {
  const state = await readState();
  const session = await getSession(state);

  if (permission && !hasPermission(session, permission)) {
    const { redirect } = await import("next/navigation");
    redirect("/");
  }

  return { state, session, workspaceId: session.workspace.id };
}

export async function resetStore() {
  await writeState(createSeedState());
}

async function resolveCurrentSession(state: AppState) {
  const selection = await readSessionSelection();
  return resolveSession(state, selection);
}

async function readSessionSelection(): Promise<SessionSelection> {
  const envSelection: SessionSelection = {
    userId: process.env.SYNCORE_SESSION_USER_ID,
    workspaceId: process.env.SYNCORE_SESSION_WORKSPACE_ID
  };

  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();

    return {
      userId: cookieStore.get(sessionCookieNames.userId)?.value ?? envSelection.userId,
      workspaceId: cookieStore.get(sessionCookieNames.workspaceId)?.value ?? envSelection.workspaceId
    };
  } catch {
    return envSelection;
  }
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

  if ((state as { version: number }).version !== 12) {
    state.version = 12;
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

  if (!Array.isArray(state.providerCredentialAudits)) {
    state.providerCredentialAudits = [];
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

  if (workspaceId && state.exportRules.length === 0) {
    state.exportRules = defaultExportRules(workspaceId);
    changed = true;
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

  if (workspaceId && state.enrichmentResults.length === 0 && (state.contacts.length > 0 || state.companies.length > 0)) {
    runWorkspaceEnrichment(state, workspaceId);
    changed = true;
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
