import { BadgeCheck, DatabaseZap, Gem, Layers3, RefreshCw, Tags } from "lucide-react";
import {
  applySegmentsAndScoresAction,
  createSegmentRuleAction,
  deleteSegmentRuleAction,
  runEnrichmentAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";

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

  return (
    <>
      <PageHeader
        kicker="Phase 3"
        title="Enrichment and scoring"
        copy="Run a local provider-style enrichment waterfall, reuse provider cache, assign deterministic segments, and calculate explainable scores with priority tiers."
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

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Company coverage</span>
            <Gem size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{averageCompanyCoverage}%</div>
          <span className="metric-note">Firmographic and web signal coverage.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Contact coverage</span>
            <BadgeCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{averageContactCoverage}%</div>
          <span className="metric-note">Persona and direct contact coverage.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Provider cache</span>
            <DatabaseZap size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(cache.length)}</div>
          <span className="metric-note">{formatNumber(cacheHits)} cache hits recorded.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Segmented records</span>
            <Tags size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(recordSegments.length)}</div>
          <span className="metric-note">{formatNumber(segmentRules.length)} active segment rules.</span>
        </article>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Create segment rule</h2>
              <p className="section-subtitle">Rules classify leads and contribute score boosts based on industry, title, tech, signals, grade, and score.</p>
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
            <div className="field">
              <label>Allowed grades</label>
              <div className="chip-row">
                {["A", "B", "C", "D"].map((grade) => (
                  <label className="pill" key={grade}>
                    <input name="grades" type="checkbox" value={grade} defaultChecked={grade !== "D"} /> {grade}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Gates</label>
              <div className="chip-row">
                <label className="pill">
                  <input name="requirePhone" type="checkbox" /> Require phone
                </label>
              </div>
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Save and score
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Segment rules</h2>
              <p className="section-subtitle">Active rules used by the deterministic segment engine.</p>
            </div>
            <Layers3 size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {segmentRules.map((rule) => (
              <div className="list-row" key={rule.id}>
                <div className="row-meta">
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
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Explainable lead scores</h2>
            <p className="section-subtitle">Latest score history with verification, enrichment, segment, fit, and compliance breakdowns.</p>
          </div>
          <StatusPill label={`${formatNumber(scores.length)} scores`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Priority</th>
                <th>Score</th>
                <th>Breakdown</th>
                <th>Reasons</th>
                <th>Calculated</th>
              </tr>
            </thead>
            <tbody>
              {latestScores(scores).map((score) => {
                const contact = state.contacts.find((item) => item.id === score.contactId);
                return (
                  <tr key={score.id}>
                    <td>
                      <div className="entity">
                        <strong>{contact?.name ?? "Unknown contact"}</strong>
                        <span>{contact?.email}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={score.priority} tone={score.priority === "P1" ? "success" : "info"} />
                    </td>
                    <td>
                      <div className="score-ring">{score.score}</div>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className="pill">V {score.breakdown.verification}</span>
                        <span className="pill">E {score.breakdown.enrichment}</span>
                        <span className="pill">S {score.breakdown.segment}</span>
                        <span className="pill">F {score.breakdown.fit}</span>
                      </div>
                    </td>
                    <td>{score.reasons.slice(0, 2).join(" | ")}</td>
                    <td>{formatDate(score.calculatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Provider cache</h2>
              <p className="section-subtitle">TTL-backed local cache entries that prevent repeated enrichment work.</p>
            </div>
            <StatusPill label={`${cache.length} entries`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {cache.slice(0, 10).map((entry) => (
              <div className="list-row" key={entry.id}>
                <div className="row-meta">
                  <strong>{entry.provider}</strong>
                  <span>{entry.hits} hits</span>
                </div>
                <p className="section-subtitle">{entry.cacheKey}</p>
                <div className="chip-row">
                  <span className="pill">confidence {entry.confidence}</span>
                  <span className="pill">expires {formatDate(entry.expiresAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Enrichment history</h2>
              <p className="section-subtitle">Provider-style results with confidence, TTL, and raw response metadata.</p>
            </div>
            <StatusPill label={`${enrichments.length} results`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {enrichments.slice(0, 10).map((result) => (
              <div className="list-row" key={result.id}>
                <div className="row-meta">
                  <strong>{result.provider}</strong>
                  <span>{result.targetType}</span>
                </div>
                <div className="chip-row">
                  <span className="pill">confidence {result.confidence}</span>
                  {Object.keys(result.fields).map((field) => (
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
    </>
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
  return scores
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

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
