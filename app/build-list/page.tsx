import Link from "next/link";
import { ArrowRight, Database, DollarSign, ListChecks, Play, Sparkles, Target, Wand2 } from "lucide-react";
import { confirmLeadListIcpAction, createLeadJobAction, draftLeadListIcpAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { llmEnabled } from "@/lib/llm/openai-client";
import { createLeadJobPreflight } from "@/lib/phase1/lead-planning";
import { leadSourceOptions, recommendSourcesForIcp } from "@/lib/phase1/source-recommender";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { StatCard } from "@/components/ui-metrics";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

type BuildListSearchParams = {
  runProfileId?: string;
  sources?: string | string[];
  budget?: string;
  records?: string;
};

export default async function BuildListPage({
  searchParams
}: {
  searchParams?: Promise<BuildListSearchParams>;
}) {
  const { state, workspaceId } = await getWorkspaceContext("manage_profiles");
  const params = (await searchParams) ?? {};
  const aiOn = llmEnabled();

  const recommendations = state.aiIcpRecommendations
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const draft = recommendations.find((record) => record.status === "Generated");

  const profiles = state.searchProfiles
    .filter((profile) => profile.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const selectedProfileId = strParam(params.runProfileId) || profiles[0]?.id;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  const jobs = state.leadJobs
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);

  let run: {
    recommendation: ReturnType<typeof recommendSourcesForIcp>;
    chosenSources: string[];
    records: number;
    preflight: ReturnType<typeof createLeadJobPreflight>;
    withinBudget: boolean;
    budgetDollars: number;
  } | null = null;

  if (selectedProfile) {
    const recommendation = recommendSourcesForIcp({
      industries: selectedProfile.industries,
      titles: selectedProfile.titles,
      segments: selectedProfile.segmentRules
    });
    const sourcesParam = arrayParam(params.sources).filter((source) => leadSourceOptions.includes(source));
    const chosenSources = sourcesParam.length ? sourcesParam : recommendation.sources;
    const records = numParam(params.records) ?? selectedProfile.estimatedVolume;
    const budgetCapCents = numParam(params.budget) !== undefined ? Math.round(numParam(params.budget)! * 100) : undefined;
    const preflight = createLeadJobPreflight({
      profile: selectedProfile,
      sources: chosenSources,
      requestedRecords: records,
      budgetCapCents
    });
    run = {
      recommendation,
      chosenSources,
      records,
      preflight,
      withinBudget: preflight.budgetStatus === "Within budget",
      budgetDollars: Math.round(preflight.budgetCapCents / 100)
    };
  }

  return (
    <>
      <PageHeader
        kicker="Lead Generation"
        title="Build a Lead List"
        copy="Describe your target, draft an ICP, pick sources, see the cost, then queue the run — each step confirmed before anything is spent."
      />

      <section className="chip-row" aria-label="AI drafting status">
        <StatusPill label={aiOn ? "AI drafting: GPT" : "AI drafting: keyword fallback"} tone={aiOn ? "success" : "info"} />
        <span className="surface-note">
          {aiOn
            ? "Your description is sent to OpenAI to draft the ICP. Nothing is created or charged until you confirm."
            : "Drafts use a local keyword parser. Set SYNCORE_ENABLE_LLM=true + OPENAI_API_KEY to draft with GPT."}
        </span>
      </section>

      <section className="chip-row" aria-label="Steps">
        <span className="pill">1 · Describe</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="pill">2 · Review ICP</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="pill">3 · Create profile</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="pill">4 · Configure run</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="pill">5 · Cost &amp; queue</span>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Describe your target</h2>
            <p className="section-subtitle">
              Who do you want to reach? Include industry, role/seniority, geography, and any must-have signals.
            </p>
          </div>
          <Wand2 size={18} aria-hidden="true" />
        </div>
        <form action={draftLeadListIcpAction} className="form-grid">
          <div className="field">
            <label htmlFor="prompt">Audience description</label>
            <textarea
              id="prompt"
              name="prompt"
              rows={3}
              placeholder="e.g. Owners and general managers of independent auto repair shops in Texas that have a website, ~200 leads."
            />
          </div>
          <div className="field integration-actions">
            <button className="button primary" type="submit">
              <Sparkles size={17} aria-hidden="true" />
              Draft ICP
            </button>
          </div>
        </form>
      </section>

      {draft ? (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Review the drafted ICP</h2>
              <p className="section-subtitle">
                Edit anything below, then create the Search Profile. Lists are comma-separated.
              </p>
            </div>
            <StatusPill label={`Confidence ${draft.confidence}%`} tone="info" />
          </div>

          {draft.prompt ? <p className="surface-note">From: &ldquo;{draft.prompt}&rdquo;</p> : null}

          <form action={confirmLeadListIcpAction} className="form-grid">
            <input type="hidden" name="recommendationId" value={draft.id} />
            <div className="field">
              <label htmlFor="name">ICP name</label>
              <input id="name" name="name" defaultValue={draft.name} />
            </div>
            <div className="field">
              <label htmlFor="industries">Industries</label>
              <input id="industries" name="industries" defaultValue={draft.industries.join(", ")} placeholder="Automotive, Auto Repair" />
            </div>
            <div className="field">
              <label htmlFor="titles">Titles</label>
              <input id="titles" name="titles" defaultValue={draft.titles.join(", ")} placeholder="Owner, General Manager" />
            </div>
            <div className="field">
              <label htmlFor="geographies">Geographies</label>
              <input id="geographies" name="geographies" defaultValue={draft.geographies.join(", ")} placeholder="Texas, US" />
            </div>
            <div className="field">
              <label htmlFor="segments">Segments</label>
              <input id="segments" name="segments" defaultValue={draft.segments.join(", ")} placeholder="High-review shops" />
            </div>
            <div className="field integration-actions">
              <button className="button primary" type="submit">
                <Target size={17} aria-hidden="true" />
                Create Search Profile
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {run && selectedProfile ? (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Configure the run</h2>
              <p className="section-subtitle">Pick a profile and sources, set a budget, preview the cost, then queue.</p>
            </div>
            <ListChecks size={18} aria-hidden="true" />
          </div>

          <form method="get" className="form-grid">
            <div className="field">
              <label htmlFor="runProfileId">Search profile</label>
              <select id="runProfileId" name="runProfileId" defaultValue={selectedProfile.id}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field integration-options">
              <label>Sources</label>
              <div className="chip-row">
                {leadSourceOptions.map((source) => (
                  <label className="pill" key={source}>
                    <input type="checkbox" name="sources" value={source} defaultChecked={run!.chosenSources.includes(source)} />
                    {source}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="budget">Budget cap ($)</label>
              <input id="budget" name="budget" type="number" min="0" step="1" defaultValue={run.budgetDollars} />
            </div>
            <div className="field">
              <label htmlFor="records">Requested records</label>
              <input id="records" name="records" type="number" min="1" step="1" defaultValue={run.records} />
            </div>
            <div className="field integration-actions">
              <button className="button secondary" type="submit">
                <DollarSign size={17} aria-hidden="true" />
                Preview cost
              </button>
            </div>
          </form>

          <p className="surface-note">{run.recommendation.rationale}</p>

          <div className="stat-grid" aria-label="Cost estimate">
            <StatCard icon={Database} label="Est. records" value={formatNumber(run.preflight.estimatedRecords)} note="Across selected sources" />
            <StatCard icon={DollarSign} label="Est. cost" value={formatCents(run.preflight.estimatedCostCents)} note="Acquisition + enrichment" />
            <StatCard icon={ListChecks} label="Credits" value={formatNumber(run.preflight.estimatedCredits)} note="Estimated provider credits" />
            <StatCard
              icon={Target}
              label="Budget cap"
              value={formatCents(run.preflight.budgetCapCents)}
              note={run.preflight.budgetStatus}
              tone={run.withinBudget ? "success" : "warning"}
            />
          </div>

          <div className="chip-row">
            <StatusPill
              label={run.preflight.budgetStatus}
              tone={run.withinBudget ? "success" : "warning"}
            />
            {run.preflight.sourceEstimates.map((estimate) => (
              <span className="pill" key={estimate.source}>
                {estimate.source}: {formatNumber(estimate.estimatedRecords)} · {formatCents(estimate.estimatedCostCents)}
              </span>
            ))}
          </div>

          {run.withinBudget ? (
            <form action={createLeadJobAction} className="form-grid">
              <input type="hidden" name="searchProfileId" value={selectedProfile.id} />
              <input type="hidden" name="name" value={`${selectedProfile.name} Job`} />
              <input type="hidden" name="budgetCapDollars" value={run.budgetDollars} />
              <input type="hidden" name="requestedRecords" value={run.records} />
              <input type="hidden" name="budgetConfirmed" value="on" />
              {run.chosenSources.map((source) => (
                <input type="hidden" name="sources" value={source} key={source} />
              ))}
              <div className="field integration-actions">
                <button className="button primary" type="submit">
                  <Play size={17} aria-hidden="true" />
                  Confirm &amp; queue run ({formatCents(run.preflight.estimatedCostCents)})
                </button>
              </div>
            </form>
          ) : (
            <p className="surface-note">
              Over budget. Raise the budget cap to at least {formatCents(run.preflight.estimatedCostCents)} and preview again to queue.
            </p>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <Target size={24} aria-hidden="true" />
            <span>Create a Search Profile above to configure and cost a run.</span>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Recent runs</h2>
            <p className="section-subtitle">
              Queued runs wait for source data — extraction runs via the provider worker (with live providers on) or a CSV import in Data Staging.
            </p>
          </div>
          <Link href="/lead-jobs" className="button subtle">
            <Database size={16} aria-hidden="true" />
            Open Lead Jobs
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Est. records</th>
                <th>Est. cost</th>
                <th>Raw / normalized</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="entity">
                        <strong>{job.name}</strong>
                        <span>{job.sources.join(", ")}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={job.status} tone={statusTone(job.status)} />
                    </td>
                    <td>{formatNumber(job.estimatedRecords ?? 0)}</td>
                    <td>{formatCents(job.estimatedCostCents ?? 0)}</td>
                    <td>
                      {formatNumber(job.raw)} / {formatNumber(job.normalized)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Play size={24} aria-hidden="true" />
                      <span>No runs queued yet. Configure a run above to get started.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatCents(value: number) {
  return formatCurrency(value / 100);
}

function strParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function arrayParam(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

function numParam(value: string | string[] | undefined): number | undefined {
  const raw = strParam(value);
  if (!raw.trim()) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
