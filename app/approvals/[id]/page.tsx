import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPayload } from "@syncore/contracts";

import { ApprovalRow } from "@/app/approvals/approval-row";
import { ApprovalPayloadDetail } from "@/components/growth/approval-payload-detail";
import { PageHeader } from "@/components/page-header";
import { getApproval } from "@/lib/growth/read-models/approval-inbox";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

export default async function ApprovalDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await getWorkspaceSessionContext("manage_outreach");
  const { id } = await params;
  const approval = await getApproval({ workspaceId, approvalId: id });

  // Deliberately use the same response for an unknown ID and a different
  // workspace. Slack deep links must not become a tenant-enumeration surface.
  if (!approval) {
    notFound();
  }

  const parsedPayload = ApprovalPayload.safeParse(approval.payloadJson);
  const isPending = approval.status === "pending";

  return (
    <div data-testid="approval-detail-page" className="space-y-5">
      <Link
        data-testid="approval-back-link"
        href="/approvals"
        className="inline-flex text-sm font-medium text-primary hover:underline"
      >
        ← Back to Approval Inbox
      </Link>

      <PageHeader kicker="Campaigns / Approvals" title={approval.title} copy={approval.summary} />

      {isPending ? (
        <ApprovalRow
          id={approval.id}
          type={approval.type}
          title={approval.title}
          summary={approval.summary}
          estimatedCostCents={approval.estimatedCostCents}
          payloadJson={approval.payloadJson}
          awaitingSecondApprover={approval.awaitingSecondApprover}
          firstApprovedBy={approval.firstApprovedBy}
          supersedesApprovalId={approval.supersedesApprovalId}
        />
      ) : (
        <section
          data-testid="approval-read-only"
          className="rounded-lg border bg-muted/20 p-4"
        >
          <p className="mb-3 text-sm font-medium">
            This approval is {approval.status} and is read-only.
          </p>
          {parsedPayload.success ? (
            <ApprovalPayloadDetail payload={parsedPayload.data} />
          ) : (
            <p data-testid="approval-unrenderable" className="text-sm">
              This payload does not match the installed @syncore/contracts version.
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg border p-4" aria-labelledby="approval-record-heading">
        <h2 id="approval-record-heading" className="text-base font-semibold">
          Approval record
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Approval ID" testId="approval-id">
            <CodeValue>{approval.id}</CodeValue>
          </Detail>
          <Detail label="Type" testId="approval-type">
            {approval.type}
          </Detail>
          <Detail label="Status" testId="approval-status">
            {approval.status}
          </Detail>
          <Detail label="Estimated cost" testId="approval-estimated-cost">
            {formatEstimatedCost(approval.estimatedCostCents)}
          </Detail>
          <Detail label="Requested by" testId="approval-requested-by">
            <CodeValue>{approval.requestedBy}</CodeValue>
          </Detail>
          <Detail label="Created at" testId="approval-created-at">
            <DateValue value={approval.createdAt} />
          </Detail>
          <Detail label="First approved by" testId="approval-first-approved-by">
            {approval.firstApprovedBy ? <CodeValue>{approval.firstApprovedBy}</CodeValue> : "Not recorded"}
          </Detail>
          <Detail label="First approved at" testId="approval-first-approved-at">
            <DateValue value={approval.firstApprovedAt} />
          </Detail>
          <Detail label="Decided by" testId="approval-decided-by">
            {approval.decidedBy ? <CodeValue>{approval.decidedBy}</CodeValue> : "Not recorded"}
          </Detail>
          <Detail label="Decided at" testId="approval-decided-at">
            <DateValue value={approval.decidedAt} />
          </Detail>
          <Detail label="Payload SHA-256" testId="approval-payload-sha256">
            <CodeValue>{approval.payloadSha256}</CodeValue>
          </Detail>
          <Detail label="Revision reason" testId="approval-revision-reason">
            {approval.revisionReason ?? "Not recorded"}
          </Detail>
          {approval.supersedesApprovalId ? (
            <Detail label="Supersedes approval" testId="approval-supersedes-link">
              <ApprovalLink id={approval.supersedesApprovalId} />
            </Detail>
          ) : null}
          {approval.supersededBy ? (
            <Detail label="Successor approval" testId="approval-successor-link">
              <ApprovalLink id={approval.supersededBy.id} />
            </Detail>
          ) : null}
          {approval.campaignId ? (
            <Detail label="Related campaign ID" testId="approval-campaign-id">
              <CodeValue>{approval.campaignId}</CodeValue>
            </Detail>
          ) : null}
          {approval.stageRunId ? (
            <Detail label="Related stage run ID" testId="approval-stage-run-id">
              <CodeValue>{approval.stageRunId}</CodeValue>
            </Detail>
          ) : null}
        </dl>
      </section>

      <details className="rounded-lg border p-4" open>
        <summary className="cursor-pointer text-base font-semibold">Complete payload details</summary>
        <pre
          data-testid="approval-complete-payload"
          className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 font-mono text-xs"
        >
          {JSON.stringify(approval.payloadJson, null, 2) ?? "null"}
        </pre>
      </details>
    </div>
  );
}

function Detail({
  label,
  testId,
  children
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{children}</dd>
    </div>
  );
}

function CodeValue({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

function DateValue({ value }: { value: Date | null }) {
  if (!value) return <>Not recorded</>;
  const iso = value.toISOString();
  return <time dateTime={iso}>{iso}</time>;
}

function ApprovalLink({ id }: { id: string }) {
  return (
    <Link className="break-all font-mono text-xs text-primary hover:underline" href={`/approvals/${id}`}>
      {id}
    </Link>
  );
}

function formatEstimatedCost(value: number | null) {
  return value === null ? "Not provided" : `$${(value / 100).toFixed(2)} (${value} cents)`;
}
