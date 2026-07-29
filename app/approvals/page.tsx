import { PageHeader } from "@/components/page-header";
import { ApprovalRow } from "@/app/approvals/approval-row";
import { listApprovalInbox } from "@/lib/growth/read-models/approval-inbox";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

/**
 * The Approval Inbox (v9.1 §10, §20).
 *
 * One `Approval` object, two surfaces: this and the chat bot render the same
 * rows and hit the same repository. The dashboard is authoritative when the bot
 * is down — a bot outage must never block a decision (§15).
 *
 * Server-side paginated (golden rule 11). No row cap.
 */
export default async function ApprovalsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { workspaceId } = await getWorkspaceSessionContext("manage_outreach");
  const { cursor } = await searchParams;

  const page = await listApprovalInbox({ workspaceId, status: "pending", cursor });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Campaigns"
        title="Approval Inbox"
        copy="Money, reputation and strategy decisions. Editing an approval creates a revision — it never changes what was already approved."
      />

      {page.rows.length === 0 ? (
        <p data-testid="approvals-empty" className="text-sm text-[--ui-fg-muted]">
          Nothing pending.
        </p>
      ) : (
        <div data-testid="approvals-list" className="space-y-3">
          {page.rows.map((row) => (
            <ApprovalRow
              key={row.id}
              id={row.id}
              type={row.type}
              title={row.title}
              summary={row.summary}
              estimatedCostCents={row.estimatedCostCents}
              payloadJson={row.payloadJson}
              awaitingSecondApprover={row.awaitingSecondApprover}
              firstApprovedBy={row.firstApprovedBy}
              supersedesApprovalId={row.supersedesApprovalId}
            />
          ))}
        </div>
      )}

      {page.nextCursor && (
        // A cursor link rather than a page number: the list is ordered by
        // creation and new approvals arrive at the top, so offset paging would
        // skip rows as the queue moves.
        <a
          data-testid="approvals-next-page"
          href={`/approvals?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="inline-block rounded border px-3 py-1 text-sm"
        >
          Next page
        </a>
      )}
    </div>
  );
}
