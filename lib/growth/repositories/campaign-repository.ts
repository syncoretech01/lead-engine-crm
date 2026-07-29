import type { Prisma, StageRunStatus, StageType } from "@prisma/client";
import {
  type GrowthPage,
  type GrowthPageRequest,
  type GrowthPrismaClient,
  buildPage,
  cursorArgs,
  growthPrisma,
  inGrowthTransaction,
  resolvePageSize
} from "@/lib/growth/repositories/client";
import { assertStageRunTransition } from "@/lib/growth/stage-run-transitions";

/**
 * `Campaign` and `CampaignStageRun` (v9.1 §6, §11).
 *
 * `Campaign` is the universal parent — orphan work is a bug (§26.1) — and every
 * real stage is a `CampaignStageRun`, which is the single source for the admin
 * dashboard, chat status, cost reports, retries and progress %.
 */

export type CreateCampaignInput = {
  workspaceId: string;
  nicheBriefId: string;
  createdBy: string;
  budgetCapCents: number;
  spendWarnThresholdPct?: number;
  overrunTolerancePct?: number;
  killRuleConfig?: unknown;
  hubSegmentId?: string;
  eligibilityPolicyId?: string;
};

/**
 * A campaign may only be created from an APPROVED brief (v9.1 §7: "on accept:
 * Campaign created"). Creating one from a pending brief would mean the ICP gate
 * had been skipped.
 */
export async function createCampaign(input: CreateCampaignInput, client?: GrowthPrismaClient) {
  const db = client ?? (await growthPrisma());

  return inGrowthTransaction(db, async (tx) => {
    const brief = await tx.nicheBrief.findFirst({
      where: { id: input.nicheBriefId, workspaceId: input.workspaceId },
      select: { id: true, status: true }
    });
    if (!brief) throw new Error(`NicheBrief ${input.nicheBriefId} not found in workspace`);
    if (brief.status !== "approved") {
      throw new Error(
        `NicheBrief ${brief.id} is "${brief.status}"; a campaign may only be created from an approved brief (v9.1 §7).`
      );
    }

    return tx.campaign.create({
      data: {
        workspaceId: input.workspaceId,
        nicheBriefId: brief.id,
        createdBy: input.createdBy,
        budgetCapCents: input.budgetCapCents,
        spendWarnThresholdPct: input.spendWarnThresholdPct ?? 80,
        overrunTolerancePct: input.overrunTolerancePct ?? 20,
        killRuleConfig: (input.killRuleConfig ?? {}) as Prisma.InputJsonValue,
        hubSegmentId: input.hubSegmentId ?? null,
        eligibilityPolicyId: input.eligibilityPolicyId ?? null,
        status: "DRAFT"
      }
    });
  });
}

export async function createStageRun(
  input: {
    workspaceId: string;
    campaignId: string;
    stageType: StageType;
    estimatedCostCents?: number;
    estimatedRecords?: number;
    provider?: string;
  },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  return db.campaignStageRun.create({
    data: {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      stageType: input.stageType,
      status: "PENDING",
      estimatedCostCents: input.estimatedCostCents ?? 0,
      estimatedRecords: input.estimatedRecords ?? 0,
      provider: input.provider ?? null
    }
  });
}

export type TransitionStageRunInput = {
  workspaceId: string;
  stageRunId: string;
  to: StageRunStatus;
  failureCode?: string;
  inputRecords?: number;
  outputRecords?: number;
  actualCostCents?: number;
};

/**
 * The only way a stage run's status changes.
 *
 * The legality check reads the current row inside the transaction, so two
 * concurrent transitions cannot both see the old state and both be allowed —
 * a check done outside the write would be a race.
 */
export async function transitionStageRun(
  input: TransitionStageRunInput,
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());

  return inGrowthTransaction(db, async (tx) => {
    const run = await tx.campaignStageRun.findFirst({
      where: { id: input.stageRunId, workspaceId: input.workspaceId },
      select: { id: true, status: true, retryCount: true }
    });
    if (!run) return null;

    // Throws IllegalStageRunTransitionError, naming the legal targets.
    assertStageRunTransition(run.status, input.to);

    const isRetry = run.status === "FAILED" && input.to === "RUNNING";

    return tx.campaignStageRun.update({
      where: { id: run.id },
      data: {
        status: input.to,
        retryCount: isRetry ? run.retryCount + 1 : run.retryCount,
        // Clear the failure on a retry: a stale failureCode on a RUNNING row
        // would make the dashboard show a live stage as broken.
        failureCode: input.to === "FAILED" ? (input.failureCode ?? null) : null,
        startedAt: input.to === "RUNNING" ? new Date() : undefined,
        completedAt:
          input.to === "COMPLETED" || input.to === "FAILED" || input.to === "CANCELLED"
            ? new Date()
            : undefined,
        inputRecords: input.inputRecords ?? undefined,
        outputRecords: input.outputRecords ?? undefined,
        actualCostCents: input.actualCostCents ?? undefined
      }
    });
  });
}

/** Paginated, workspace-scoped, tight select. */
export async function listCampaigns(
  input: { workspaceId: string } & GrowthPageRequest,
  client?: GrowthPrismaClient
): Promise<GrowthPage<{ id: string }>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(input.pageSize);

  const rows = await db.campaign.findMany({
    where: { workspaceId: input.workspaceId },
    select: {
      id: true,
      status: true,
      budgetCapCents: true,
      nicheBriefId: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...cursorArgs(input.cursor)
  });

  return buildPage(rows, pageSize);
}

/**
 * The campaign's stage timeline — what the admin dashboard reconstructs from
 * (v9.1 §20). Ordered by creation so the pipeline reads in order.
 */
export async function listStageRuns(
  input: { workspaceId: string; campaignId: string } & GrowthPageRequest,
  client?: GrowthPrismaClient
): Promise<GrowthPage<{ id: string }>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(input.pageSize);

  const rows = await db.campaignStageRun.findMany({
    where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
    select: {
      id: true,
      stageType: true,
      status: true,
      estimatedCostCents: true,
      approvedCostCents: true,
      actualCostCents: true,
      inputRecords: true,
      outputRecords: true,
      failureCode: true,
      retryCount: true,
      startedAt: true,
      completedAt: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: pageSize + 1,
    ...cursorArgs(input.cursor)
  });

  return buildPage(rows, pageSize);
}
