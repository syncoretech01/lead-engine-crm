import { Prisma } from "@prisma/client";
import { ApprovalPayload, NicheBriefDocument } from "@syncore/contracts";
import { approvalHashMatches, hashApprovalPayload } from "@/lib/growth/approval-hash";
import {
  enqueueAwaitingSecondApproverNotification,
  enqueueFinalApprovalDecisionNotification
} from "@/lib/growth/approval-notifications";
import {
  type ApprovalRecordRow,
  type DecideApprovalInput,
  type DecideOutcome,
  decideApproval
} from "@/lib/growth/repositories/approval-repository";
import { createCampaignForApprovedNicheTest } from "@/lib/growth/repositories/campaign-repository";
import {
  type GrowthPrismaClient,
  growthPrisma
} from "@/lib/growth/repositories/client";
import { markNicheBriefApproved } from "@/lib/growth/repositories/niche-brief-repository";
import {
  DEFAULT_GROWTH_TRANSACTION_ATTEMPTS,
  runSerializableGrowthTransaction
} from "@/lib/growth/transaction";

/** Integrity/policy failures are conflicts with authoritative persisted state. */
export const APPROVAL_APPLICATION_ERROR_CODES = [
  "APPROVAL_EXPIRED",
  "INVALID_APPROVAL_PAYLOAD",
  "INVALID_APPROVAL_HASH",
  "MISSING_NICHE_REQUEST",
  "MISSING_RESEARCH_RUN",
  "MISSING_NICHE_BRIEF",
  "CROSS_WORKSPACE_APPROVAL_CHAIN",
  "INVALID_APPROVAL_CHAIN",
  "NICHE_BRIEF_NOT_ACTIONABLE"
] as const;

export type ApprovalApplicationErrorCode = (typeof APPROVAL_APPLICATION_ERROR_CODES)[number];

export class ApprovalApplicationError extends Error {
  constructor(
    public readonly code: ApprovalApplicationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApprovalApplicationError";
  }
}

export function isApprovalApplicationError(error: unknown): error is ApprovalApplicationError {
  return error instanceof ApprovalApplicationError;
}

export type ApprovalDecisionApplicationResult = DecideOutcome & {
  campaignId?: string;
  sideEffectsApplied?: boolean;
};

export type ApprovalOrchestrationOptions = {
  client?: GrowthPrismaClient;
  now?: Date;
  maxTransactionAttempts?: number;
  /** Test seam executed after every write but before commit to prove rollback. */
  beforeCommit?: (context: {
    approvalId: string;
    outcome: DecideOutcome["outcome"];
    campaignId?: string;
  }) => Promise<void> | void;
};

type NicheApprovalContext = {
  payload: Extract<ReturnType<typeof ApprovalPayload.parse>, { type: "NICHE_TEST" }>;
  brief: {
    id: string;
    workspaceId: string;
    nicheRequestId: string;
    researchRunId: string;
    approvalId: string | null;
    document: Prisma.JsonValue;
    status: string;
  };
  researchRun: {
    id: string;
    workspaceId: string;
    nicheRequestId: string;
    nicheBriefId: string | null;
    status: string;
    completedAt: Date | null;
  };
};

