import type { Prisma, PrismaClient } from "@prisma/client";
import { ApprovalPayload, type ApprovalStatus, type ApprovalType } from "@syncore/contracts";
import { hashApprovalPayload } from "@/lib/growth/approval-hash";
import {
  enqueueApprovalRequestedNotification,
  enqueueApprovalRevisedNotification
} from "@/lib/growth/approval-notifications";
import { runSerializableGrowthTransaction } from "@/lib/growth/transaction";

/**
 * The Approval repository — v9.1 §10, §26.13.
 *
 * 🔴 THREE VERBS. THERE IS NO FOURTH.
 *
 *   create · decide · revise
 *
 * There is deliberately no `updateApproval`, no `patchApprovalPayload`, no
 * `setApprovalStatus`. The absence IS the contract: an approval's whole meaning
 * is "this exact content was approved", and the stored SHA-256 stops describing
 * that content the moment anyone can edit it in place. Editing is a revision —
 * the original goes `superseded` and a NEW row is created carrying
 * `supersedesApprovalId`, the replacement payload, and a fresh hash.
 *
 * `tests/unit/growth-approval-repository.test.ts` fails if a fourth mutating
 * export appears here, mirroring the same guard in the contracts package.
 *
 * Prisma-native (golden rule 1). Never written through `updateState`, never
 * projected. See the header block in prisma/schema.prisma.
 */

type GrowthPrismaClient = PrismaClient | Prisma.TransactionClient;

const prismaClient = async (): Promise<PrismaClient> => (await import("@/lib/prisma")).prisma;

export type ApprovalRecordRow = {
  id: string;
  workspaceId: string;
  type: ApprovalType;
  campaignId: string | null;
  stageRunId: string | null;
  payloadJson: unknown;
  payloadSha256: string;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  sideEffectsAppliedAt: Date | null;
  firstApprovedBy: string | null;
  firstApprovedAt: Date | null;
  creationKey: string | null;
  supersedesApprovalId: string | null;
  revisionReason: string | null;
  createdAt: Date;
};

export type CreateApprovalInput = {
  workspaceId: string;
  /** Validated and hashed here; callers pass the plain object. */
  payload: unknown;
  requestedBy: string;
  /** Stable identity of the business request, not of this HTTP attempt. */
  idempotencyKey: string;
  /** CRM policy metadata; not part of the immutable Contracts payload/hash. */
  expiresAt?: Date;
  now?: Date;
};

export type DecideApprovalInput = {
  workspaceId: string;
  approvalId: string;
  decision: "approve" | "decline";
  /**
   * Resolved server-side from the chat-identity mapping (v9.1 §15, §23:
   * "identity from signed data"). Never taken from a request body — a
   * `decidedBy` in the body is a claim about who you are.
   */
  actorId: string;
  /** One transaction timestamp, injectable for deterministic orchestration tests. */
  now?: Date;
};

export type ReviseApprovalInput = {
  workspaceId: string;
  approvalId: string;
  /** A COMPLETE replacement payload, never a delta. */
  payload: unknown;
  actorId: string;
  reason?: string;
  now?: Date;
};

export type ReviseApprovalOptions = {
  maxTransactionAttempts?: number;
  /** Test seam executed after all writes and outbox upserts, before commit. */
  beforeCommit?: (context: { originalApprovalId: string; replacementApprovalId: string }) =>
    | Promise<void>
    | void;
};

export type DecideOutcome =
  | { outcome: "decided"; approval: ApprovalRecordRow }
  /** First of two approvers recorded; the approval is still `pending`. */
  | { outcome: "awaiting_second_approver"; approval: ApprovalRecordRow }
  /** Replayed button tap, or someone decided on the other surface. */
  | { outcome: "already_final"; approval: ApprovalRecordRow }
  | { outcome: "same_approver_twice"; approval: ApprovalRecordRow }
  /** Past expiresAt: the estimate it was raised on is stale, so it cannot be approved. */
  | { outcome: "expired"; approval: ApprovalRecordRow }
  | { outcome: "not_found" };

