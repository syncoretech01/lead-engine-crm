import { NextResponse } from "next/server";
import { ApprovalRevise } from "@syncore/contracts";
import {
  CHAT_WORKSPACE_HEADER,
  authenticateChatRequest,
  authorizeChatApprovalActor
} from "@/lib/growth/chat-auth";
import { reviseApproval } from "@/lib/growth/repositories/approval-repository";
import { checkRateLimit, clientIpFromHeaders, rateLimitingEnabled } from "@/lib/phase1/rate-limit";

/**
 * `POST /api/approvals/{id}/revise` — v9.1 §9.4, §10.
 *
 * An edit is a REVISION, never a mutation. The original goes `superseded` and a
 * new approval is created carrying `supersedesApprovalId`, the replacement
 * payload and a fresh SHA-256.
 *
 * The body is a COMPLETE replacement payload, never a delta — contracts ships no
 * patch shape anywhere, and that absence is the contract: if a field-level edit
 * were expressible, someone would implement it, and the hash on the original
 * would quietly stop describing what was approved.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (rateLimitingEnabled()) {
    const rate = checkRateLimit(`chat:revise:${clientIpFromHeaders(request.headers)}`, {
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
    return NextResponse.json({ error: `Missing ${CHAT_WORKSPACE_HEADER}.` }, { status: 400 });
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

  const parsed = ApprovalRevise.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ApprovalRevise payload.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (parsed.data.approvalId !== id) {
    return NextResponse.json(
      { error: "approvalId in the body does not match the path." },
      { status: 400 }
    );
  }

  const result = await reviseApproval({
    workspaceId: authorization.workspaceId,
    approvalId: id,
    payload: parsed.data.payload,
    actorId: authorization.actorId,
    reason: parsed.data.reason
  });

  switch (result.outcome) {
    case "not_found":
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });

    case "already_final":
      // A decided approval cannot be revised — the decision refers to content
      // that must stay exactly as it was when someone approved it.
      return NextResponse.json(
        {
          error: `Approval is ${result.approval.status}; only a pending approval can be revised.`,
          approvalId: result.approval.id,
          status: result.approval.status
        },
        { status: 409 }
      );

    case "expired":
      return NextResponse.json(
        {
          error: "Approval is expired and cannot be revised.",
          approvalId: result.approval.id,
          status: result.approval.status
        },
        { status: 409 }
      );

    case "already_revised":
    case "revised":
      return NextResponse.json(
        {
          approvalId: result.superseded.id,
          status: result.superseded.status,
          supersededByApprovalId: result.created.id,
          payloadSha256: result.created.payloadSha256
        },
        { status: result.outcome === "revised" ? 201 : 200 }
      );
  }
}
