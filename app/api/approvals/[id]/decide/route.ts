import { NextResponse } from "next/server";
import { ApprovalDecide } from "@syncore/contracts";
import {
  CHAT_WORKSPACE_HEADER,
  authenticateChatRequest,
  authorizeChatApprovalActor
} from "@/lib/growth/chat-auth";
import {
  decideApprovalWithSideEffects,
  isApprovalApplicationError
} from "@/lib/growth/approval-orchestration";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";

/**
 * `POST /api/approvals/{id}/decide` — v9.1 §9.4, §10.
 *
 * Carries no payload: deciding cannot change what was approved. An "edit" is not
 * a decision — it calls `/revise`.
 *
 * Idempotent by design. A replayed button tap returns the final state with 200
 * rather than an error, because v9.1 §10 says a replayed tap "shows the final
 * state" instead of deciding twice. The bot renders that; an error would make it
 * look broken to the operator.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`chat:decide:${clientIpFromHeaders(request.headers)}`, {
      limit: 120,
      windowMs: 60_000
    });
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
    }
  }

  const auth = authenticateChatRequest(request.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.workspaceId) {
    return NextResponse.json(
      { error: `Missing ${CHAT_WORKSPACE_HEADER}.` },
      { status: 400 }
    );
  }
  const authorization = await authorizeChatApprovalActor({ ...auth, workspaceId: auth.workspaceId });
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = ApprovalDecide.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ApprovalDecide payload.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // The path is the authority. A body naming a different approval is a bug or an
  // attack, and picking either one silently would decide the wrong thing.
  if (parsed.data.approvalId !== id) {
    return NextResponse.json(
      { error: "approvalId in the body does not match the path." },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await decideApprovalWithSideEffects({
      workspaceId: authorization.workspaceId,
      approvalId: id,
      decision: parsed.data.decision,
      actorId: authorization.actorId
    });
  } catch (error) {
    if (isApprovalApplicationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code, approvalId: id },
        { status: 409 }
      );
    }
    throw error;
  }

  switch (result.outcome) {
    case "not_found":
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });

    case "same_approver_twice":
      // 409, not 200: the caller asked for something that cannot happen, and
      // silently treating it as success would make the T2 rule decorative.
      return NextResponse.json(
        {
          error: "This approval needs a second, distinct approver.",
          approvalId: result.approval.id,
          status: result.approval.status,
          firstApprovedBy: result.approval.firstApprovedBy
        },
        { status: 409 }
      );

    case "awaiting_second_approver":
      return NextResponse.json(
        {
          approvalId: result.approval.id,
          status: result.approval.status,
          awaitingSecondApprover: true,
          firstApprovedBy: result.approval.firstApprovedBy
        },
        { status: 202 }
      );

    case "already_final":
    case "decided":
      return NextResponse.json(
        {
          approvalId: result.approval.id,
          status: result.approval.status,
          decidedBy: result.approval.decidedBy ?? undefined,
          decidedAt: result.approval.decidedAt?.toISOString(),
          campaignId: result.campaignId
        },
        { status: 200 }
      );
  }
}