/** Payload fields the record mirrors into columns for indexing. */
function recordColumnsFrom(payload: unknown) {
  const parsed = ApprovalPayload.parse(payload);
  return {
    type: parsed.type,
    campaignId: parsed.campaignId ?? null,
    stageRunId: parsed.stageRunId ?? null,
    estimatedCostCents: parsed.estimatedCostCents ?? 0
  };
}

function sameOptionalInstant(left: Date | null | undefined, right: Date | null | undefined) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

/**
 * Create a pending approval.
 *
 * The hash is computed here, from the parsed payload, and stored alongside it.
 * `approvalId` and `payloadSha256` are NOT part of the hashed content — ERRATA 5.
 */
export async function createApproval(
  input: CreateApprovalInput,
  client?: GrowthPrismaClient
): Promise<ApprovalRecordRow> {
  const db = client ?? (await prismaClient());
  const { type, campaignId, stageRunId } = recordColumnsFrom(input.payload);
  const payloadSha256 = hashApprovalPayload(input.payload);
  const now = input.now ?? new Date();

  return runSerializableGrowthTransaction(db, async (tx) => {
    const existing = (await tx.approval.findUnique({
      where: { creationKey: input.idempotencyKey }
    })) as ApprovalRecordRow | null;
    if (existing) {
      if (
        existing.workspaceId !== input.workspaceId ||
        existing.type !== type ||
        existing.payloadSha256 !== payloadSha256 ||
        existing.requestedBy !== input.requestedBy ||
        !sameOptionalInstant(existing.expiresAt, input.expiresAt)
      ) {
        throw new Error(`Approval idempotency key ${input.idempotencyKey} was reused for different content.`);
      }
      await enqueueApprovalRequestedNotification(tx, existing, now);
      return existing;
    }

    if (input.expiresAt && input.expiresAt <= now) {
      throw new Error("Cannot create an approval that is already expired.");
    }

    const created = (await tx.approval.upsert({
      where: { creationKey: input.idempotencyKey },
      create: {
        workspaceId: input.workspaceId,
        type,
        campaignId,
        stageRunId,
        payloadJson: input.payload as Prisma.InputJsonValue,
        payloadSha256,
        status: "pending",
        requestedBy: input.requestedBy,
        expiresAt: input.expiresAt,
        creationKey: input.idempotencyKey
      },
      update: {}
    })) as ApprovalRecordRow;

    if (
      created.workspaceId !== input.workspaceId ||
      created.type !== type ||
      created.payloadSha256 !== payloadSha256 ||
      created.requestedBy !== input.requestedBy ||
      !sameOptionalInstant(created.expiresAt, input.expiresAt)
    ) {
      throw new Error(`Approval idempotency key ${input.idempotencyKey} was reused for different content.`);
    }

    await enqueueApprovalRequestedNotification(tx, created, now);
    return created;
  });
}

/**
 * Decide a pending approval.
 *
 * Two-person rule (v9.1 §10): at or above the workspace's T2 threshold an
 * approval needs two DISTINCT approvers. Contracts fixes `ApprovalStatus` at
 * four members and its own tests fail if a fifth appears, so the intermediate
 * state is carried by `firstApprovedBy`/`firstApprovedAt` while `status` stays
 * `pending` — not by inventing an `awaiting_second_approver` status.
 *
 * Declines are single-approver by design: the two-person rule exists to slow
 * down spending, and declining spends nothing.
 *
 * Idempotent. A replayed button tap on an already-decided approval returns the
 * final state rather than deciding twice (v9.1 §10).
 */
