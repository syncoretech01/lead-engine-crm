import type { Prisma } from "@prisma/client";
import { type ResearchFailureCode } from "@syncore/contracts";
import {
  type GrowthPrismaClient,
  growthPrisma,
  inGrowthTransaction
} from "@/lib/growth/repositories/client";

/**
 * `ResearchRun` — the durable queue the Console Agent polls (v9.1 §9.1).
 *
 * The local Console is a Windows box that may be off, so the CRM never calls it.
 * It enqueues, the Agent claims, and "offline" is a state rather than a crash
 * (v9.1 §19). Everything here is written so a run that is never claimed simply
 * stays `queued` and the bot can say so honestly.
 */

/** Enqueue a run and move its request to `researching`, atomically. */
export async function enqueueResearchRun(
  input: { workspaceId: string; nicheRequestId: string; campaignDraftId?: string },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());

  return inGrowthTransaction(db, async (tx) => {
    const request = await tx.nicheRequest.findFirst({
      where: { id: input.nicheRequestId, workspaceId: input.workspaceId },
      select: { id: true, status: true }
    });
    if (!request) throw new Error(`NicheRequest ${input.nicheRequestId} not found in workspace`);

    // v9.1 §7: research follows confirmation. Enqueuing from `draft` would mean
    // researching something the operator has not agreed to yet.
    if (request.status !== "confirmed") {
      throw new Error(
        `NicheRequest ${request.id} is ${request.status}; only a confirmed request may be researched.`
      );
    }

    const run = await tx.researchRun.create({
      data: {
        workspaceId: input.workspaceId,
        nicheRequestId: input.nicheRequestId,
        campaignDraftId: input.campaignDraftId ?? null,
        status: "queued"
      }
    });

    await tx.nicheRequest.update({
      where: { id: request.id },
      data: { status: "researching", researchRunId: run.id }
    });

    return run;
  });
}

/**
 * The Agent's claim (contracts `ResearchRunClaim`, INFERRED RC2).
 *
 * `updateMany` with the status in the WHERE is the claim: two agents racing
 * produce one winner and one empty result, with no row lock held across the
 * network. Whoever matched zero rows simply polls again.
 */
export async function claimNextResearchRun(
  input: { consoleAgentId: string },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());

  return inGrowthTransaction(db, async (tx) => {
    const next = await tx.researchRun.findFirst({
      where: { status: "queued" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true }
    });
    if (!next) return null;

    const claimed = await tx.researchRun.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", consoleAgentId: input.consoleAgentId, startedAt: new Date() }
    });
    if (claimed.count !== 1) return null; // lost the race; the caller polls again

    return tx.researchRun.findUnique({ where: { id: next.id } });
  });
}

export async function recordResearchRunProgress(
  input: { workspaceId: string; researchRunId: string; progress: number },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const updated = await db.researchRun.updateMany({
    where: { id: input.researchRunId, workspaceId: input.workspaceId, status: "running" },
    data: { progress: Math.min(Math.max(input.progress, 0), 1) }
  });
  return updated.count === 1;
}

/**
 * Mark a run completed. This is the ONLY door a `NicheBrief` can come through
 * (v9.1 §7) — `niche-brief-repository` refuses to create one until a run reads
 * `completed`, and this is what sets that.
 */
export async function completeResearchRun(
  input: {
    workspaceId: string;
    researchRunId: string;
    reportAssetRef?: unknown;
    warnings: string[];
  },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const updated = await db.researchRun.updateMany({
    where: { id: input.researchRunId, workspaceId: input.workspaceId, status: "running" },
    data: {
      status: "completed",
      progress: 1,
      completedAt: new Date(),
      reportAssetRef: (input.reportAssetRef ?? null) as Prisma.InputJsonValue,
      // Required even when empty: an empty array is the Console saying it had
      // nothing to flag, as distinct from not having looked (contracts §9.2).
      warnings: input.warnings as unknown as Prisma.InputJsonValue
    }
  });
  return updated.count === 1;
}

/** Retryable-vs-terminal is read from `failureCode` (v9.1 §19). */
export async function failResearchRun(
  input: {
    workspaceId: string;
    researchRunId: string;
    failureCode: ResearchFailureCode;
    retryable: boolean;
  },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());

  return inGrowthTransaction(db, async (tx) => {
    const run = await tx.researchRun.findFirst({
      where: { id: input.researchRunId, workspaceId: input.workspaceId },
      select: { id: true, retryCount: true, status: true }
    });
    if (!run || run.status !== "running") return false;

    await tx.researchRun.update({
      where: { id: run.id },
      data: {
        // A retryable failure returns to the queue rather than ending the run —
        // that is what makes "the Console was offline" recoverable without an
        // operator noticing (v9.1 §9.1).
        status: input.retryable ? "queued" : "failed",
        failureCode: input.failureCode,
        retryCount: run.retryCount + 1,
        completedAt: input.retryable ? null : new Date()
      }
    });
    return true;
  });
}

/** Powers the bot's honest "Console is offline" message (v9.1 §9.1). */
export async function findLatestAgentHeartbeat(
  client?: GrowthPrismaClient
): Promise<Date | null> {
  const db = client ?? (await growthPrisma());
  const latest = await db.researchRun.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true }
  });
  return latest?.startedAt ?? null;
}
