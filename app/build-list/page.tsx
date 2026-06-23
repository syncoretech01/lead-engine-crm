import Link from "next/link";
import { ArrowRight, Sparkles, Target, Wand2 } from "lucide-react";
import { confirmLeadListIcpAction, draftLeadListIcpAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { llmEnabled } from "@/lib/llm/openai-client";
import { getWorkspaceContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

export default async function BuildListPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_profiles");
  const aiOn = llmEnabled();

  const recommendations = state.aiIcpRecommendations
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const draft = recommendations.find((record) => record.status === "Generated");
  const created = recommendations.filter((record) => record.status === "Applied").slice(0, 6);

  return (
    <>
      <PageHeader
        kicker="Lead Generation"
        title="Build a Lead List"
        copy="Describe your target audience in plain language. Syncore drafts an ICP you can edit, then turns it into a reusable Search Profile."
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

            {draft.fitSignals.length ? (
              <div className="field integration-options">
                <label>Fit signals</label>
                <div className="chip-row">
                  {draft.fitSignals.map((signal) => (
                    <span className="pill" key={signal}>
                      {signal}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="field integration-actions">
              <button className="button primary" type="submit">
                <Target size={17} aria-hidden="true" />
                Create Search Profile
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {created.length ? (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Created profiles</h2>
              <p className="section-subtitle">ICPs you have turned into Search Profiles.</p>
            </div>
            <Link href="/search-profiles" className="button subtle">
              Open Search Profiles
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ICP</th>
                  <th>Industries</th>
                  <th>Titles</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {created.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <div className="entity">
                        <strong>{record.name}</strong>
                        <span>{record.geographies.join(", ")}</span>
                      </div>
                    </td>
                    <td>{record.industries.join(", ")}</td>
                    <td>{record.titles.join(", ")}</td>
                    <td>{record.confidence}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
