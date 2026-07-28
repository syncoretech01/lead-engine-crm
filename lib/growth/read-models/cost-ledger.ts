import {
  type GrowthPage,
  type GrowthPageRequest,
  type GrowthPrismaClient,
  growthPrisma,
  resolvePageSize
} from "@/lib/growth/repositories/client";

/**
 * The cost ledger read model — ONE logical ledger, two storage generations.
 *
 * Golden rule 3 says extend `ProviderUsageLedger` and never create a second
 * ledger. Golden rule 1 says Growth OS models are Prisma-native and never
 * blob-projected. Those cannot both be satisfied literally, because
 * `providerUsageLedger` IS blob-projected — written at `money.ts:139`,
 * `upsertOrder` entry at `persistence-projection.ts:198`, projected at `:466` —
 * so a natively-written row there is absent from the blob and the `deleteMany`
 * at `:1599` deletes it on the next sync.
 *
 * Resolution (CRM-1, recorded in the schema): the native `CostEntry` table is
 * the new generation, and this read model unions it with the legacy rows so
 * every caller still sees a single ledger. It is not a second ledger — it is the
 * same ledger mid-migration, and this file is the seam.
 *
 * 🔴 DO NOT write Growth OS cost rows into `providerUsageLedger`. The projection
 * check cannot catch it: it guards the name `CostEntry`, not that table. The
 * rows would simply disappear.
 *
 * When the blob peel finally happens (post-pilot, v9.1 §32.2), the legacy branch
 * below is deleted and this becomes a plain query. Nothing else has to change,
 * which is the point of putting the seam here rather than at every call site.
 */

export type LedgerEntry = {
  id: string;
  source: "growth" | "legacy";
  workspaceId: string;
  campaignId: string | null;
  stageRunId: string | null;
  provider: string;
  action: string;
  totalCents: number;
  createdAt: Date;
};

export type LedgerQuery = {
  workspaceId: string;
  campaignId?: string;
  stageRunId?: string;
} & GrowthPageRequest;

/**
 * Paginated across both generations.
 *
 * Cursoring over a union of two tables cannot use a single primary-key cursor,
 * so this pages by `createdAt` — the one ordering both generations share. The
 * cursor is an ISO timestamp rather than an id, and the shape is otherwise the
 * same as every other Growth OS read model.
 */
export async function listCostEntries(
  query: LedgerQuery,
  client?: GrowthPrismaClient
): Promise<GrowthPage<LedgerEntry>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(query.pageSize);
  const before = query.cursor ? new Date(query.cursor) : undefined;

  const growthRows = await db.costEntry.findMany({
    where: {
      workspaceId: query.workspaceId,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.stageRunId ? { stageRunId: query.stageRunId } : {}),
      ...(before ? { createdAt: { lt: before } } : {})
    },
    select: {
      id: true,
      workspaceId: true,
      campaignId: true,
      stageRunId: true,
      provider: true,
      action: true,
      totalCents: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1
  });

  // Legacy rows predate campaigns and stage runs entirely, so a query filtered
  // by either can skip them — they cannot match, and the DB should not be asked.
  const legacyRows =
    query.campaignId || query.stageRunId
      ? []
      : await db.providerUsageLedger.findMany({
          where: {
            workspaceId: query.workspaceId,
            ...(before ? { createdAt: { lt: before } } : {})
          },
          select: {
            id: true,
            workspaceId: true,
            provider: true,
            operation: true,
            totalCostCents: true,
            createdAt: true
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: pageSize + 1
        });

  const merged: LedgerEntry[] = [
    ...growthRows.map((row) => ({ ...row, source: "growth" as const })),
    ...legacyRows.map((row) => ({
      id: row.id,
      source: "legacy" as const,
      workspaceId: row.workspaceId,
      campaignId: null,
      stageRunId: null,
      provider: row.provider,
      action: row.operation,
      totalCents: row.totalCostCents,
      createdAt: row.createdAt
    }))
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (merged.length <= pageSize) return { rows: merged, nextCursor: null };
  const page = merged.slice(0, pageSize);
  return { rows: page, nextCursor: page[page.length - 1]?.createdAt.toISOString() ?? null };
}

/**
 * Total spend for a campaign — the number the budget gate compares against the
 * cap (v9.1 §5.7).
 *
 * Aggregated in the database, not by paging rows into memory: a campaign that
 * has run for weeks has more ledger rows than anyone wants to materialise just
 * to add them up.
 *
 * Legacy rows are excluded deliberately, and this is a real semantic choice
 * rather than an oversight: legacy entries carry no `campaignId`, so attributing
 * them to a campaign would be a guess, and a budget gate must never guess
 * upward or downward. Growth OS spend is fully captured by the native table.
 */
export async function campaignSpendCents(
  input: { workspaceId: string; campaignId: string },
  client?: GrowthPrismaClient
): Promise<number> {
  const db = client ?? (await growthPrisma());
  const result = await db.costEntry.aggregate({
    where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
    _sum: { totalCents: true }
  });
  return result._sum.totalCents ?? 0;
}

/** Per-stage actual spend, for the admin dashboard's cost column (v9.1 §20). */
export async function stageRunSpendCents(
  input: { workspaceId: string; stageRunId: string },
  client?: GrowthPrismaClient
): Promise<number> {
  const db = client ?? (await growthPrisma());
  const result = await db.costEntry.aggregate({
    where: { workspaceId: input.workspaceId, stageRunId: input.stageRunId },
    _sum: { totalCents: true }
  });
  return result._sum.totalCents ?? 0;
}
