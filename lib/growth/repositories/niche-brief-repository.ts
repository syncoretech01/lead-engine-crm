import type { Prisma } from "@prisma/client";
import { NicheBriefDocument } from "@syncore/contracts";
import { hashApprovalPayload } from "@/lib/growth/approval-hash";
import { enqueueApprovalRequestedNotification } from "@/lib/growth/approval-notifications";
import {
  type ApprovalRecordRow,
  createApproval
} from "@/lib/growth/repositories/approval-repository";
import {
  type GrowthPrismaClient,
  growthPrisma
} from "@/lib/growth/repositories/client";
import { runSerializableGrowthTransaction } from "@/lib/growth/transaction";

/**
 * `NicheBrief` — Template B, what research recommends (v9.1 §6, §7).
 *
 * 🔴 THE GUARD THIS FILE EXISTS FOR
 *
 * v9.1 §7 and §26.3: **no `NicheBrief` and no `NICHE_TEST` approval may exist
 * before a `ResearchRun` completes.** v9.1 §24 rates the violation — Template A
 * stored as a brief — a High-impact risk, and it is the exact contradiction v9.1
 * was revised to remove.
 *
 * That rule is enforced three times over, deliberately:
 *
 *   1. `NicheBrief.researchRunId` is a REQUIRED column, so a brief with no run
 *      behind it is not representable at all.
 *   2. `createNicheBriefWithApproval` below refuses unless the referenced run
 *      reads `completed` — a required FK to a *queued* run would still be wrong.
 *   3. The brief and its `NICHE_TEST` approval are created in ONE transaction,
 *      so neither can exist without the other.
 *
 * There is no `createNicheBrief` without the approval, and no way to attach a
 * `NICHE_TEST` approval to anything else. If you need one, the run has to
 * complete first — that is the point.
 */

export type CreateNicheBriefInput = {
  workspaceId: string;
  researchRunId: string;
  /** The Console's niche-brief.json. Validated against contracts here. */
  document: unknown;
  requestedBy: string;
};

export type CreateNicheBriefOptions = {
  now?: Date;
  maxTransactionAttempts?: number;
  /** Test seam executed after every write/outbox upsert but before commit. */
  beforeCommit?: (context: { briefId: string; approvalId: string }) => Promise<void> | void;
};

export class ResearchNotCompleteError extends Error {
  constructor(researchRunId: string, status: string) {
    super(
      `ResearchRun ${researchRunId} is "${status}", not "completed". ` +
        "v9.1 §7: no NicheBrief and no NICHE_TEST approval may exist before research completes."
    );
    this.name = "ResearchNotCompleteError";
  }
}

/**
 * Create the brief and its `NICHE_TEST` approval together, or neither.
 *
 * Returns the brief, the approval, and the request moved to `briefed`.
 */
export async function createNicheBriefWithApproval(
  input: CreateNicheBriefInput,
  client?: GrowthPrismaClient,
  options: CreateNicheBriefOptions = {}
) {
  const db = client ?? (await growthPrisma());
  const now = options.now ?? new Date();
  // Validate before opening the transaction: an invalid document should not
  // hold a write lock, and §9.2 says underivable fields are surfaced for edit,
  // never fabricated — so a malformed brief must fail loudly here.
  const document = NicheBriefDocument.parse(input.document);

  return runSerializableGrowthTransaction(db, async (tx) => {
    if ("$queryRaw" in tx) {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ResearchRun"
        WHERE "id" = ${input.researchRunId}
          AND "workspaceId" = ${input.workspaceId}
        FOR UPDATE
      `;
    }

    const run = await tx.researchRun.findFirst({
      where: { id: input.researchRunId, workspaceId: input.workspaceId },
      select: { id: true, status: true, nicheRequestId: true }
    });
    if (!run) throw new Error(`ResearchRun ${input.researchRunId} not found in workspace`);

    // Guard 2. The required FK alone would happily point at a queued run.
    if (run.status !== "completed") throw new ResearchNotCompleteError(run.id, run.status);

    const existingBrief = await tx.nicheBrief.findFirst({
      where: { researchRunId: run.id, workspaceId: input.workspaceId }
    });
    if (existingBrief) {
      if (!existingBrief.approvalId) {
        throw new Error(`NicheBrief ${existingBrief.id} has no approval.`);
      }
      const approval = (await tx.approval.findFirst({
        where: { id: existingBrief.approvalId, workspaceId: input.workspaceId }
      })) as ApprovalRecordRow | null;
      if (!approval) throw new Error(`Approval ${existingBrief.approvalId} not found in workspace.`);

      const expectedPayload = {
        type: "NICHE_TEST" as const,
        title: `Approve ICP: ${document.niche} / ${document.geography}`,
        summary: `Research scored this niche ${document.priorityScore}/100 and recommends a ${document.recommendedTestSize}-company test.`,
        estimatedCostCents: document.estimatedCostCents,
        nicheRequestId: run.nicheRequestId,
        nicheBriefId: existingBrief.id,
        brief: document
      };
      if (
        approval.type !== "NICHE_TEST" ||
        approval.payloadSha256 !== hashApprovalPayload(expectedPayload)
      ) {
        throw new Error(
          `ResearchRun ${run.id} already has a NicheBrief with different approval content; revise it instead.`
        );
      }

      await enqueueApprovalRequestedNotification(tx, approval, now);
      return { brief: existingBrief, approval };
    }

    const brief = await tx.nicheBrief.create({
      data: {
        workspaceId: input.workspaceId,
        nicheRequestId: run.nicheRequestId,
        researchRunId: run.id,
        document: document as unknown as Prisma.InputJsonValue,
        status: "pending_approval"
      }
    });

    // The NICHE_TEST payload hashes the brief itself — that is what was approved
    // (contracts NicheTestApprovalPayload). No campaignId: this is the one gate
    // that precedes the campaign (v9.1 §7).
    const payload = {
      type: "NICHE_TEST" as const,
      title: `Approve ICP: ${document.niche} / ${document.geography}`,
      summary: `Research scored this niche ${document.priorityScore}/100 and recommends a ${document.recommendedTestSize}-company test.`,
      estimatedCostCents: document.estimatedCostCents,
      nicheRequestId: run.nicheRequestId,
      nicheBriefId: brief.id,
      brief: document
    };

    const approval = await createApproval(
      {
        workspaceId: input.workspaceId,
        payload,
        requestedBy: input.requestedBy,
        idempotencyKey: `niche-test:${run.id}`,
        now
      },
      tx
    );

    await tx.nicheBrief.update({ where: { id: brief.id }, data: { approvalId: approval.id } });
    await tx.researchRun.update({ where: { id: run.id }, data: { nicheBriefId: brief.id } });
    await tx.nicheRequest.update({
      where: { id: run.nicheRequestId },
      data: { status: "briefed" }
    });

    await options.beforeCommit?.({ briefId: brief.id, approvalId: approval.id });
    return { brief: { ...brief, approvalId: approval.id }, approval };
  }, options.maxTransactionAttempts);
}

/**
 * Mark a brief approved once its `NICHE_TEST` approval carries. Kept separate
 * from the approval decide path so the approval repository stays three verbs.
 */
export async function markNicheBriefApproved(
  input: { workspaceId: string; nicheBriefId: string },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const updated = await db.nicheBrief.updateMany({
    where: { id: input.nicheBriefId, workspaceId: input.workspaceId, status: "pending_approval" },
    data: { status: "approved" }
  });
  return updated.count === 1;
}
