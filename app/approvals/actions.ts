"use server";

import { revalidatePath } from "next/cache";
import { ApprovalPayload } from "@syncore/contracts";
import {
  decideApprovalWithSideEffects,
  isApprovalApplicationError
} from "@/lib/growth/approval-orchestration";
import { reviseApproval } from "@/lib/growth/repositories/approval-repository";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";

/**
 * Server actions for the Approval Inbox.
 *
 * These are the dashboard half of "one `Approval` object, two surfaces" — the
 * chat bot hits `/api/approvals/{id}/decide` and lands on the same repository
 * functions. Neither surface has a capability the other lacks, and the dashboard
 * stays authoritative when the bot is down (v9.1 §15).
 *
 * The acting human comes from the session here, not a header: on this surface
 * the CRM authenticated the person itself.
 */

export type DecideActionResult =
  | { ok: true; status: string; awaitingSecondApprover?: boolean }
  | { ok: false; error: string };

export async function decideApprovalAction(
  approvalId: string,
  decision: "approve" | "decline"
): Promise<DecideActionResult> {
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_outreach");

  let result;
  try {
    result = await decideApprovalWithSideEffects({
      workspaceId,
      approvalId,
      decision,
      actorId: session.user.id
    });
  } catch (error) {
    if (isApprovalApplicationError(error)) {
      return { ok: false, error: `${error.code}: ${error.message}` };
    }
    throw error;
  }

  switch (result.outcome) {
    case "not_found":
      return { ok: false, error: "Approval not found." };

    case "same_approver_twice":
      return {
        ok: false,
        error: "This approval needs a second, distinct approver — you have already approved it."
      };

    case "awaiting_second_approver":
      revalidatePath("/approvals");
      return { ok: true, status: result.approval.status, awaitingSecondApprover: true };

    case "already_final":
      revalidatePath("/approvals");
      return { ok: true, status: result.approval.status };

    case "decided":
      revalidatePath("/approvals");
      return { ok: true, status: result.approval.status };
  }
}

export type ReviseActionResult =
  | { ok: true; supersededByApprovalId: string; payloadSha256: string }
  | { ok: false; error: string };

/**
 * Edit = revision. The form submits a COMPLETE replacement payload, never a
 * delta — there is no patch shape anywhere in contracts, and that absence is
 * the contract.
 */
export async function reviseApprovalAction(
  approvalId: string,
  payloadJson: string
): Promise<ReviseActionResult> {
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_outreach");

  let candidate: unknown;
  try {
    candidate = JSON.parse(payloadJson);
  } catch {
    return { ok: false, error: "Payload is not valid JSON." };
  }

  // Validate before writing: an unparseable payload has no canonical form and
  // must never acquire a hash.
  const parsed = ApprovalPayload.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Payload does not match the contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`
    };
  }

  const result = await reviseApproval({
    workspaceId,
    approvalId,
    payload: candidate,
    actorId: session.user.id
  });

  if (result.outcome === "not_found") return { ok: false, error: "Approval not found." };
  if (result.outcome === "already_final") {
    return {
      ok: false,
      error: `Approval is ${result.approval.status}; only a pending approval can be revised.`
    };
  }
  if (result.outcome === "expired") {
    return { ok: false, error: "Approval is expired and cannot be revised." };
  }

  revalidatePath("/approvals");
  return {
    ok: true,
    supersededByApprovalId: result.created.id,
    payloadSha256: result.created.payloadSha256
  };
}
