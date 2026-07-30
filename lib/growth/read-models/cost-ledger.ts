import { FinancialEventKind } from "@prisma/client";
import {
  calculateCampaignFinancialTotals,
  calculateStageFinancialTotals
} from "@/lib/growth/repositories/financial-ledger-repository";
import {
  type GrowthPage,
  type GrowthPageRequest,
  type GrowthPrismaClient,
  growthPrisma,
  resolvePageSize
} from "@/lib/growth/repositories/client";

/**
 * ADR-001 Option C read seam.
 *
 * CostEntry is the only authoritative Growth financial source. The projected
 * ProviderUsageLedger branch is retained solely as labelled operational
 * history. It never contributes to campaign, stage, action, budget, overrun,
 * reconciliation, or unit-economics totals. Linked evidence remains visible
 * as evidence, never as a second financial charge.
 */

export type LedgerEntry = {
  id: string;
  source: "growth_financial" | "legacy_operational_evidence";
  sourceGeneration: 2 | 1;
  isAuthoritativeFinancial: boolean;
  workspaceId: string;
  campaignId: string | null;
  stageRunId: string | null;
  provider: string | null;
  service: string | null;
  action: string;
  eventKind: FinancialEventKind | null;
  currency: string | null;
  /** Signed authoritative financial effect; null for operational evidence. */
  financialEffectCents: number | null;
  /** Provider-reported telemetry only; never included in financial totals. */
  operationalReportedCostCents: number | null;
  occurredAt: Date | null;
  createdAt: Date;
};

export type LedgerQuery = {
  workspaceId: string;
  campaignId?: string;
  stageRunId?: string;
} & GrowthPageRequest;

type LedgerCursor = {
  createdAt: string;
  sourceGeneration: 2 | 1;
  id: string;
};

function encodeCursor(entry: LedgerEntry): string {
  const cursor: LedgerCursor = {
    createdAt: entry.createdAt.toISOString(),
    sourceGeneration: entry.sourceGeneration,
    id: entry.id
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): LedgerCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<LedgerCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      (parsed.sourceGeneration !== 1 && parsed.sourceGeneration !== 2) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid cursor fields");
    }
    return parsed as LedgerCursor;
  } catch {
    throw new Error("Invalid cost-ledger cursor.");
  }
}

function cursorWhere(
  cursor: LedgerCursor | null,
  sourceGeneration: 2 | 1
): { OR?: Array<{ createdAt: { lt?: Date; lte?: Date; equals?: Date } } | { createdAt: Date; id: { lt: string } }> } {
  if (!cursor) return {};
  const timestamp = new Date(cursor.createdAt);
  if (sourceGeneration < cursor.sourceGeneration) {
    return { OR: [{ createdAt: { lt: timestamp } }, { createdAt: { equals: timestamp } }] };
  }
  if (sourceGeneration > cursor.sourceGeneration) {
    return { OR: [{ createdAt: { lt: timestamp } }] };
  }
  return { OR: [{ createdAt: { lt: timestamp } }, { createdAt: timestamp, id: { lt: cursor.id } }] };
}

function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
  const timestamp = b.createdAt.getTime() - a.createdAt.getTime();
  if (timestamp !== 0) return timestamp;
  const generation = b.sourceGeneration - a.sourceGeneration;
  if (generation !== 0) return generation;
  return b.id.localeCompare(a.id);
}

function financialEffect(
  kind: FinancialEventKind | null,
  amountCents: number | null,
  reversedAmountCents: number | null
): number | null {
  if (!kind || amountCents === null) return null;
  if (kind === FinancialEventKind.ACTUAL || kind === FinancialEventKind.ADJUSTMENT) return amountCents;
  if (kind === FinancialEventKind.REVERSAL) {
    if (reversedAmountCents === null) throw new Error("Financial reversal is missing its target amount.");
    return -reversedAmountCents;
  }
  return 0;
}

/**
 * Stable total ordering is (createdAt DESC, sourceGeneration DESC, id DESC).
 * The opaque cursor contains all three components, so equal timestamps cannot
 * skip or repeat rows across the two physical stores.
 */
export async function listCostEntries(
  query: LedgerQuery,
  client?: GrowthPrismaClient
): Promise<GrowthPage<LedgerEntry>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(query.pageSize);
  const cursor = decodeCursor(query.cursor);

  const growthRows = await db.costEntry.findMany({
    where: {
      workspaceId: query.workspaceId,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.stageRunId ? { stageRunId: query.stageRunId } : {}),
      ...cursorWhere(cursor, 2)
    },
    select: {
      id: true,
      workspaceId: true,
      campaignId: true,
      stageRunId: true,
      provider: true,
      service: true,
      action: true,
      eventKind: true,
      currency: true,
      amountCents: true,
      reversesCostEntry: { select: { amountCents: true } },
      occurredAt: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1
  });

  // Legacy rows have no authoritative Campaign or stage attribution. They are
  // always labelled non-financial, including when an ACTUAL references one.
  const legacyRows =
    query.campaignId || query.stageRunId
      ? []
      : await db.providerUsageLedger.findMany({
          where: {
            workspaceId: query.workspaceId,
            ...cursorWhere(cursor, 1)
          },
          select: {
            id: true,
            workspaceId: true,
            provider: true,
            operation: true,
            totalCostCents: true,
            currency: true,
            createdAt: true
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: pageSize + 1
        });

  const merged: LedgerEntry[] = [
    ...growthRows.map((row) => ({
      id: row.id,
      source: "growth_financial" as const,
      sourceGeneration: 2 as const,
      isAuthoritativeFinancial: row.eventKind !== null,
      workspaceId: row.workspaceId,
      campaignId: row.campaignId,
      stageRunId: row.stageRunId,
      provider: row.provider,
      service: row.service,
      action: row.action,
      eventKind: row.eventKind,
      currency: row.currency,
      financialEffectCents: financialEffect(
        row.eventKind,
        row.amountCents,
        row.reversesCostEntry?.amountCents ?? null
      ),
      operationalReportedCostCents: null,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt
    })),
    ...legacyRows.map((row) => ({
      id: row.id,
      source: "legacy_operational_evidence" as const,
      sourceGeneration: 1 as const,
      isAuthoritativeFinancial: false,
      workspaceId: row.workspaceId,
      campaignId: null,
      stageRunId: null,
      provider: row.provider,
      service: null,
      action: row.operation,
      eventKind: null,
      currency: row.currency,
      financialEffectCents: null,
      operationalReportedCostCents: row.totalCostCents,
      occurredAt: null,
      createdAt: row.createdAt
    }))
  ].sort(compareEntries);

  if (merged.length <= pageSize) return { rows: merged, nextCursor: null };
  const page = merged.slice(0, pageSize);
  return { rows: page, nextCursor: encodeCursor(page[page.length - 1]!) };
}

/** Authoritative campaign actual spend. Operational evidence never enters this calculation. */
export async function campaignSpendCents(
  input: { workspaceId: string; campaignId: string },
  client?: GrowthPrismaClient
): Promise<number> {
  return (await calculateCampaignFinancialTotals(input, client)).actualCents;
}

/** Authoritative stage actual spend. CampaignStageRun.actualCostCents is only a reconstructible cache. */
export async function stageRunSpendCents(
  input: { workspaceId: string; stageRunId: string },
  client?: GrowthPrismaClient
): Promise<number> {
  return (await calculateStageFinancialTotals(input, client)).actualCents;
}