export async function decideApproval(
  input: DecideApprovalInput,
  client?: GrowthPrismaClient
): Promise<DecideOutcome> {
  const db = client ?? (await prismaClient());

  const run = async (tx: GrowthPrismaClient): Promise<DecideOutcome> => {
    const approval = (await tx.approval.findFirst({
      where: { id: input.approvalId, workspaceId: input.workspaceId }
    })) as ApprovalRecordRow | null;

    if (!approval) return { outcome: "not_found" };
    if (approval.status !== "pending") return { outcome: "already_final", approval };

    if (input.decision === "decline") {
      const declined = (await tx.approval.update({
        where: { id: approval.id },
        data: { status: "declined", decidedBy: input.actorId, decidedAt: input.now ?? new Date() }
      })) as ApprovalRecordRow;
      return { outcome: "decided", approval: declined };
    }

    // Expiry binds EVERY approval type, and it binds here at the repository so no
    // caller can route around it (rule 5). It was previously checked only on the
    // orchestrator's NICHE_TEST path — the one type that gates no paid call.
    //
    // Forward defence: nothing sets expiresAt today. The only createApproval call
    // site is the niche-brief repository, which passes none, so this is inert on
    // current data. It starts mattering when CRM-2/CRM-4 raise the approvals that
    // DO gate spend — PROVIDER_RUN, ENRICHMENT_RUN, PAID_VERIFICATION — where the
    // whole point of a deadline is that a stale cost estimate stops being
    // actionable.
    //
    // Declining is deliberately still allowed above: expiry must not strand a row
    // as permanently undecidable.
    if (approval.expiresAt !== null && approval.expiresAt <= (input.now ?? new Date())) {
      return { outcome: "expired", approval };
    }

    const workspace = await tx.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { approvalThresholdT2Cents: true }
    });
    const t2 = workspace?.approvalThresholdT2Cents ?? null;
    const { estimatedCostCents } = recordColumnsFrom(approval.payloadJson);
    const needsTwo = t2 !== null && estimatedCostCents >= t2;

    if (needsTwo && approval.firstApprovedBy === null) {
      const held = (await tx.approval.update({
        where: { id: approval.id },
        data: { firstApprovedBy: input.actorId, firstApprovedAt: input.now ?? new Date() }
      })) as ApprovalRecordRow;
      return { outcome: "awaiting_second_approver", approval: held };
    }

    // A second distinct human, or the rule does not apply. One person tapping
    // twice is not two-person approval, and letting it through would make the
    // threshold decorative.
    if (needsTwo && approval.firstApprovedBy === input.actorId) {
      return { outcome: "same_approver_twice", approval };
    }

    const approved = (await tx.approval.update({
      where: { id: approval.id },
      data: { status: "approved", decidedBy: input.actorId, decidedAt: input.now ?? new Date() }
    })) as ApprovalRecordRow;
    return { outcome: "decided", approval: approved };
  };

  return "$transaction" in db
    ? await (db as PrismaClient).$transaction((tx) => run(tx))
    : await run(db);
}

/**
 * Revise: supersede the original and create its successor.
 *
 * Both writes happen in one transaction. A half-applied revision would leave
 * either two live approvals for one decision or none, and the revision chain is
 * the audit trail — it cannot be allowed to have a hole in it.
 *
 * The new row gets a fresh SHA-256 over the new payload. Identical content
 * revised twice produces the SAME hash, deliberately: that is how you answer
 * "did the content actually change?", which is the question the chain exists for.
 */
export async function reviseApproval(
  input: ReviseApprovalInput,
  client?: GrowthPrismaClient,
  options: ReviseApprovalOptions = {}
): Promise<
  | { outcome: "revised"; superseded: ApprovalRecordRow; created: ApprovalRecordRow }
  | { outcome: "already_revised"; superseded: ApprovalRecordRow; created: ApprovalRecordRow }
  | { outcome: "already_final"; approval: ApprovalRecordRow }
  | { outcome: "expired"; approval: ApprovalRecordRow }
  | { outcome: "not_found" }
