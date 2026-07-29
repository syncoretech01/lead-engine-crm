import { PageHeader } from "@/components/page-header";
import { listCampaigns } from "@/lib/growth/repositories/campaign-repository";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

/**
 * Campaigns — the nav root (v9.1 §5.6).
 *
 * `Campaign` is the universal parent and orphan work is a bug (§26.1). CRM-1
 * ships the list; the per-campaign stage timeline that the admin dashboard is
 * built from arrives with CRM-8, on the `CampaignStageRun` rows this phase
 * created.
 */
export default async function CampaignsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { workspaceId } = await getWorkspaceSessionContext("manage_outreach");
  const { cursor } = await searchParams;
  const page = await listCampaigns({ workspaceId, cursor });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Campaigns"
        title="Campaigns"
        copy="Every campaign starts from an approved niche brief and records each stage as a durable run."
      />

      {page.rows.length === 0 ? (
        <p data-testid="campaigns-empty" className="text-sm text-[--ui-fg-muted]">
          No campaigns yet. A campaign is created when a NICHE_TEST approval carries — research
          first, then the brief, then the campaign.
        </p>
      ) : (
        <ul data-testid="campaigns-list" className="space-y-2">
          {page.rows.map((row) => (
            <li key={row.id} data-testid="campaign-row" className="rounded border p-3 text-sm">
              {row.id}
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <a
          href={`/campaigns?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="inline-block rounded border px-3 py-1 text-sm"
        >
          Next page
        </a>
      )}
    </div>
  );
}
