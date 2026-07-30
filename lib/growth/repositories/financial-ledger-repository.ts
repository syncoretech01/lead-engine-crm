import { createHash } from "node:crypto";
import {
  FinancialEventKind,
  FinancialReconciliationStatus,
  Prisma,
  type CostEntry
} from "@prisma/client";
import {
  growthPrisma,
  type GrowthPrismaClient
} from "@/lib/growth/repositories/client";
import { runSerializableGrowthTransaction } from "@/lib/growth/transaction";

export type SafeFinancialMetadata = Record<string, string | number | boolean | null>;

type FinancialIdentity = {
  provider?: string;
  service?: string;
};

export type FinancialEventCommand = FinancialIdentity & {
  workspaceId: string;
  costActionKey: string;
  idempotencyKey: string;
  sourceSystem: string;
  sourceEventId: string;
  sourceLineId?: string;
  occurredAt: Date;
  currency: string;
  amountCents: number;
  action: string;
  units?: number;
  unit?: string;
  unitCostCents?: number;
  campaignId?: string;
  stageRunId?: string;
  approvalId?: string;
  researchRunId?: string;
  providerJobId?: string;
  providerJobRunId?: string;
  providerUsageLedgerId?: string;
  authorizationSource?: string;
  authorizationId?: string;
  metadata?: SafeFinancialMetadata;
};

export type FinancialCorrectionCommand = {
  workspaceId: string;
  idempotencyKey: string;
  sourceSystem: string;
  sourceEventId: string;
  sourceLineId?: string;
  occurredAt: Date;
  metadata?: SafeFinancialMetadata;
};

export type RecordFinancialEventOptions = {
  maxTransactionAttempts?: number;
  /** Integration-test seam. Throwing here proves the insert rolls back. */
  beforeCommit?: (event: CostEntry) => Promise<void> | void;
};

export type FinancialTotals = {
  currency: string | null;
  estimatedCents: number;
  authorizedCents: number;
  actualCents: number;
};

export class FinancialLedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialLedgerValidationError";
  }
}

export class FinancialReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialReplayConflictError";
  }
}

export class MixedFinancialCurrencyError extends Error {
  constructor(currencies: string[]) {
    super(`Authoritative financial events contain multiple currencies: ${currencies.sort().join(", ")}.`);
    this.name = "MixedFinancialCurrencyError";
  }
}

export class HistoricalFinancialEventError extends Error {
  constructor() {
    super("Pre-foundation CostEntry rows require inventory/reconciliation before authoritative aggregation.");
    this.name = "HistoricalFinancialEventError";
  }
}

const SECRET_OR_PERSONAL_METADATA_KEY =
  /secret|token|password|credential|api.?key|bearer|authorization|callback|payload|body|email|phone|address/i;

const normalizeRequired = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new FinancialLedgerValidationError(`${field} is required.`);
  return normalized;
};

const normalizeOptional = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

