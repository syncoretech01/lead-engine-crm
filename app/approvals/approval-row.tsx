"use client";

import { useState, useTransition } from "react";
import { ApprovalPayload } from "@syncore/contracts";
import { ApprovalPayloadDetail } from "@/components/growth/approval-payload-detail";
import { decideApprovalAction, reviseApprovalAction } from "@/app/approvals/actions";

/**
 * One inbox row: Approve / Decline / Edit.
 *
 * 🔴 Edit routes through `revise`, never a mutated decide. The original is
 * superseded and a new approval is created with a fresh SHA-256 — v9.1 §10
 * forbids in-place editing outright, because the stored hash would otherwise
 * stop describing what was approved.
 */

export type ApprovalRowProps = {
  id: string;
  type: string;
  title: string;
  summary: string;
  estimatedCostCents: number | null;
  payloadJson: unknown;
  awaitingSecondApprover: boolean;
  firstApprovedBy: string | null;
  supersedesApprovalId: string | null;
};

export function ApprovalRow(props: ApprovalRowProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(props.payloadJson, null, 2));

  const parsed = ApprovalPayload.safeParse(props.payloadJson);

  const decide = (decision: "approve" | "decline") =>
    startTransition(async () => {
      const result = await decideApprovalAction(props.id, decision);
      setMessage(
        result.ok
          ? result.awaitingSecondApprover
            ? "Recorded. This approval needs a second, distinct approver."
            : `Approval ${result.status}.`
          : result.error
      );
    });

  const revise = () =>
    startTransition(async () => {
      const result = await reviseApprovalAction(props.id, draft);
      if (result.ok) {
        setEditing(false);
        setMessage(`Revised. Superseded by ${result.supersededByApprovalId}.`);
      } else {
        setMessage(result.error);
      }
    });

  return (
    <article
      data-testid="approval-row"
      data-approval-id={props.id}
      data-approval-type={props.type}
      className="rounded-lg border p-4"
    >
      <header className="mb-2">
        <h3 data-testid="approval-title" className="font-semibold">
          {props.title}
        </h3>
        <p className="text-sm text-[--ui-fg-muted]">{props.summary}</p>
        {props.estimatedCostCents !== null && (
          <p data-testid="approval-cost" className="mt-1 text-sm">
            Estimated cost: ${(props.estimatedCostCents / 100).toFixed(2)}
          </p>
        )}
        {props.supersedesApprovalId && (
          <p data-testid="approval-supersedes" className="mt-1 text-xs text-[--ui-fg-muted]">
            Revision of {props.supersedesApprovalId}
          </p>
        )}
        {props.awaitingSecondApprover && (
          // Shown so nobody presses a button that will silently not decide.
          <p data-testid="approval-awaiting-second" className="mt-1 text-xs font-medium">
            {props.firstApprovedBy
              ? `1 of 2 approvals — approved by ${props.firstApprovedBy}`
              : "Requires two approvers"}
          </p>
        )}
      </header>

      {parsed.success ? (
        <ApprovalPayloadDetail payload={parsed.data} />
      ) : (
        <p data-testid="approval-unrenderable" className="text-sm">
          This payload does not match the installed @syncore/contracts version.
        </p>
      )}

      {editing ? (
        <div className="mt-3">
          <label className="block text-sm font-medium" htmlFor={`payload-${props.id}`}>
            Replacement payload (complete, not a delta)
          </label>
          <textarea
            id={`payload-${props.id}`}
            data-testid="approval-edit-payload"
            className="mt-1 w-full rounded border p-2 font-mono text-xs"
            rows={12}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="approval-revise-submit"
              disabled={pending}
              onClick={revise}
              className="rounded border px-3 py-1 text-sm"
            >
              Save as revision
            </button>
            <button
              type="button"
              data-testid="approval-revise-cancel"
              onClick={() => setEditing(false)}
              className="rounded border px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-testid="approval-approve"
            disabled={pending}
            onClick={() => decide("approve")}
            className="rounded border px-3 py-1 text-sm font-medium"
          >
            Approve
          </button>
          <button
            type="button"
            data-testid="approval-decline"
            disabled={pending}
            onClick={() => decide("decline")}
            className="rounded border px-3 py-1 text-sm"
          >
            Decline
          </button>
          <button
            type="button"
            data-testid="approval-edit"
            disabled={pending}
            onClick={() => setEditing(true)}
            className="rounded border px-3 py-1 text-sm"
          >
            Edit
          </button>
        </div>
      )}

      {message && (
        <p data-testid="approval-message" role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </article>
  );
}
