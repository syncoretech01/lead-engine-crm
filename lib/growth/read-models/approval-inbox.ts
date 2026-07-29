import { ApprovalPayload, type ApprovalStatus, type ApprovalType } from "@syncore/contracts";
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
 * The Approval Inbox read model (v9.1 §10, §20).
 *
 * One `Approval` object, two surfaces — the dashboard and the chat bot render
 * from the same rows, and the dashboard stays authoritative when the bot is down
 * (v9.1 §15). This is what both read.
 *
 * Paginated server-side with `workspaceId` in every `where` (golden rules 11, and
 * the tenancy rule the integration suite asserts).
 */

export type InboxRow = {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  /** Parsed from the stored payload — the inbox headline. */
  title: string;
  summary: string;
  estimatedCostCents: number | null;
  /**
   * The stored payload, verbatim. The detail renderer parses it against the
   * contracts union, and the revise form pre-fills from it — re-serialising a
   * parsed copy would be a quiet way to change what gets re-hashed.
   */
  payloadJson: unknown;
  campaignId: string | null;
  stageRunId: string | null;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  /** Set when one of two required approvers has signed off (v9.1 §10). */
  firstApprovedBy: string | null;
  supersedesApprovalId: string | null;
  createdAt: Date;
  /** True when this approval needs a second, distinct approver to carry. */
  awaitingSecondApprover: boolean;
};

/**
 * Pull `title`/`summary`/`estimatedCostCents` out of the stored payload.
 *
 * Parsing rather than casting: a payload that no longer satisfies the contracts
 * union is a real problem — most likely a contracts bump this repo has not
 * consumed — and it should surface as a visibly broken row rather than a
 * confident-looking one rendered from a shape nobody validated.
 */
function describe(payloadJson: unknown): Pick<InboxRow, "title" | "summary" | "estimatedCostCents"> {
  const parsed = ApprovalPayload.safeParse(payloadJson);
  if (!parsed.success) {
    return {
      title: "⚠ Unrenderable approval payload",
      summary:
        "This approval's payload does not match @syncore/contracts. It was most likely written " +
        "by a different contracts version. Decide it from the surface that created it, or revise it.",
      estimatedCostCents: null
    };
  }
  return {
    title: parsed.data.title,
    summary: parsed.data.summary,
    estimatedCostCents: parsed.data.estimatedCostCents ?? null
  };
}

export type InboxQuery = {
  workspaceId: string;
  /** Defaults to the pending queue — the inbox's whole purpose. */
  status?: ApprovalStatus;
  campaignId?: string;
} & GrowthPageRequest;

export async function listApprovalInbox(
  query: InboxQuery,
  client?: GrowthPrismaClient
): Promise<GrowthPage<InboxRow>> {
  const db = client ?? (await growthPrisma());
  const pageSize = resolvePageSize(query.pageSize);

  const workspace = await db.workspace.findUnique({
    where: { id: query.workspaceId },
    select: { approvalThresholdT2Cents: true }
  });
  const t2 = workspace?.approvalThresholdT2Cents ?? null;

  const rows = await db.approval.findMany({
    where: {
      workspaceId: query.workspaceId,
      status: query.status ?? "pending",
      ...(query.campaignId ? { campaignId: query.campaignId } : {})
    },
    select: {
      id: true,
      type: true,
      status: true,
      payloadJson: true,
      campaignId: true,
      stageRunId: true,
      requestedBy: true,
      decidedBy: true,
      decidedAt: true,
      firstApprovedBy: true,
      supersedesApprovalId: true,
      createdAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...cursorArgs(query.cursor)
  });

  const mapped: InboxRow[] = rows.map((row) => {
    const described = describe(row.payloadJson);
    const needsTwo =
      t2 !== null && described.estimatedCostCents !== null && described.estimatedCostCents >= t2;
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      ...described,
      payloadJson: row.payloadJson,
      campaignId: row.campaignId,
      stageRunId: row.stageRunId,
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      firstApprovedBy: row.firstApprovedBy,
      supersedesApprovalId: row.supersedesApprovalId,
      createdAt: row.createdAt,
      // Surfaced so the UI can say "1 of 2 approvals" rather than showing a
      // button that will silently not decide anything.
      awaitingSecondApprover: needsTwo && row.status === "pending"
    };
  });

  return buildPage(mapped, pageSize);
}

/**
 * One approval with its full payload, for the detail panel and the revise form.
 *
 * Returns the payload unparsed alongside the parsed view: the revise form needs
 * the exact stored content to pre-fill, and re-serialising a parsed copy would
 * be a subtle way to change what gets re-hashed.
 */
export async function getApproval(
  input: { workspaceId: string; approvalId: string },
  client?: GrowthPrismaClient
) {
  const db = client ?? (await growthPrisma());
  const row = await db.approval.findFirst({
    where: { id: input.approvalId, workspaceId: input.workspaceId },
    select: {
      id: true,
      type: true,
      status: true,
      payloadJson: true,
      payloadSha256: true,
      campaignId: true,
      stageRunId: true,
      requestedBy: true,
      decidedBy: true,
      decidedAt: true,
      firstApprovedBy: true,
      firstApprovedAt: true,
      supersedesApprovalId: true,
      createdAt: true,
      supersededBy: { select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!row) return null;
  return { ...row, ...describe(row.payloadJson) };
}

/**
 * The revision chain, oldest first.
 *
 * Walks `supersedesApprovalId` backwards from the given approval. Bounded
 * because a cycle would otherwise hang the request — the repository cannot
 * create one, but a hand-edited row could, and a read model should not be the
 * thing that takes the site down if it does.
 */
export async function getRevisionChain(
  input: { workspaceId: string; approvalId: string },
  client?: GrowthPrismaClient
): Promise<{ id: string; status: ApprovalStatus; payloadSha256: string; createdAt: Date }[]> {
  const db = client ?? (await growthPrisma());
  const chain: { id: string; status: ApprovalStatus; payloadSha256: string; createdAt: Date }[] = [];
  const seen = new Set<string>();
  let cursor: string | null = input.approvalId;

  while (cursor && chain.length < 50) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    // Annotated explicitly: `cursor` is assigned from `row.supersedesApprovalId`,
    // so inferring `row` from the query makes the type circular (TS7022).
    const row: {
      id: string;
      status: ApprovalStatus;
      payloadSha256: string;
      createdAt: Date;
      supersedesApprovalId: string | null;
    } | null = await db.approval.findFirst({
      where: { id: cursor, workspaceId: input.workspaceId },
      select: {
        id: true,
        status: true,
        payloadSha256: true,
        createdAt: true,
        supersedesApprovalId: true
      }
    });
    if (!row) break;
    chain.unshift({
      id: row.id,
      status: row.status,
      payloadSha256: row.payloadSha256,
      createdAt: row.createdAt
    });
    cursor = row.supersedesApprovalId;
  }

  return chain;
}
