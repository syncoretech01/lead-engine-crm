import {
  BadgeCheck,
  DatabaseZap,
  Gem,
  Layers3,
  RefreshCw,
  ServerCog,
  Sparkles,
  Tags,
  Target,
  Users
} from "lucide-react";
import {
  applySegmentsAndScoresAction,
  createSegmentRuleAction,
  deleteSegmentRuleAction,
  runEnrichmentAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState, EnrichmentProvider } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function EnrichmentPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_enrichment");
  const companies = state.companies.filter((company) => company.workspaceId === workspaceId);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const enrichments = state.enrichmentResults.filter((result) => result.workspaceId === workspaceId);
  const cache = state.providerCache.filter((entry) => entry.workspaceId === workspaceId);
  const segmentRules = state.segmentRules.filter((rule) => rule.workspaceId === workspaceId);
  const recordSegments = state.recordSegments.filter((segment) => segment.workspaceId === workspaceId);
  const scores = state.leadScores.filter((score) => score.workspaceId === workspaceId);
  const averageCompanyCoverage = average(companies.map((company) => company.enrichmentCoverage ?? 0));
  const averageContactCoverage = average(contacts.map((contact) => contact.enrichmentCoverage ?? 0));
  const cacheHits = cache.reduce((total, entry) => total + entry.hits, 0);
  const scoreRows = latestScores(scores);
  const p1Scores = scoreRows.filter((score) => score.priority === "P1").length;
  const lowCoverageContacts = contacts.filter((contact) => (contact.enrichmentCoverage ?? 0) < 50).length;
  const providerRows = providerSummaries(enrichments, cache);

  const stats = [
    {
      label: "Company coverage",
      value: `${averageCompanyCoverage}%`,
      note: "Firmographic and web signal coverage",
      icon: Gem,
      tone: averageCompanyCoverage >= 70 ? "success" as const : "warning" as const
    },
    {
      label: "Contact coverage",
      value: `${averageContactCoverage}%`,
      note: "Persona and contact data coverage",
      icon: BadgeCheck,
      tone: averageContactCoverage >= 70 ? "success" as const : "warning" as const
    },
    {
      label: "Provider cache",
      value: formatNumber(cache.length),
      note: `${formatNumber(cacheHits)} cache hits recorded`,
      icon: DatabaseZap,
      tone: "info" as const
    },
    {
      label: "Segmented records",
      value: formatNumber(recordSegments.length),
      note: `${formatNumber(segmentRules.length)} active segment rules`,
      icon: Tags,
      tone: "success" as const
    }
  ];

  const lanes = [
    {
      label: "Company enrich",
      value: averageCompanyCoverage,
      suffix: "%",
      note: `${formatNumber(companies.length)} companies`,
      icon: ServerCog,
      tone: averageCompanyCoverage >= 70 ? "success" as const : "warning" as const
    },
    {
      label: "Contact enrich",
      value: averageContactCoverage,
      suffix: "%",
      note: `${formatNumber(lowCoverageContacts)} below 50%`,
      icon: Users,
      tone: averageContactCoverage >= 70 ? "success" as const : "warning" as const
    },
    {
      label: "P1 scores",
      value: p1Scores,
      note: "Highest priority leads",
      icon: Target,
      tone: p1Scores ? "success" as const : "warning" as const
    },
    {
      label: "Providers",
      value: providerRows.length,
      note: "Local enrichment lanes",
      icon: Sparkles,
      tone: "info" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Enrichment and scoring"
        copy="Run local enrichment, reuse cache, classify records into segments, and calculate explainable lead scores before export or SDR routing."
        actions={
          <>
            <form action={runEnrichmentAction}>
              <button className="button primary" type="submit">
                <DatabaseZap size={17} aria-hidden="true" />
                Run enrichment
              </button>
            </form>
            <form action={applySegmentsAndScoresAction}>
              <button className="button secondary" type="submit">
                <RefreshCw size={17} aria-hidden="true" />
                Re-score
              </button>
            </form>
          </>
        }
      />

      <section className="stat-grid" aria-label="Enrichment metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Enrichment workflow lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two enrichment-ops-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Scoring</div>
              <h2 className="section-title">Score focus</h2>
              <p className="section-subtitle">Latest lead scores with priority, reasons, and scoring component breakdown.</p>
            </div>
            <StatusPill label={`${formatNumber(scoreRows.length)} latest`} tone="info" />
          </div>
          <div className="panel-body signal-list">
            {scoreRows.slice(0, 8).map((score) => {
              const contact = state.contacts.find((item) => item.id === score.contactId);
              return (
                <div className="score-focus-row" key={score.id}>
                  <div className="score-focus-top">
                    <div className="entity">
                      <strong>{contact?.name ?? "Unknown contact"}</strong>
                      <span>{contact?.email}</span>
                    </div>
                    <StatusPill label={score.priority} tone={score.priority === "P1" ? "success" : "info"} />
                  </div>
                  <div className="score-meter">
                    <strong>{score.score}</strong>
                    <ProgressBar value={score.score} />
                  </div>
                  <div className="score-breakdown-grid">
                    <Breakdown label="Verify" value={score.breakdown.verification} />
                    <Breakdown label="Enrich" value={score.breakdown.enrichment} />
                    <Breakdown label="Segment" value={score.breakdown.segment} />
                    <Breakdown label="Fit" value={score.breakdown.fit} />
                  </div>
                  <p className="section-subtitle">{score.reasons.slice(0, 2).join(" | ")}</p>
                </div>
              );
            })}
            {scoreRows.length === 0 ? <p className="section-subtitle">No lead scores have been calculated yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Providers</div>
              <h2 className="section-title">Local enrichment waterfall</h2>
              <p className="section-subtitle">Provider-style lanes, cache reuse, confidence, and target coverage.</p>
            </div>
            <Layers3 size={20} aria-hidden="true" />
          </div>
          <div className="panel-body provider-waterfall-list">
            {providerRows.map((row) => (
              <div className="provider-waterfall-row" key={row.provider}>
                <div className="stage-meta">
                  <strong>{providerLabel(row.provider)}</strong>
                  <StatusPill label={`${formatNumber(row.results)} results`} tone="info" />
                </div>
                <SummaryMeter label="Average confidence" value={row.confidence} total={100} note={`${formatNumber(row.cacheHits)} cache hits`} />
                <div className="chip-row">
                  <span className="pill">{formatNumber(row.companies)} companies</span>
                  <span className="pill">{formatNumber(row.contacts)} contacts</span>
                  <span className="pill">{formatNumber(row.cacheEntries)} cache entries</span>
                </div>
              </div>
            ))}
            {providerRows.length === 0 ? <p className="section-subtitle">No enrichment provider results yet.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Segment rules</h2>
              <p className="section-subtitle">Active rules used by the deterministic segment engine.</p>
            </div>
            <StatusPill label={`${formatNumber(segmentRules.length)} rules`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {segmentRules.map((rule) => (
              <div className="stage-row" key={rule.id}>
                <div className="stage-meta">
                  <strong>{rule.name}</strong>
                  <StatusPill label={rule.outputSegment} tone="info" />
                </div>
                <p className="section-subtitle">{rule.description}</p>
                <div className="chip-row">
                  <span className="pill">+{rule.scoreBoost} score</span>
                  <span className="pill">score {rule.conditions.minScore}+</span>
                  <span className="pill">grades {rule.conditions.grades.join("/")}</span>
                  {rule.priorityOverride ? <span className="pill">override {rule.priorityOverride}</span> : null}
                </div>
                <form action={deleteSegmentRuleAction}>
                  <input name="id" type="hidden" value={rule.id} />
                  <button className="button danger" type="submit">
                    Delete
                  </button>
                </form>
              </div>
            ))}
            {segmentRules.length === 0 ? <p className="section-subtitle">No segment rules have been created yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Enrichment history</h2>
              <p className="section-subtitle">Recent provider-style results with confidence, TTL, and changed fields.</p>
            </div>
            <StatusPill label={`${enrichments.length} results`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {enrichments.slice(0, 8).map((result) => (
              <div className="stage-row" key={result.id}>
                <div className="stage-meta">
                  <strong>{providerLabel(result.provider)}</strong>
                  <span>{result.targetType}</span>
                </div>
                <div className="chip-row">
                  <span className="pill">confidence {result.confidence}</span>
                  {Object.keys(result.fields).slice(0, 5).map((field) => (
                    <span className="pill" key={field}>
                      {field}
                    </span>
                  ))}
                </div>
                <p className="section-subtitle">Enriched {formatDate(result.enrichedAt)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel" id="create-segment-rule">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Create segment rule</h2>
            <p className="section-subtitle">Add a deterministic rule when the current scoring model needs a new segment.</p>
          </div>
          <StatusPill label="Rule engine" tone="success" />
        </div>
        <form action={createSegmentRuleAction} className="panel-body form-grid">
          <div className="field">
            <label htmlFor="name">Rule name</label>
            <input id="name" name="name" placeholder="High-intent ecommerce founders" required />
          </div>
          <div className="field">
            <label htmlFor="outputSegment">Output segment</label>
            <input id="outputSegment" name="outputSegment" placeholder="High-intent ecommerce" required />
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" placeholder="Shopify/Klaviyo founders and growth leads" />
          </div>
          <div className="field">
            <label htmlFor="scoreBoost">Score boost</label>
            <input id="scoreBoost" name="scoreBoost" type="number" min="0" max="20" defaultValue="8" />
          </div>
          <div className="field">
            <label htmlFor="priorityOverride">Priority override</label>
            <select id="priorityOverride" name="priorityOverride">
              <option value="">No override</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="minScore">Minimum score</label>
            <input id="minScore" name="minScore" type="number" min="0" max="100" defaultValue="50" />
          </div>
          <div className="field">
            <label htmlFor="industries">Industries</label>
            <input id="industries" name="industries" placeholder="ecommerce, retail, automotive" />
          </div>
          <div className="field">
            <label htmlFor="titleKeywords">Title keywords</label>
            <input id="titleKeywords" name="titleKeywords" placeholder="owner, founder, growth" />
          </div>
          <div className="field">
            <label htmlFor="technologyKeywords">Technology keywords</label>
            <input id="technologyKeywords" name="technologyKeywords" placeholder="Shopify, Klaviyo" />
          </div>
          <div className="field">
            <label htmlFor="signalKeywords">Signal keywords</label>
            <input id="signalKeywords" name="signalKeywords" placeholder="hiring growth, phone ready" />
          </div>
          <div className="field full">
            <label>Allowed grades</label>
            <div className="chip-row">
              {["A", "B", "C", "D"].map((grade) => (
                <label className="pill" key={grade}>
                  <input name="grades" type="checkbox" value={grade} defaultChecked={grade !== "D"} /> {grade}
                </label>
              ))}
            </div>
          </div>
          <div className="field full">
            <label>Gates</label>
            <div className="chip-row">
              <label className="pill">
                <input name="requirePhone" type="checkbox" /> Require phone
              </label>
            </div>
          </div>
          <div className="field full">
            <button className="button primary" type="submit">
              Save and score
            </button>
          </div>
        </form>
      </section>
    </>
  );
}


function Breakdown({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-breakdown-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryMeter({
  label,
  value,
  total,
  note
}: {
  label: string;
  value: number;
  total: number;
  note: string;
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="summary-meter">
      <div className="row-meta">
        <strong>{label}</strong>
        <span>{formatNumber(value)}</span>
      </div>
      <ProgressBar value={percent} />
      <div className="row-meta">
        <span>{percent}%</span>
        <span>{note}</span>
      </div>
    </div>
  );
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function latestScores(scores: AppState["leadScores"]) {
  const seen = new Set<string>();
  return [...scores]
    .sort((a, b) => Date.parse(b.calculatedAt) - Date.parse(a.calculatedAt))
    .filter((score) => {
      if (seen.has(score.contactId)) {
        return false;
      }
      seen.add(score.contactId);
      return true;
    })
    .slice(0, 30);
}

function providerSummaries(enrichments: AppState["enrichmentResults"], cache: AppState["providerCache"]) {
  const providers = new Set<EnrichmentProvider>([
    ...enrichments.map((result) => result.provider),
    ...cache.map((entry) => entry.provider)
  ]);

  return Array.from(providers).map((provider) => {
    const results = enrichments.filter((result) => result.provider === provider);
    const cacheEntries = cache.filter((entry) => entry.provider === provider);
    return {
      provider,
      results: results.length,
      confidence: average(results.map((result) => result.confidence)),
      companies: results.filter((result) => result.targetType === "company").length,
      contacts: results.filter((result) => result.targetType === "contact").length,
      cacheEntries: cacheEntries.length,
      cacheHits: cacheEntries.reduce((total, entry) => total + entry.hits, 0)
    };
  });
}

function providerLabel(provider: EnrichmentProvider) {
  return provider.replace("Syncore ", "").replace(" Local", "");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
