import { PageHeader } from "@/components/page-header";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

/**
 * The Lead Hub launch tile (v9.1 §5.6, roadmap §1).
 *
 * A placeholder on purpose. The Hub is a separate application and the boundary
 * between it and this repo is the whole point: the Hub owns lead DATA — ingest,
 * normalize, dedupe and ALL verification — and this repo owns campaign
 * EXECUTION, from "a golden contact becomes a campaign member" onward.
 *
 * Nothing here should grow into a lead-data screen. If you find yourself adding
 * one, it belongs in the Hub (anti-scope, CLAUDE.md).
 */
export default async function LeadHubPage() {
  await getWorkspaceSessionContext("manage_outreach");
  const hubUrl = process.env.SYNCORE_HUB_URL ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Campaigns"
        title="Lead Hub"
        copy="The lead-data system of record. Separate application, separate database."
      />

      <div className="rounded-lg border p-4 text-sm">
        <p>
          The Hub owns lead data: raw vault, normalization, dedupe, and all verification (free
          plus MillionVerifier). This CRM consumes clean golden records and adds campaign context
          on top.
        </p>
        <p className="mt-2 text-[--ui-fg-muted]">
          Golden-record sync arrives in CRM-3. Until then, imports run in the Hub directly.
        </p>

        {hubUrl ? (
          <a
            data-testid="lead-hub-link"
            href={hubUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded border px-3 py-1"
          >
            Open the Lead Hub
          </a>
        ) : (
          <p data-testid="lead-hub-unconfigured" className="mt-3 text-[--ui-fg-muted]">
            Set <code>SYNCORE_HUB_URL</code> to enable the launch link.
          </p>
        )}
      </div>
    </div>
  );
}
