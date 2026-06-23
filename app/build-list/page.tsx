import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Database,
  DollarSign,
  GitMerge,
  ListChecks,
  Play,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  Wand2,
  Workflow
} from "lucide-react";
import {
  approveBuildListEnrichmentAction,
  assignBuildListLeadsAction,
  confirmLeadListIcpAction,
  createLeadJobAction,
  detectDuplicatesAction,
  draftLeadListIcpAction,
  runVerificationAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { llmEnabled } from "@/lib/llm/openai-client";
import { partitionLeadsForAssignment } from "@/lib/phase1/lead-gate";
import { createLeadJobPreflight } from "@/lib/phase1/lead-planning";
import { sdrWorkloads } from "@/lib/phase1/sdr";
import { leadSourceOptions, recommendSourcesForIcp } from "@/lib/phase1/source-recommender";
import { pickWaterfallTemplateForProfile } from "@/lib/phase1/waterfall-recommender";
import { waterfallTemplatesForWorkspace } from "@/lib/phase1/waterfall-templates";
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
  const { state, session, workspaceId } = await getWorkspaceContext("manage_profiles");
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

  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed);
  const gradeCounts = (["A", "B", "C", "D", "S"] as const).map((grade) => ({
    grade,
    count: contacts.filter((contact) => contact.grade === grade).length
  }));
  const needsEnrichment = contacts.filter((contact) => !contact.phone || !contact.email);

  const templates = waterfallTemplatesForWorkspace(state, workspaceId);
  const enrichChoice = selectedProfile
    ? pickWaterfallTemplateForProfile({
        industries: selectedProfile.industries,
        titles: selectedProfile.titles,
        segments: selectedProfile.segmentRules,
        templates
      })
    : null;
  const enrichTemplate = enrichChoice ? templates.find((template) => template.id === enrichChoice.templateId) : undefined;
  const canEnrich = session.permissions.includes("manage_waterfalls");

  const allContacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const openDuplicates = state.dedupeMatches.filter(
    (match) => match.workspaceId === workspaceId && match.status === "Open"
  ).length;
  const gate = partitionLeadsForAssignment({ contacts: allContacts, requiredFields: selectedProfile?.requiredFields });
  const workloads = sdrWorkloads(state, workspaceId);
  const canAssign = session.permissions.includes("manage_sdr_team");

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
            <h2 className="section-title">Verify emails</h2>
            <p className="section-subtitle">
              Grade contacts (A–S) before enrichment so you only enrich and assign clean records.
            </p>
          </div>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <div className="chip-row">
          {gradeCounts.map(({ grade, count }) => (
            <span className="pill" key={grade}>
              Grade {grade}: {formatNumber(count)}
            </span>
          ))}
          <span className="pill">Total: {formatNumber(contacts.length)}</span>
        </div>
        <form action={runVerificationAction} className="form-grid">
          <div className="field integration-actions">
            <button className="button secondary" type="submit">
              <BadgeCheck size={17} aria-hidden="true" />
              Run email verification
            </button>
          </div>
        </form>
      </section>

      {enrichTemplate && enrichChoice ? (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Enrichment plan</h2>
              <p className="section-subtitle">
                Best-fit waterfall for this ICP — approve to fill missing emails and phones via the provider waterfall.
              </p>
            </div>
            <Workflow size={18} aria-hidden="true" />
          </div>
          <div className="chip-row">
            <StatusPill label={enrichTemplate.name} tone="info" />
            <span className="pill">{formatNumber(needsEnrichment.length)} need enrichment</span>
            <span className="pill">
              {enrichTemplate.maxCostPerLeadCents
                ? `Max ${formatCents(enrichTemplate.maxCostPerLeadCents * needsEnrichment.length)}`
                : "Metered per provider"}
            </span>
          </div>
          <p className="surface-note">{enrichChoice.rationale}</p>
          <div className="chip-row">
            {enrichTemplate.steps.map((step) => (
              <span className="pill" key={step.id}>
                {step.order} · {labelize(step.stage)}
                {step.providerIds.length ? ` · ${step.providerIds.join(", ")}` : ""}
              </span>
            ))}
          </div>
          {canEnrich ? (
            needsEnrichment.length > 0 ? (
              <form action={approveBuildListEnrichmentAction} className="form-grid">
                <input type="hidden" name="templateId" value={enrichTemplate.id} />
                <div className="field integration-actions">
                  <button className="button primary" type="submit">
                    <Workflow size={17} aria-hidden="true" />
                    Approve &amp; enrich ({formatNumber(needsEnrichment.length)})
                  </button>
                </div>
              </form>
            ) : (
              <p className="surface-note">No contacts are missing an email or phone — nothing to enrich.</p>
            )
          ) : (
            <p className="surface-note">Enrichment runs are limited to Admins and Managers.</p>
          )}
          <p className="surface-note">
            Enrichment uses your live providers when SYNCORE_ENABLE_LIVE_PROVIDERS is on; otherwise it runs in mock mode
            with no values written.
          </p>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Finalize &amp; assign</h2>
            <p className="section-subtitle">
              Clear duplicates, hold low-quality leads, then fairly distribute the rest to SDRs.
            </p>
          </div>
          <UserCheck size={18} aria-hidden="true" />
        </div>

        <div className="chip-row">
          <StatusPill
            label={openDuplicates ? `${formatNumber(openDuplicates)} open duplicates` : "No open duplicates"}
            tone={openDuplicates ? "warning" : "success"}
          />
          <span className="pill">{formatNumber(gate.ready.length)} ready</span>
          <span className="pill">{formatNumber(gate.held.length)} held</span>
          {gate.reasons.map((entry) => (
            <span className="pill" key={entry.reason}>
              {entry.reason}: {formatNumber(entry.count)}
            </span>
          ))}
        </div>

        <div className="item-card-actions">
          <form action={detectDuplicatesAction}>
            <button className="button secondary" type="submit">
              <GitMerge size={17} aria-hidden="true" />
              Check duplicates
            </button>
          </form>
          {openDuplicates ? (
            <Link href="/data-quality" className="button subtle">
              Resolve in Data Quality
            </Link>
          ) : null}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SDR</th>
                <th>Active</th>
                <th>P1</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {workloads.length ? (
                workloads.map((workload) => (
                  <tr key={workload.userId}>
                    <td>{workload.name}</td>
                    <td>{formatNumber(workload.active)}</td>
                    <td>{formatNumber(workload.p1)}</td>
                    <td>{formatNumber(workload.assigned)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <UserCheck size={24} aria-hidden="true" />
                      <span>No SDRs in this workspace yet.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canAssign ? (
          gate.ready.length > 0 ? (
            <form action={assignBuildListLeadsAction} className="form-grid">
              <div className="field integration-actions">
                <button className="button primary" type="submit">
                  <UserCheck size={17} aria-hidden="true" />
                  Assign {formatNumber(gate.ready.length)} ready leads to SDRs
                </button>
              </div>
            </form>
          ) : (
            <p className="surface-note">No ready leads to assign yet — verify and enrich first.</p>
          )
        ) : (
          <p className="surface-note">Lead assignment is limited to Admins and Managers.</p>
        )}
      </section>

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

function labelize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