/** Serialize all decisions for one authoritative approval row. */
async function lockApproval(
  tx: GrowthPrismaClient,
  input: { workspaceId: string; approvalId: string }
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Approval"
    WHERE "id" = ${input.approvalId}
      AND "workspaceId" = ${input.workspaceId}
    FOR UPDATE
  `);
  return rows.length === 1;
}

async function loadApproval(
  tx: GrowthPrismaClient,
  input: { workspaceId: string; approvalId: string }
): Promise<ApprovalRecordRow | null> {
  return (await tx.approval.findFirst({
    where: { id: input.approvalId, workspaceId: input.workspaceId }
  })) as ApprovalRecordRow | null;
}

function validatedApprovalPayload(approval: ApprovalRecordRow) {
  const parsed = ApprovalPayload.safeParse(approval.payloadJson);
  if (!parsed.success || parsed.data.type !== approval.type) {
    throw new ApprovalApplicationError(
      "INVALID_APPROVAL_PAYLOAD",
      `Approval ${approval.id} payload does not match Contracts v0.2.1 or its stored type.`
    );
  }

  const recomputed = hashApprovalPayload(parsed.data);
  if (!approvalHashMatches(approval.payloadSha256, recomputed)) {
    throw new ApprovalApplicationError(
      "INVALID_APPROVAL_HASH",
      `Approval ${approval.id} payload hash does not match its canonical Contracts payload.`
    );
  }
  return parsed.data;
}

async function loadNicheApprovalContext(
  tx: GrowthPrismaClient,
  approval: ApprovalRecordRow
): Promise<NicheApprovalContext> {
  const parsed = validatedApprovalPayload(approval);
  if (parsed.type !== "NICHE_TEST") {
    throw new ApprovalApplicationError(
      "INVALID_APPROVAL_PAYLOAD",
      `Approval ${approval.id} is not a NICHE_TEST approval.`
    );
  }

  const briefById = await tx.nicheBrief.findUnique({
    where: { id: parsed.nicheBriefId },
    select: {
      id: true,
      workspaceId: true,
      nicheRequestId: true,
      researchRunId: true,
      approvalId: true,
      document: true,
      status: true
    }
  });
  if (!briefById) {
    throw new ApprovalApplicationError(
      "MISSING_NICHE_BRIEF",
      `NicheBrief ${parsed.nicheBriefId} linked by approval ${approval.id} does not exist.`
    );
  }
  if (briefById.workspaceId !== approval.workspaceId) {
    throw new ApprovalApplicationError(
      "CROSS_WORKSPACE_APPROVAL_CHAIN",
      `NicheBrief ${briefById.id} is not in approval ${approval.id}'s workspace.`
    );
  }

  const [requestById, runById] = await Promise.all([
    tx.nicheRequest.findUnique({
      where: { id: parsed.nicheRequestId },
      select: { id: true, workspaceId: true, status: true }
    }),
    tx.researchRun.findUnique({
      where: { id: briefById.researchRunId },
      select: {
        id: true,
        workspaceId: true,
        nicheRequestId: true,
        nicheBriefId: true,
        status: true,
        completedAt: true
      }
    })
  ]);

  if (!requestById) {
    throw new ApprovalApplicationError(
      "MISSING_NICHE_REQUEST",
      `NicheRequest ${parsed.nicheRequestId} linked by approval ${approval.id} does not exist.`
    );
  }
  if (!runById) {
    throw new ApprovalApplicationError(
      "MISSING_RESEARCH_RUN",
      `ResearchRun ${briefById.researchRunId} linked by approval ${approval.id} does not exist.`
    );
  }
  if (
    requestById.workspaceId !== approval.workspaceId ||
    runById.workspaceId !== approval.workspaceId
  ) {
    throw new ApprovalApplicationError(
      "CROSS_WORKSPACE_APPROVAL_CHAIN",
      `Approval ${approval.id} links records from different workspaces.`
    );
  }

  const storedBrief = NicheBriefDocument.safeParse(briefById.document);
  const chainMatches =
    briefById.approvalId === approval.id &&
    briefById.nicheRequestId === parsed.nicheRequestId &&
    runById.nicheRequestId === parsed.nicheRequestId &&
    runById.nicheBriefId === briefById.id &&
    runById.status === "completed" &&
    runById.completedAt !== null &&
    requestById.status === "briefed" &&
    storedBrief.success &&
    JSON.stringify(storedBrief.data) === JSON.stringify(parsed.brief);
  if (!chainMatches) {
    throw new ApprovalApplicationError(
      "INVALID_APPROVAL_CHAIN",
      `Approval ${approval.id} does not match its NicheRequest, ResearchRun, and NicheBrief chain.`
    );
  }
  if (briefById.status !== "pending_approval" && briefById.status !== "approved") {
    throw new ApprovalApplicationError(
      "NICHE_BRIEF_NOT_ACTIONABLE",
      `NicheBrief ${briefById.id} is ${briefById.status} and cannot create a campaign.`
    );
  }

  return { payload: parsed, brief: briefById, researchRun: runById };
}

/**
 * Decide an approval and atomically apply the final NICHE_TEST side effects.
 * Both dashboard and chat surfaces call this single orchestration boundary.
 */
