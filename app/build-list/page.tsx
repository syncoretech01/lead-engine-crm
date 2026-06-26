import Link from "next/link";
import { BadgeCheck, Database, GitMerge, Play, ShieldCheck, Sparkles, Target, UserCheck, Wand2, Workflow } from "lucide-react";
import {
  approveBuildListEnrichmentAction,
  assignLeadsNowAction,
  confirmLeadListIcpAction,
  detectDuplicatesAction,
  draftLeadListIcpAction,
  runVerificationAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { llmEnabled } from "@/lib/llm/openai-client";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { partitionLeadsForAssignment } from "@/lib/phase1/lead-gate";
import { sdrWorkloads } from "@/lib/phase1/sdr";
import { leadSourceOptions, recommendSourcesForIcp } from "@/lib/phase1/source-recommender";
import { pickWaterfallTemplateForProfile } from "@/lib/phase1/waterfall-recommender";
import { waterfallTemplatesForWorkspace } from "@/lib/phase1/waterfall-templates";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { BuildProgressRail, type RailStage } from "@/app/build-list/build-progress-rail";
import { RunConfigurator, type ConfiguratorProfile } from "@/app/build-list/run-configurator";
import { Toaster, ToastButton } from "@/app/build-list/toaster";

export const dynamic = "force-dynamic";

type StageStatus = "done" | "active" | "upcoming";

export default async function BuildListPage() {
  let { session, workspaceId } = await getWorkspaceSessionContext("manage_profiles");
  let state = await readFastLeadDashboardState(session, workspaceId);
  if (!state) {
    const context = await getWorkspaceContext("manage_profiles");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
  }
  const aiOn = llmEnabled();

  const draft = state.aiIcpRecommendations
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .find((record) => record.status === "Generated");

  const profiles = state.searchProfiles
    .filter((profile) => profile.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const selectedProfile = profiles[0];

  const configuratorProfiles: ConfiguratorProfile[] = profiles.map((profile) => {
    const recommendation = recommendSourcesForIcp({
      industries: profile.industries,
      titles: profile.titles,
      segments: profile.segmentRules
    });
    return {
      id: profile.id,
      name: profile.name,
      estimatedVolume: profile.estimatedVolume,
      recommendedSources: recommendation.sources,
      rationale: recommendation.rationale
    };
  });

  const jobs = state.leadJobs
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);

  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed);
  const gradeOrder = ["S", "A", "B", "C", "D"] as const;
  const gradeCounts = gradeOrder.map((grade) => ({
    grade,
    count: contacts.filter((contact) => contact.grade === grade).length
  }));
  const gradedTotal = gradeCounts.reduce((total, entry) => total + entry.count, 0);
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

  const hasDraft = Boolean(draft);
  const hasProfile = profiles.length > 0;
  const hasJobs = jobs.length > 0;
  const hasContacts = contacts.length > 0;
  const hasAssignments = state.sdrAssignments.some((assignment) => assignment.workspaceId === workspaceId);

  const stageStatus: Record<string, StageStatus> = {
    describe: hasProfile || hasDraft ? "done" : "active",
    review: hasProfile ? "done" : hasDraft ? "active" : "upcoming",
    configure: hasJobs ? "done" : hasProfile ? "active" : "upcoming",
    verify: hasAssignments ? "done" : hasContacts ? "active" : "upcoming",
    assign: hasAssignments ? "done" : gate.ready.length > 0 ? "active" : "upcoming"
  };
  const stageMeta: Record<string, string> = {
    describe: hasProfile || hasDraft ? "Drafted from your prompt" : "Start here",
    review: hasProfile ? "Profile created" : draft ? `${draft.confidence}% confidence` : "Waiting on a draft",
    configure: hasJobs
      ? `${jobs.length} run${jobs.length === 1 ? "" : "s"} queued`
      : hasProfile
        ? "Pick sources + budget"
        : "Create a profile first",
    verify: hasContacts ? `${formatNumber(needsEnrichment.length)} need enrichment` : "No contacts yet",
    assign: hasAssignments
      ? "Leads assigned"
      : gate.ready.length > 0
        ? `${formatNumber(gate.ready.length)} ready`
        : "Nothing ready yet"
  };
  const stageDefs = [
    { id: "describe", n: 1, label: "Describe target" },
    { id: "review", n: 2, label: "Review ICP" },
    { id: "configure", n: 3, label: "Configure & cost" },
    { id: "verify", n: 4, label: "Verify & enrich" },
    { id: "assign", n: 5, label: "Finalize & assign" }
  ];
  const stages: RailStage[] = stageDefs.map((def) => ({ ...def, status: stageStatus[def.id], meta: stageMeta[def.id] }));
  const doneCount = stages.filter((stage) => stage.status === "done").length;
  const anyActive = stages.some((stage) => stage.status === "active");
  const progressPct = ((doneCount + (anyActive ? 0.5 : 0)) / stages.length) * 100;
  const stepLabel = `Step ${Math.min(doneCount + (anyActive ? 1 : 0), stages.length)} of ${stages.length}`;
  const currentStage = stages.find((stage) => stage.status !== "done");

  return (
    <>
      <Toaster />
      <PageHeader
        kicker="Lead Generation"
        title="Build a Lead List"
        copy="Describe your target, draft an ICP, cost the run, then verify, enrich, and assign — every step confirmed before anything is spent."
      />

      <section className="build-next" aria-label="Next best action">
        {currentStage ? (
          <>
            <strong>Next:</strong>
            <span>{nextActionText(currentStage.id)}</span>
            <a className="button secondary" href={`#stage-${currentStage.id}`}>
              Go to step
            </a>
          </>
        ) : (
          <>
            <strong>All set —</strong>
            <span>every step is complete for this list.</span>
          </>
        )}
      </section>

      <div className="build-layout">
        <BuildProgressRail stages={stages} stepLabel={stepLabel} progressPct={progressPct} />

        <div className="build-main">
          {/* Stage 1 — Describe */}
          <section className="panel build-stage" id="stage-describe" data-stage="describe">
            <div className="build-stage-head">
              <StageBadge status={stageStatus.describe} n={1} />
              <div className="panel-title-wrap">
                <h2 className="section-title">Describe your target</h2>
                <p className="section-subtitle">
                  Who do you want to reach? Include industry, role, geography, and any must-have signals.
                </p>
              </div>
              <StatusPill {...stagePill(stageStatus.describe)} />
            </div>
            <div className="chip-row" aria-label="AI drafting status">
              <StatusPill label={aiOn ? "AI drafting: GPT" : "AI drafting: keyword fallback"} tone={aiOn ? "success" : "info"} />
              <span className="surface-note">
                {aiOn
                  ? "Your description is sent to OpenAI to draft the ICP. Nothing is created or charged until you confirm."
                  : "Drafts use a local keyword parser. Set SYNCORE_ENABLE_LLM=true + OPENAI_API_KEY to draft with GPT."}
              </span>
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
                <ToastButton toast="Drafting your ICP…">
                  <Sparkles size={17} aria-hidden="true" />
                  Draft ICP
                </ToastButton>
              </div>
            </form>
          </section>

          {/* Stage 2 — Review ICP */}
          <section className="panel build-stage" id="stage-review" data-stage="review">
            <div className="build-stage-head">
              <StageBadge status={stageStatus.review} n={2} />
              <div className="panel-title-wrap">
                <h2 className="section-title">Review the drafted ICP</h2>
                <p className="section-subtitle">Edit anything below, then create the Search Profile. Lists are comma-separated.</p>
              </div>
              {draft ? <StatusPill label={`Confidence ${draft.confidence}%`} tone="info" /> : <StatusPill {...stagePill(stageStatus.review)} />}
            </div>
            {draft ? (
              <>
                {draft.prompt ? <p className="surface-note">From: &ldquo;{draft.prompt}&rdquo;</p> : null}
                <form action={confirmLeadListIcpAction} className="form-grid">
                  <input type="hidden" name="recommendationId" value={draft.id} />
                  <div className="field">
                    <label htmlFor="name">ICP name</label>
                    <input id="name" name="name" defaultValue={draft.name} />
                  </div>
                  <div className="field">
                    <label htmlFor="industries">Industries</label>
                    <input id="industries" name="industries" defaultValue={draft.industries.join(", ")} />
                  </div>
                  <div className="field">
                    <label htmlFor="titles">Titles</label>
                    <input id="titles" name="titles" defaultValue={draft.titles.join(", ")} />
                  </div>
                  <div className="field">
                    <label htmlFor="geographies">Geographies</label>
                    <input id="geographies" name="geographies" defaultValue={draft.geographies.join(", ")} />
                  </div>
                  <div className="field">
                    <label htmlFor="segments">Segments</label>
                    <input id="segments" name="segments" defaultValue={draft.segments.join(", ")} />
                  </div>
                  <div className="field integration-actions">
                    <ToastButton toast="Search profile created.">
                      <Target size={17} aria-hidden="true" />
                      Create Search Profile
                    </ToastButton>
                  </div>
                </form>
              </>
            ) : hasProfile ? (
              <p className="surface-note">
                Latest profile: <strong>{profiles[0].name}</strong>. Draft a new ICP above to revise it.
              </p>
            ) : (
              <div className="empty-state">
                <Wand2 size={24} aria-hidden="true" />
                <span>Draft an ICP above to review and edit it here.</span>
              </div>
            )}
          </section>

          {/* Stage 3 — Configure & cost */}
          <section className="panel build-stage" id="stage-configure" data-stage="configure">
            <div className="build-stage-head">
              <StageBadge status={stageStatus.configure} n={3} />
              <div className="panel-title-wrap">
                <h2 className="section-title">Configure &amp; cost the run</h2>
                <p className="section-subtitle">Pick the profile and sources, set a budget, and preview the exact cost before you queue.</p>
              </div>
              <StatusPill {...stagePill(stageStatus.configure)} />
            </div>
            {configuratorProfiles.length ? (
              <RunConfigurator
                profiles={configuratorProfiles}
                sourceOptions={leadSourceOptions}
                initialProfileId={configuratorProfiles[0].id}
              />
            ) : (
              <div className="empty-state">
                <Target size={24} aria-hidden="true" />
                <span>Create a Search Profile first to configure and cost a run.</span>
              </div>
            )}
          </section>

          {/* Stage 4 — Verify & enrich */}
          <section className="panel build-stage" id="stage-verify" data-stage="verify">
            <div className="build-stage-head">
              <StageBadge status={stageStatus.verify} n={4} />
              <div className="panel-title-wrap">
                <h2 className="section-title">Verify &amp; enrich</h2>
                <p className="section-subtitle">Grade contacts before enrichment, then fill missing emails and phones via the provider waterfall.</p>
              </div>
              <StatusPill {...stagePill(stageStatus.verify)} />
            </div>

            {hasContacts ? (
              <>
                <div className="grade-bar" aria-label="Email grade distribution">
                  {gradeCounts.map((entry) => (
                    <span
                      key={entry.grade}
                      className={`grade-seg gcol-${entry.grade.toLowerCase()}`}
                      style={{ width: gradedTotal ? `${(entry.count / gradedTotal) * 100}%` : "0%" }}
                    />
                  ))}
                </div>
                <div className="grade-legend">
                  {gradeCounts.map((entry) => (
                    <span className="grade-legend-item" key={entry.grade}>
                      <span className={`grade-legend-dot gcol-${entry.grade.toLowerCase()}`} />
                      <strong>Grade {entry.grade}</strong> {formatNumber(entry.count)}
                    </span>
                  ))}
                </div>
                <div className="item-card-actions">
                  <form action={runVerificationAction}>
                    <ToastButton className="button secondary" toast="Email verification queued.">
                      <BadgeCheck size={16} aria-hidden="true" />
                      Run email verification
                    </ToastButton>
                  </form>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <ShieldCheck size={24} aria-hidden="true" />
                <span>No contacts yet — queue a run, then verify grades here.</span>
              </div>
            )}

            {enrichTemplate && enrichChoice ? (
              <>
                <div className="build-divider" />
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
                        <ToastButton toast="Enrichment waterfall approved.">
                          <Workflow size={17} aria-hidden="true" />
                          Approve &amp; enrich ({formatNumber(needsEnrichment.length)})
                        </ToastButton>
                      </div>
                    </form>
                  ) : (
                    <p className="surface-note">No contacts are missing an email or phone — nothing to enrich.</p>
                  )
                ) : (
                  <p className="surface-note">Enrichment runs are limited to Admins and Managers.</p>
                )}
                <p className="surface-note">
                  Enrichment uses your live providers when SYNCORE_ENABLE_LIVE_PROVIDERS is on; otherwise it runs in mock mode with no values written.
                </p>
              </>
            ) : null}
          </section>

          {/* Stage 5 — Finalize & assign */}
          <section className="panel build-stage" id="stage-assign" data-stage="assign">
            <div className="build-stage-head">
              <StageBadge status={stageStatus.assign} n={5} />
              <div className="panel-title-wrap">
                <h2 className="section-title">Finalize &amp; assign</h2>
                <p className="section-subtitle">Clear duplicates, hold low-quality leads, then fairly distribute the rest to SDRs.</p>
              </div>
              <StatusPill {...stagePill(stageStatus.assign)} />
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
                <ToastButton className="button secondary" toast="Duplicate scan started.">
                  <GitMerge size={16} aria-hidden="true" />
                  Check duplicates
                </ToastButton>
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
                <form action={assignLeadsNowAction} className="form-grid">
                  <div className="field integration-actions">
                    <ToastButton toast="Assigning ready leads to SDRs…">
                      <UserCheck size={17} aria-hidden="true" />
                      Assign now (current score): {formatNumber(gate.ready.length)} ready leads
                    </ToastButton>
                  </div>
                </form>
              ) : (
                <p className="surface-note">No ready leads to assign yet — verify and enrich first.</p>
              )
            ) : (
              <p className="surface-note">Lead assignment is limited to Admins and Managers.</p>
            )}
          </section>

          {/* Recent runs */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Recent runs</h2>
                <p className="section-subtitle">
                  Queued runs wait for source data — extraction runs via the provider worker or a CSV import in Data Staging.
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
        </div>
      </div>
    </>
  );
}

function StageBadge({ status, n }: { status: StageStatus; n: number }) {
  return (
    <span className={`build-badge${status === "done" ? " done" : status === "active" ? " active" : ""}`}>
      {status === "done" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

function stagePill(status: StageStatus): { label: string; tone: "success" | "info" | "default" } {
  if (status === "done") return { label: "Done", tone: "success" };
  if (status === "active") return { label: "In progress", tone: "info" };
  return { label: "Upcoming", tone: "default" };
}

function nextActionText(stageId: string): string {
  switch (stageId) {
    case "describe":
      return "Describe your target audience to draft an ICP.";
    case "review":
      return "Review and confirm the drafted ICP.";
    case "configure":
      return "Configure sources + budget and queue the run.";
    case "verify":
      return "Verify emails, then enrich missing fields.";
    case "assign":
      return "Assign the ready leads to your SDRs.";
    default:
      return "Continue building your list.";
  }
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