> {
  const db = client ?? (await prismaClient());
  const now = input.now ?? new Date();

  const run = async (tx: GrowthPrismaClient) => {
    if ("$queryRaw" in tx) {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Approval"
        WHERE "id" = ${input.approvalId}
          AND "workspaceId" = ${input.workspaceId}
        FOR UPDATE
      `;
    }

    const original = (await tx.approval.findFirst({
      where: { id: input.approvalId, workspaceId: input.workspaceId }
    })) as ApprovalRecordRow | null;

    if (!original) return { outcome: "not_found" as const };
    if (original.status === "superseded") {
      const created = (await tx.approval.findFirst({
        where: { supersedesApprovalId: original.id, workspaceId: input.workspaceId }
      })) as ApprovalRecordRow | null;
      if (!created) return { outcome: "already_final" as const, approval: original };
      await enqueueApprovalRevisedNotification(tx, original, created);
      await enqueueApprovalRequestedNotification(tx, created, now);
      return { outcome: "already_revised" as const, superseded: original, created };
    }
    if (original.status !== "pending") return { outcome: "already_final" as const, approval: original };
    if (original.expiresAt !== null && original.expiresAt <= now) {
      return { outcome: "expired" as const, approval: original };
    }

    const originalPayload = ApprovalPayload.parse(original.payloadJson);
    const replacementPayload = ApprovalPayload.parse(input.payload);
    if (replacementPayload.type !== originalPayload.type) {
      throw new Error(
        `Approval revision cannot change type from ${originalPayload.type} to ${replacementPayload.type}.`
      );
    }
    if (
      originalPayload.type === "NICHE_TEST" &&
      replacementPayload.type === "NICHE_TEST" &&
      (replacementPayload.nicheBriefId !== originalPayload.nicheBriefId ||
        replacementPayload.nicheRequestId !== originalPayload.nicheRequestId)
    ) {
      throw new Error("A NICHE_TEST revision must remain on the same request and brief chain.");
    }

    const { type, campaignId, stageRunId } = recordColumnsFrom(replacementPayload);

    const superseded = (await tx.approval.update({
      where: { id: original.id },
      data: { status: "superseded" }
    })) as ApprovalRecordRow;

    const created = (await tx.approval.upsert({
      where: { creationKey: `approval-revision:${original.id}` },
      create: {
        workspaceId: input.workspaceId,
        type,
        campaignId,
        stageRunId,
        payloadJson: replacementPayload as unknown as Prisma.InputJsonValue,
        payloadSha256: hashApprovalPayload(replacementPayload),
        status: "pending",
        requestedBy: input.actorId,
        expiresAt: original.expiresAt,
        creationKey: `approval-revision:${original.id}`,
        supersedesApprovalId: original.id,
        revisionReason: input.reason
      },
      update: {}
    })) as ApprovalRecordRow;

    // A NICHE_TEST revision keeps the same pending business object, but advances
    // its pointer to the immutable successor approval and replaces the not-yet-
    // approved draft document. The original Approval payload/hash never change.
    // The runtime guard keeps the repository's in-memory unit stand-in small;
    // every real Prisma client has this delegate and PostgreSQL integration
    // tests exercise the complete branch.
    if (replacementPayload.type === "NICHE_TEST" && "nicheBrief" in tx) {
      const advanced = await tx.nicheBrief.updateMany({
        where: {
          id: replacementPayload.nicheBriefId,
          workspaceId: input.workspaceId,
          approvalId: original.id,
          status: "pending_approval"
        },
        data: {
          approvalId: created.id,
          document: replacementPayload.brief as unknown as Prisma.InputJsonValue
        }
      });
      if (advanced.count !== 1) {
        throw new Error(
          `NICHE_TEST revision ${created.id} could not advance NicheBrief ${replacementPayload.nicheBriefId}.`
        );
      }
    }

    await enqueueApprovalRevisedNotification(tx, superseded, created);
    await enqueueApprovalRequestedNotification(tx, created, now);
    await options.beforeCommit?.({
      originalApprovalId: superseded.id,
      replacementApprovalId: created.id
    });

    return { outcome: "revised" as const, superseded, created };
  };

  return runSerializableGrowthTransaction(db, run, options.maxTransactionAttempts);
}