export async function decideApprovalWithSideEffects(
  input: DecideApprovalInput,
  options: ApprovalOrchestrationOptions = {}
): Promise<ApprovalDecisionApplicationResult> {
  const db = options.client ?? (await growthPrisma());
  const now = options.now ?? new Date();
  const attempts = Math.max(
    1,
    options.maxTransactionAttempts ?? DEFAULT_GROWTH_TRANSACTION_ATTEMPTS
  );

  return runSerializableGrowthTransaction(db, async (tx) => {
    if (!(await lockApproval(tx, input))) return { outcome: "not_found" };

    const authoritative = await loadApproval(tx, input);
    if (!authoritative) return { outcome: "not_found" };

    let nicheContext: NicheApprovalContext | undefined;
    const shouldValidateNiche =
      input.decision === "approve" &&
      authoritative.type === "NICHE_TEST" &&
      (authoritative.status === "pending" || authoritative.status === "approved");

    if (shouldValidateNiche) {
      // Expiry is NOT checked here any more. It lived in this NICHE_TEST-only
      // branch — the one approval type that gates no paid call — and threw an
      // ApprovalApplicationError, while every other type went unchecked. It is
      // now enforced once, in decideApproval at the repository (rule 5), and
      // reported as an `expired` outcome. Keeping a copy here would give the same
      // condition two shapes: a thrown APPROVAL_EXPIRED for NICHE_TEST and a 409
      // outcome for everything else. Loading the niche context below is a read,
      // and decideApproval refuses the write moments later in the same
      // transaction, so nothing is applied on an expired approval either way.
      nicheContext = await loadNicheApprovalContext(tx, authoritative);
    }

    const decision = await decideApproval({ ...input, now }, tx);
    if (decision.outcome === "not_found") return decision;

    // Nothing was decided, so nothing may be applied. The if-chain below would
    // already fall through to a plain return (the row is still `pending`, so the
    // niche branch cannot be entered), but leaving that implicit means one future
    // reordering silently applies side effects to an expired approval.
    if (decision.outcome === "expired") return decision;

    if (decision.outcome === "awaiting_second_approver") {
      await enqueueAwaitingSecondApproverNotification(tx, decision.approval, now);
      await options.beforeCommit?.({ approvalId: decision.approval.id, outcome: decision.outcome });
      return decision;
    }
    if (decision.outcome === "same_approver_twice") return decision;

    const approval = decision.approval;
    if (approval.status === "superseded") return decision;

    if (approval.status !== "approved" || approval.type !== "NICHE_TEST") {
      if (approval.status === "approved" || approval.status === "declined") {
        await enqueueFinalApprovalDecisionNotification(tx, approval, now);
      }
      await options.beforeCommit?.({ approvalId: approval.id, outcome: decision.outcome });
      return decision;
    }

    const context = nicheContext ?? (await loadNicheApprovalContext(tx, approval));
    const marked = await markNicheBriefApproved(
      { workspaceId: approval.workspaceId, nicheBriefId: context.brief.id },
      tx
    );
    if (!marked && context.brief.status !== "approved") {
      throw new ApprovalApplicationError(
        "NICHE_BRIEF_NOT_ACTIONABLE",
        `NicheBrief ${context.brief.id} could not be marked approved.`
      );
    }

    const campaign = await createCampaignForApprovedNicheTest(
      {
        workspaceId: approval.workspaceId,
        nicheRequestId: context.payload.nicheRequestId,
        researchRunId: context.researchRun.id,
        researchCompletedAt: context.researchRun.completedAt!,
        nicheBriefId: context.brief.id,
        approvalId: approval.id,
        createdBy: approval.decidedBy ?? input.actorId,
        budgetCapCents:
          context.payload.estimatedCostCents ?? context.payload.brief.estimatedCostCents,
        recommendedTestSize: context.payload.brief.recommendedTestSize
      },
      tx
    );

    const appliedApproval = (await tx.approval.update({
      where: { id: approval.id },
      data: {
        campaignId: campaign.id,
        sideEffectsAppliedAt: approval.sideEffectsAppliedAt ?? now
      }
    })) as ApprovalRecordRow;

    await enqueueFinalApprovalDecisionNotification(tx, appliedApproval, now, {
      campaignId: campaign.id,
      nicheRequestId: context.payload.nicheRequestId,
      researchRunId: context.researchRun.id,
      nicheBriefId: context.brief.id
    });
    await options.beforeCommit?.({
      approvalId: appliedApproval.id,
      outcome: decision.outcome,
      campaignId: campaign.id
    });

    return {
      ...decision,
      approval: appliedApproval,
      campaignId: campaign.id,
      sideEffectsApplied: approval.sideEffectsAppliedAt === null
    };
  }, attempts);
}
