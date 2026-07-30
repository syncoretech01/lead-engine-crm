import { createHash } from "node:crypto";
import { ApprovalPayload } from "@syncore/contracts";
import { enqueueNotifyOnce } from "@/lib/growth/notify-outbox";
import type { GrowthPrismaClient } from "@/lib/growth/repositories/client";

export type ApprovalNotificationRecord = {
  id: string;
  workspaceId: string;
  type: string;
  payloadJson: unknown;
  payloadSha256: string;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  firstApprovedBy: string | null;
  supersedesApprovalId: string | null;
  revisionReason: string | null;
  createdAt: Date;
};

/** Stable for the lifetime of the immutable Approval business event. */
export function approvalNotificationEventId(kind: string, approvalId: string): string {
  const digest = createHash("sha256").update(`${kind}:${approvalId}`, "utf8").digest("hex");
  return `evt_${digest}`;
}

async function approvalDisplayPayload(
  tx: GrowthPrismaClient,
  approval: ApprovalNotificationRecord
) {
  const payload = ApprovalPayload.parse(approval.payloadJson);
  const workspace = await tx.workspace.findUnique({
    where: { id: approval.workspaceId },
    select: { approvalThresholdT2Cents: true }
  });
  const threshold = workspace?.approvalThresholdT2Cents ?? null;
  const estimatedCostCents = payload.estimatedCostCents ?? 0;
  const requiredApproverCount = threshold !== null && estimatedCostCents >= threshold ? 2 : 1;

  return {
    approvalType: approval.type,
    status: approval.status,
    requiredApproverCount,
    expiresAt: approval.expiresAt?.toISOString() ?? null,
    requestedBy: approval.requestedBy,
    payloadSha256: approval.payloadSha256,
    // Contracts v0.2.1 routes notify envelopes by workspace. It has no typed
    // user/channel recipient field, so individual recipient selection remains a
    // Growth Bot responsibility within this authoritative workspace.
    recipientRouting: { workspaceId: approval.workspaceId },
    display: {
      title: payload.title,
      summary: payload.summary,
      estimatedCostCents: payload.estimatedCostCents ?? null,
      approvalPayload: payload
    }
  };
}

/** Enqueue the one actionable notification for a newly-created approval. */
export async function enqueueApprovalRequestedNotification(
  tx: GrowthPrismaClient,
  approval: ApprovalNotificationRecord,
  now = new Date()
) {
  if (approval.status !== "pending") return null;
  if (approval.expiresAt !== null && approval.expiresAt <= now) return null;

  return enqueueNotifyOnce(
    {
      kind: "APPROVAL_REQUESTED",
      workspaceId: approval.workspaceId,
      approvalId: approval.id,
      eventId: approvalNotificationEventId("approval-requested", approval.id),
      occurredAt: approval.createdAt.toISOString(),
      payload: await approvalDisplayPayload(tx, approval)
    },
    tx
  );
}

/** Notify that the immutable original was replaced by a new approval. */
export async function enqueueApprovalRevisedNotification(
  tx: GrowthPrismaClient,
  original: ApprovalNotificationRecord,
  replacement: ApprovalNotificationRecord
) {
  return enqueueNotifyOnce(
    {
      kind: "APPROVAL_REVISED",
      workspaceId: original.workspaceId,
      approvalId: original.id,
      eventId: approvalNotificationEventId("approval-revised", original.id),
      occurredAt: replacement.createdAt.toISOString(),
      payload: {
        approvalType: original.type,
        status: original.status,
        supersededApprovalId: original.id,
        supersededByApprovalId: replacement.id,
        requestedBy: replacement.requestedBy,
        revisionReason: replacement.revisionReason,
        payloadSha256: replacement.payloadSha256
      }
    },
    tx
  );
}

export async function enqueueAwaitingSecondApproverNotification(
  tx: GrowthPrismaClient,
  approval: ApprovalNotificationRecord,
  now: Date
) {
  return enqueueNotifyOnce(
    {
      kind: "APPROVAL_REQUESTED",
      workspaceId: approval.workspaceId,
      approvalId: approval.id,
      eventId: approvalNotificationEventId("approval-awaiting-second", approval.id),
      occurredAt: now.toISOString(),
      payload: {
        ...(await approvalDisplayPayload(tx, approval)),
        awaitingSecondApprover: true,
        firstApprovedBy: approval.firstApprovedBy
      }
    },
    tx
  );
}

export async function enqueueFinalApprovalDecisionNotification(
  tx: GrowthPrismaClient,
  approval: ApprovalNotificationRecord,
  now: Date,
  input: {
    campaignId?: string;
    nicheRequestId?: string;
    researchRunId?: string;
    nicheBriefId?: string;
  } = {}
) {
  return enqueueNotifyOnce(
    {
      kind: "APPROVAL_DECIDED",
      workspaceId: approval.workspaceId,
      approvalId: approval.id,
      campaignId: input.campaignId,
      eventId: approvalNotificationEventId("approval-decided", approval.id),
      occurredAt: (approval.decidedAt ?? now).toISOString(),
      payload: {
        approvalType: approval.type,
        status: approval.status,
        decidedBy: approval.decidedBy,
        decidedAt: approval.decidedAt?.toISOString(),
        payloadSha256: approval.payloadSha256,
        ...(input.nicheRequestId
          ? {
              nicheRequestId: input.nicheRequestId,
              researchRunId: input.researchRunId,
              nicheBriefId: input.nicheBriefId,
              campaignId: input.campaignId
            }
          : {})
      }
    },
    tx
  );
}
