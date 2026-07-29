import type { Prisma } from "@prisma/client";
import { NicheRequestPayload, type NicheRequestSourceChannel } from "@syncore/contracts";
import {
  type GrowthPage,
  type GrowthPageRequest,
  type GrowthPrismaClient,
  buildPage,
  cursorArgs,
  growthPrisma,
  resolvePageSize
} from "@/lib/growth/repositories/client";

/**
 * `NicheRequest` — Template A, what you want (v9.1 §6, §7).
 *
 * 🔴 This is NOT a brief, and this repository cannot produce one. v9.1 §24 rates
 * "Template A stored as a brief" a High-impact risk, and §26.3 is unambiguous:
 * no `NicheBrief` and no `NICHE_TEST` approval before research completes. A
 * brief is created only by `niche-brief-repository`, only from a completed
 * `ResearchRun`.
 */

export type CreateNicheRequestInput = {
  workspaceId: string;
  createdBy: string;
  sourceChannel: NicheRequestSourceChannel;
  sourceMessageId?: string;
  voiceAssetRef?: string;
  transcript?: string;
  /** Validated against the contracts shape here; callers pass a plain object. */
  structuredPayload: unknown;
};

export async function createNicheRequest(
  input: CreateNicheRequestInput,
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  // Parse rather than trust: a voice note becomes this object via an LLM, and
  // "about a hundred bucks" must have become budgetHintCents: 10000 upstream or
  // fail here. It can never be stored as prose (contracts niche-request.ts).
  const payload = NicheRequestPayload.parse(input.structuredPayload);

  return db.nicheRequest.create({
    data: {
      workspaceId: input.workspaceId,
      createdBy: input.createdBy,
      sourceChannel: input.sourceChannel,
      sourceMessageId: input.sourceMessageId ?? null,
      voiceAssetRef: input.voiceAssetRef ?? null,
      transcript: input.transcript ?? null,
      structuredPayload: payload as unknown as Prisma.InputJsonValue,
      status: "draft"
    }
  });
}

/**
 * Operator confirms Template A (v9.1 §7). Only a draft may be confirmed —
 * confirming twice is a no-op rather than an error so a replayed chat tap is safe.
 */
export async function confirmNicheRequest(
  input: { workspaceId: string; nicheRequestId: string },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const updated = await db.nicheRequest.updateMany({
    where: { id: input.nicheRequestId, workspaceId: input.workspaceId, status: "draft" },
    data: { status: "confirmed", confirmedAt: new Date() }
  });
  return updated.count === 1;
}

/** Paginated, workspace-scoped, tight select (golden rule 11). */
export async function listNicheRequests(
  input: { workspaceId: string } & GrowthPageRequest,
  client?: GrowthPrismaClient
): Promise<GrowthPage<{ id: string }>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(input.pageSize);

  const rows = await db.nicheRequest.findMany({
    where: { workspaceId: input.workspaceId },
    select: {
      id: true,
      status: true,
      sourceChannel: true,
      researchRunId: true,
      confirmedAt: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...cursorArgs(input.cursor)
  });

  return buildPage(rows, pageSize);
}
