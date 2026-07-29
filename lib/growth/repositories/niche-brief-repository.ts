import type { Prisma } from "@prisma/client";
import { NicheBriefDocument } from "@syncore/contracts";
import { hashApprovalPayload } from "@/lib/growth/approval-hash";
import {
  type GrowthPrismaClient,
  growthPrisma,
  inGrowthTransaction
} from "@/lib/growth/repositories/client";

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
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  // Validate before opening the transaction: an invalid document should not
  // hold a write lock, and §9.2 says underivable fields are surfaced for edit,
  // never fabricated — so a malformed brief must fail loudly here.
  const document = NicheBriefDocument.parse(input.document);

  return inGrowthTransaction(db, async (tx) => {
    const run = await tx.researchRun.findFirst({
      where: { id: input.researchRunId, workspaceId: input.workspaceId },
      select: { id: true, status: true, nicheRequestId: true }
    });
    if (!run) throw new Error(`ResearchRun ${input.researchRunId} not found in workspace`);

    // Guard 2. The required FK alone would happily point at a queued run.
    if (run.status !== "completed") throw new ResearchNotCompleteError(run.id, run.status);

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

    const approval = await tx.approval.create({
      data: {
        workspaceId: input.workspaceId,
        type: "NICHE_TEST",
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadSha256: hashApprovalPayload(payload),
        status: "pending",
        requestedBy: input.requestedBy
      }
    });

    await tx.nicheBrief.update({ where: { id: brief.id }, data: { approvalId: approval.id } });
    await tx.researchRun.update({ where: { id: run.id }, data: { nicheBriefId: brief.id } });
    await tx.nicheRequest.update({
      where: { id: run.nicheRequestId },
      data: { status: "briefed" }
    });

    return { brief: { ...brief, approvalId: approval.id }, approval };
  });
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