function validateInteger(value: number, field: string, minimum?: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new FinancialLedgerValidationError(`${field} must be a safe integer minor-unit value.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new FinancialLedgerValidationError(`${field} must be at least ${minimum}.`);
  }
  return value;
}

function safeMetadata(metadata: SafeFinancialMetadata | undefined): SafeFinancialMetadata {
  if (!metadata) return {};
  const entries = Object.entries(metadata);
  if (entries.length > 64) {
    throw new FinancialLedgerValidationError("Financial metadata may contain at most 64 fields.");
  }
  for (const [key, value] of entries) {
    if (!key.trim() || SECRET_OR_PERSONAL_METADATA_KEY.test(key)) {
      throw new FinancialLedgerValidationError(`Financial metadata key '${key}' is not allowed.`);
    }
    if (typeof value === "string" && value.length > 2_048) {
      throw new FinancialLedgerValidationError(`Financial metadata value '${key}' is too large.`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 65_536) {
    throw new FinancialLedgerValidationError("Financial metadata exceeds 64 KiB.");
  }
  return metadata;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function stableEventId(workspaceId: string, idempotencyKey: string): string {
  return `cost_${sha256(`${workspaceId}:${idempotencyKey}`).slice(0, 24)}`;
}

type NormalizedFinancialEvent = {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  stageRunId: string | null;
  approvalId: string | null;
  researchRunId: string | null;
  providerJobId: string | null;
  providerJobRunId: string | null;
  providerUsageLedgerId: string | null;
  adjustsCostEntryId: string | null;
  reversesCostEntryId: string | null;
  provider: string | null;
  service: string | null;
  action: string;
  costActionKey: string;
  idempotencyKey: string;
  sourceSystem: string;
  sourceEventId: string;
  sourceLineId: string | null;
  eventKind: FinancialEventKind;
  occurredAt: Date;
  currency: string;
  amountCents: number;
  units: number;
  unit: string | null;
  unitCostCents: number;
  totalCents: number;
  reconciliationStatus: FinancialReconciliationStatus;
  authorizationSource: string | null;
  authorizationId: string | null;
  metadata: SafeFinancialMetadata;
  contentSha256: string;
};

export type FinancialEffectTarget = {
  eventKind: FinancialEventKind;
  amountCents: number;
};

/**
 * Signed actual-spend effect used by the compatibility projection and read
 * model. Authoritative bucket totals still derive from event kind and target
 * identity rather than trusting CostEntry.totalCents.
 */
export function actualSpendEffectCents(
  kind: FinancialEventKind,
  amountCents: number,
  reversalTarget?: FinancialEffectTarget
): number {
  if (kind === FinancialEventKind.ACTUAL || kind === FinancialEventKind.ADJUSTMENT) {
    return amountCents;
  }
  if (kind !== FinancialEventKind.REVERSAL) return 0;
  if (!reversalTarget) {
    throw new FinancialLedgerValidationError("A REVERSAL requires its authoritative target effect.");
  }
  if (
    reversalTarget.eventKind === FinancialEventKind.ESTIMATE ||
    reversalTarget.eventKind === FinancialEventKind.AUTHORIZATION
  ) {
    return 0;
  }
  if (
    reversalTarget.eventKind === FinancialEventKind.ACTUAL ||
    reversalTarget.eventKind === FinancialEventKind.ADJUSTMENT
  ) {
    return -reversalTarget.amountCents;
  }
  throw new FinancialLedgerValidationError("A reversal cannot itself be reversed.");
}

function normalizeEvent(
  kind: FinancialEventKind,
  input: FinancialEventCommand,
  links: {
    adjustsCostEntryId?: string;
    reversesCostEntryId?: string;
    reversalTarget?: FinancialEffectTarget;
  } = {}
): NormalizedFinancialEvent {
  const provider = normalizeOptional(input.provider) ?? null;
  const service = normalizeOptional(input.service) ?? null;
  if ((provider ? 1 : 0) + (service ? 1 : 0) !== 1) {
    throw new FinancialLedgerValidationError("Exactly one provider or non-provider service identity is required.");
  }
  if (input.stageRunId && !input.campaignId) {
    throw new FinancialLedgerValidationError("A stage-linked financial event must also identify its Campaign.");
  }
  if (input.providerJobRunId && !input.providerJobId) {
    throw new FinancialLedgerValidationError("A ProviderJobRun link requires its ProviderJob identity.");
  }
  if (input.providerUsageLedgerId && kind !== FinancialEventKind.ACTUAL) {
    throw new FinancialLedgerValidationError("Operational provider evidence may be linked only to an ACTUAL event.");
  }
  if (kind === FinancialEventKind.AUTHORIZATION && (!input.authorizationSource || !input.authorizationId)) {
    throw new FinancialLedgerValidationError("An AUTHORIZATION requires authorizationSource and authorizationId.");
  }
  const currency = normalizeRequired(input.currency, "currency");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new FinancialLedgerValidationError("currency must be a normalized three-letter uppercase code.");
  }
  const amountCents = validateInteger(input.amountCents, "amountCents");
  if (kind !== FinancialEventKind.ADJUSTMENT && amountCents < 0) {
    throw new FinancialLedgerValidationError(`${kind} amountCents must be non-negative.`);
  }
  if (kind === FinancialEventKind.ADJUSTMENT && amountCents === 0) {
    throw new FinancialLedgerValidationError("An ADJUSTMENT amountCents must be a non-zero signed delta.");
  }
  const units = validateInteger(input.units ?? 0, "units", 0);
  const unitCostCents = validateInteger(input.unitCostCents ?? 0, "unitCostCents", 0);
  const metadata = safeMetadata(input.metadata);
  const event: Omit<NormalizedFinancialEvent, "id" | "contentSha256"> = {
    workspaceId: normalizeRequired(input.workspaceId, "workspaceId"),
    campaignId: normalizeOptional(input.campaignId) ?? null,
    stageRunId: normalizeOptional(input.stageRunId) ?? null,
    approvalId: normalizeOptional(input.approvalId) ?? null,
    researchRunId: normalizeOptional(input.researchRunId) ?? null,
    providerJobId: normalizeOptional(input.providerJobId) ?? null,
    providerJobRunId: normalizeOptional(input.providerJobRunId) ?? null,
    providerUsageLedgerId: normalizeOptional(input.providerUsageLedgerId) ?? null,
    adjustsCostEntryId: normalizeOptional(links.adjustsCostEntryId) ?? null,
    reversesCostEntryId: normalizeOptional(links.reversesCostEntryId) ?? null,
    provider,
    service,
    action: normalizeRequired(input.action, "action"),
    costActionKey: normalizeRequired(input.costActionKey, "costActionKey"),
    idempotencyKey: normalizeRequired(input.idempotencyKey, "idempotencyKey"),
    sourceSystem: normalizeRequired(input.sourceSystem, "sourceSystem"),
    sourceEventId: normalizeRequired(input.sourceEventId, "sourceEventId"),
    sourceLineId: normalizeOptional(input.sourceLineId) ?? null,
    eventKind: kind,
    occurredAt: input.occurredAt,
    currency,
    amountCents,
    units,
    unit: normalizeOptional(input.unit) ?? null,
    unitCostCents,
    totalCents: actualSpendEffectCents(kind, amountCents, links.reversalTarget),
    reconciliationStatus:
      kind === FinancialEventKind.ACTUAL ||
      kind === FinancialEventKind.ADJUSTMENT ||
      kind === FinancialEventKind.REVERSAL
        ? FinancialReconciliationStatus.PENDING
        : FinancialReconciliationStatus.NOT_APPLICABLE,
    authorizationSource: normalizeOptional(input.authorizationSource) ?? null,
    authorizationId: normalizeOptional(input.authorizationId) ?? null,
    metadata
  };
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
    throw new FinancialLedgerValidationError("occurredAt must be a valid Date.");
  }
  // Command identity deliberately is not part of semantic content: an
  // identical source replay may arrive under a new transport command key and
  // must resolve to the original event, not conflict with it.
  const semanticContent = Object.fromEntries(
    Object.entries({ ...event, occurredAt: event.occurredAt.toISOString() }).filter(
      ([key]) => key !== "idempotencyKey"
    )
  );
  return {
    ...event,
    id: stableEventId(event.workspaceId, event.idempotencyKey),
    contentSha256: sha256(stableJson(semanticContent))
  };
}

async function validateWorkspaceLinks(tx: GrowthPrismaClient, event: NormalizedFinancialEvent): Promise<void> {
  const [workspace, campaign, stageRun, approval, researchRun, providerJob, providerJobRun, evidence] =
    await Promise.all([
      tx.workspace.findUnique({ where: { id: event.workspaceId }, select: { id: true } }),
      event.campaignId
        ? tx.campaign.findUnique({ where: { id: event.campaignId }, select: { workspaceId: true } })
        : null,
      event.stageRunId
        ? tx.campaignStageRun.findUnique({
            where: { id: event.stageRunId },
            select: { workspaceId: true, campaignId: true }
          })
        : null,
      event.approvalId
        ? tx.approval.findUnique({ where: { id: event.approvalId }, select: { workspaceId: true } })
        : null,
      event.researchRunId
        ? tx.researchRun.findUnique({ where: { id: event.researchRunId }, select: { workspaceId: true } })
        : null,
      event.providerJobId
        ? tx.providerJob.findUnique({
            where: { id: event.providerJobId },
            select: { workspaceId: true, providerId: true }
          })
        : null,
      event.providerJobRunId
        ? tx.providerJobRun.findUnique({
            where: { id: event.providerJobRunId },
            select: { workspaceId: true, providerJobId: true, providerId: true }
          })
        : null,
      event.providerUsageLedgerId
        ? tx.providerUsageLedger.findUnique({
            where: { id: event.providerUsageLedgerId },
            select: { workspaceId: true, providerJobId: true, providerJobRunId: true }
          })
        : null
    ]);

  if (!workspace) throw new FinancialLedgerValidationError(`Workspace ${event.workspaceId} does not exist.`);
  const requireWorkspace = (label: string, row: { workspaceId: string } | null, id: string | null) => {
    if (!id) return;
    if (!row) throw new FinancialLedgerValidationError(`${label} ${id} does not exist.`);
    if (row.workspaceId !== event.workspaceId) {
      throw new FinancialLedgerValidationError(`${label} ${id} belongs to another workspace.`);
    }
  };
  requireWorkspace("Campaign", campaign, event.campaignId);
  requireWorkspace("CampaignStageRun", stageRun, event.stageRunId);
  requireWorkspace("Approval", approval, event.approvalId);
  requireWorkspace("ResearchRun", researchRun, event.researchRunId);
  requireWorkspace("ProviderJob", providerJob, event.providerJobId);
  requireWorkspace("ProviderJobRun", providerJobRun, event.providerJobRunId);
  requireWorkspace("ProviderUsageLedger evidence", evidence, event.providerUsageLedgerId);

  if (stageRun && stageRun.campaignId !== event.campaignId) {
    throw new FinancialLedgerValidationError("CampaignStageRun does not belong to the stated Campaign.");
  }
  if (providerJobRun && providerJobRun.providerJobId !== event.providerJobId) {
    throw new FinancialLedgerValidationError("ProviderJobRun does not belong to the stated ProviderJob.");
  }
  if (providerJob && event.provider && providerJob.providerId !== event.provider) {
    throw new FinancialLedgerValidationError("ProviderJob provider does not match the financial provider identity.");
  }
  if (providerJobRun && event.provider && providerJobRun.providerId !== event.provider) {
    throw new FinancialLedgerValidationError("ProviderJobRun provider does not match the financial provider identity.");
  }
  if (evidence?.providerJobId && evidence.providerJobId !== event.providerJobId) {
    throw new FinancialLedgerValidationError("Provider evidence does not match the stated ProviderJob.");
  }
  if (evidence?.providerJobRunId && evidence.providerJobRunId !== event.providerJobRunId) {
    throw new FinancialLedgerValidationError("Provider evidence does not match the stated ProviderJobRun.");
  }
}

async function findReplay(tx: GrowthPrismaClient, event: NormalizedFinancialEvent): Promise<CostEntry | null> {
  const byCommand = await tx.costEntry.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: event.workspaceId,
        idempotencyKey: event.idempotencyKey
      }
    }
  });
  const bySource = await tx.costEntry.findFirst({
    where: {
      workspaceId: event.workspaceId,
      sourceSystem: event.sourceSystem,
      sourceEventId: event.sourceEventId,
      sourceLineId: event.sourceLineId,
      eventKind: event.eventKind
    }
  });
  if (byCommand && bySource && byCommand.id !== bySource.id) {
    throw new FinancialReplayConflictError("Command identity and source identity resolve to different events.");
  }
  const existing = byCommand ?? bySource;
  if (!existing) return null;
  if (existing.contentSha256 !== event.contentSha256) {
    throw new FinancialReplayConflictError("Financial replay identity was reused with conflicting content.");
  }
  return existing;
}

function createData(event: NormalizedFinancialEvent): Prisma.CostEntryUncheckedCreateInput {
  return {
    ...event,
    metadata: event.metadata as Prisma.InputJsonValue,
    status: "RECORDED"
  };
}

const isUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return candidate.code === "P2002" || candidate.code === "23505" || candidate.meta?.code === "23505";
};

async function persistEvent(
  event: NormalizedFinancialEvent,
  client: GrowthPrismaClient | undefined,
  options: RecordFinancialEventOptions
): Promise<CostEntry> {
  const db = client ?? (await growthPrisma());
  const operation = async (tx: GrowthPrismaClient): Promise<CostEntry> => {
    const replay = await findReplay(tx, event);
    if (replay) return replay;
    await validateWorkspaceLinks(tx, event);
    const created = await tx.costEntry.create({ data: createData(event) });
    await options.beforeCommit?.(created);
    return created;
  };
  try {
    return await runSerializableGrowthTransaction(db, operation, options.maxTransactionAttempts);
  } catch (error) {
    // A concurrent winner may satisfy either unique identity after this
    // transaction rolls back. Resolve it outside the failed transaction.
    if (isUniqueViolation(error) && "$transaction" in db) {
      const replay = await findReplay(db, event);
      if (replay) return replay;
    }
    throw error;
  }
}

export async function recordEstimate(
  input: FinancialEventCommand,
  client?: GrowthPrismaClient,
  options: RecordFinancialEventOptions = {}
): Promise<CostEntry> {
  return persistEvent(normalizeEvent(FinancialEventKind.ESTIMATE, input), client, options);
}

export async function recordAuthorization(
  input: FinancialEventCommand & { authorizationSource: string; authorizationId: string },
  client?: GrowthPrismaClient,
  options: RecordFinancialEventOptions = {}
): Promise<CostEntry> {
  return persistEvent(normalizeEvent(FinancialEventKind.AUTHORIZATION, input), client, options);
}

export async function recordActual(
  input: FinancialEventCommand,
  client?: GrowthPrismaClient,
  options: RecordFinancialEventOptions = {}
): Promise<CostEntry> {
  return persistEvent(normalizeEvent(FinancialEventKind.ACTUAL, input), client, options);
}

async function loadCorrectionTarget(
  tx: GrowthPrismaClient,
  workspaceId: string,
  id: string,
  correctionKind: FinancialEventKind
): Promise<CostEntry> {
  const target = await tx.costEntry.findUnique({ where: { id } });
  if (!target) throw new FinancialLedgerValidationError(`Financial event ${id} does not exist.`);
  if (target.workspaceId !== workspaceId) {
    throw new FinancialLedgerValidationError(`Financial event ${id} belongs to another workspace.`);
  }
  if (!target.eventKind || !target.currency || target.amountCents === null || !target.occurredAt || !target.costActionKey) {
    throw new FinancialLedgerValidationError("A pre-foundation CostEntry cannot be corrected without reconciliation.");
  }
  if (target.eventKind === FinancialEventKind.REVERSAL) {
    throw new FinancialLedgerValidationError("A reversal cannot itself be adjusted or reversed.");
  }
  if (correctionKind === FinancialEventKind.ADJUSTMENT && target.eventKind !== FinancialEventKind.ACTUAL) {
    throw new FinancialLedgerValidationError(
      "An ADJUSTMENT may target only an ACTUAL. Correct an ESTIMATE or AUTHORIZATION with a reversal and replacement event."
    );
  }
  return target;
}

function correctionEventInput(
  command: FinancialCorrectionCommand,
  target: CostEntry,
  amountCents: number
): FinancialEventCommand {
  return {
    workspaceId: command.workspaceId,
    costActionKey: target.costActionKey!,
    idempotencyKey: command.idempotencyKey,
    sourceSystem: command.sourceSystem,
    sourceEventId: command.sourceEventId,
    sourceLineId: command.sourceLineId,
    occurredAt: command.occurredAt,
    currency: target.currency!,
    amountCents,
    action: target.action,
    units: 0,
    campaignId: target.campaignId ?? undefined,
    stageRunId: target.stageRunId ?? undefined,
    approvalId: target.approvalId ?? undefined,
    researchRunId: target.researchRunId ?? undefined,
    providerJobId: target.providerJobId ?? undefined,
    providerJobRunId: target.providerJobRunId ?? undefined,
    authorizationSource: target.authorizationSource ?? undefined,
    authorizationId: target.authorizationId ?? undefined,
    provider: target.provider ?? undefined,
    service: target.service ?? undefined,
    metadata: command.metadata
  };
}

async function persistCorrection(
  kind: FinancialEventKind,
  command: FinancialCorrectionCommand,
  targetId: string,
  amount: (target: CostEntry) => number,
  client: GrowthPrismaClient | undefined,
  options: RecordFinancialEventOptions
): Promise<CostEntry> {
  const db = client ?? (await growthPrisma());
  const operation = async (tx: GrowthPrismaClient): Promise<CostEntry> => {
    const target = await loadCorrectionTarget(tx, command.workspaceId, targetId, kind);
    const event = normalizeEvent(kind, correctionEventInput(command, target, amount(target)), {
      ...(kind === FinancialEventKind.ADJUSTMENT ? { adjustsCostEntryId: target.id } : {}),
      ...(kind === FinancialEventKind.REVERSAL
        ? {
            reversesCostEntryId: target.id,
            reversalTarget: { eventKind: target.eventKind!, amountCents: target.amountCents! }
          }
        : {})
    });
    const replay = await findReplay(tx, event);
    if (replay) return replay;
    await validateWorkspaceLinks(tx, event);
    const created = await tx.costEntry.create({ data: createData(event) });
    await options.beforeCommit?.(created);
    return created;
  };
  try {
    return await runSerializableGrowthTransaction(db, operation, options.maxTransactionAttempts);
  } catch (error) {
    if (isUniqueViolation(error) && "$transaction" in db) {
      // Rebuild from the committed target, then resolve the concurrent winner.
      const target = await loadCorrectionTarget(db, command.workspaceId, targetId, kind);
      const event = normalizeEvent(kind, correctionEventInput(command, target, amount(target)), {
        ...(kind === FinancialEventKind.ADJUSTMENT ? { adjustsCostEntryId: target.id } : {}),
        ...(kind === FinancialEventKind.REVERSAL
          ? {
              reversesCostEntryId: target.id,
              reversalTarget: { eventKind: target.eventKind!, amountCents: target.amountCents! }
            }
          : {})
      });
      const replay = await findReplay(db, event);
      if (replay) return replay;
    }
    throw error;
  }
}

export async function recordAdjustment(
  input: FinancialCorrectionCommand & { adjustsCostEntryId: string; amountCents: number },
  client?: GrowthPrismaClient,
  options: RecordFinancialEventOptions = {}
): Promise<CostEntry> {
  validateInteger(input.amountCents, "amountCents");
  if (input.amountCents === 0) throw new FinancialLedgerValidationError("An adjustment cannot be zero.");
  return persistCorrection(
    FinancialEventKind.ADJUSTMENT,
    input,
    input.adjustsCostEntryId,
    () => input.amountCents,
    client,
    options
  );
}

export async function recordReversal(
  input: FinancialCorrectionCommand & { reversesCostEntryId: string },
  client?: GrowthPrismaClient,
  options: RecordFinancialEventOptions = {}
): Promise<CostEntry> {
  return persistCorrection(
    FinancialEventKind.REVERSAL,
    input,
    input.reversesCostEntryId,
    (target) => Math.abs(target.amountCents!),
    client,
    options
  );
}

export async function getFinancialEvent(
  input: { workspaceId: string; id: string },
  client?: GrowthPrismaClient
): Promise<CostEntry | null> {
  const db = client ?? (await growthPrisma());
  return db.costEntry.findFirst({ where: { workspaceId: input.workspaceId, id: input.id } });
}

export async function getCostActionEvents(
  input: { workspaceId: string; costActionKey: string },
  client?: GrowthPrismaClient
): Promise<CostEntry[]> {
  const db = client ?? (await growthPrisma());
  return db.costEntry.findMany({
    where: { workspaceId: input.workspaceId, costActionKey: input.costActionKey },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
  });
}

type TotalsScope = { workspaceId: string; campaignId?: string; stageRunId?: string; costActionKey?: string };

export async function calculateFinancialTotals(
  scope: TotalsScope,
  client?: GrowthPrismaClient
): Promise<FinancialTotals> {
  const db = client ?? (await growthPrisma());
  const rows = await db.costEntry.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(scope.campaignId ? { campaignId: scope.campaignId } : {}),
      ...(scope.stageRunId ? { stageRunId: scope.stageRunId } : {}),
      ...(scope.costActionKey ? { costActionKey: scope.costActionKey } : {})
    },
    select: {
      eventKind: true,
      currency: true,
      amountCents: true,
      reversesCostEntry: { select: { eventKind: true, amountCents: true } }
    }
  });
  if (rows.some((row) => !row.eventKind || !row.currency || row.amountCents === null)) {
    throw new HistoricalFinancialEventError();
  }
  const currencies = [...new Set(rows.map((row) => row.currency!))];
  if (currencies.length > 1) throw new MixedFinancialCurrencyError(currencies);
  const totals: FinancialTotals = {
    currency: currencies[0] ?? null,
    estimatedCents: 0,
    authorizedCents: 0,
    actualCents: 0
  };
  for (const row of rows) {
    const amount = row.amountCents!;
    if (row.eventKind === FinancialEventKind.ESTIMATE) totals.estimatedCents += amount;
    if (row.eventKind === FinancialEventKind.AUTHORIZATION) totals.authorizedCents += amount;
    if (row.eventKind === FinancialEventKind.ACTUAL || row.eventKind === FinancialEventKind.ADJUSTMENT) {
      totals.actualCents += amount;
    }
    if (row.eventKind === FinancialEventKind.REVERSAL) {
      const target = row.reversesCostEntry;
      if (!target?.eventKind || target.amountCents === null) {
        throw new FinancialLedgerValidationError("A reversal is missing its authoritative target.");
      }
      if (target.eventKind === FinancialEventKind.ESTIMATE) totals.estimatedCents -= target.amountCents;
      if (target.eventKind === FinancialEventKind.AUTHORIZATION) totals.authorizedCents -= target.amountCents;
      if (target.eventKind === FinancialEventKind.ACTUAL || target.eventKind === FinancialEventKind.ADJUSTMENT) {
        totals.actualCents -= target.amountCents;
      }
    }
  }
  return totals;
}

export const calculateCostActionTotals = (
  input: { workspaceId: string; costActionKey: string },
  client?: GrowthPrismaClient
) => calculateFinancialTotals(input, client);

export const calculateCampaignFinancialTotals = (
  input: { workspaceId: string; campaignId: string },
  client?: GrowthPrismaClient
) => calculateFinancialTotals(input, client);

export const calculateStageFinancialTotals = (
  input: { workspaceId: string; stageRunId: string },
  client?: GrowthPrismaClient
) => calculateFinancialTotals(input, client);
