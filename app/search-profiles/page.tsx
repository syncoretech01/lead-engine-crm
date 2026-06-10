import Link from "next/link";
import { Copy, Play, Plus, Trash2 } from "lucide-react";
import {
  createLeadJobAction,
  createSearchProfileAction,
  deleteSearchProfileAction,
  duplicateSearchProfileAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SearchProfilesPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_profiles");
  const searchProfiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);

  return (
    <>
      <PageHeader
        kicker="Saved ICP templates"
        title="Search profiles"
        copy="Reusable filters keep list-building repeatable: target market, source preferences, required fields, scoring model, routing rules, and compliance notes travel together."
        actions={
          <>
            <a href="#create-profile" className="button primary">
              <Plus size={17} aria-hidden="true" />
              Create profile
            </a>
          </>
        }
      />

      <section className="panel" id="create-profile">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Create Search Profile</h2>
            <p className="section-subtitle">Save ICP filters, source preferences, required fields, scoring, routing, and compliance notes.</p>
          </div>
          <StatusPill label="Profile CRUD" tone="success" />
        </div>
        <form action={createSearchProfileAction} className="panel-body form-grid">
          <div className="field">
            <label htmlFor="name">Profile name</label>
            <input id="name" name="name" placeholder="Texas used car dealers" required />
          </div>
          <div className="field">
            <label htmlFor="targetMarket">Target market</label>
            <input id="targetMarket" name="targetMarket" placeholder="US local SMB" required />
          </div>
          <div className="field">
            <label htmlFor="geographies">Geographies</label>
            <input id="geographies" name="geographies" placeholder="Texas, Dallas, Houston" />
          </div>
          <div className="field">
            <label htmlFor="industries">Industries</label>
            <input id="industries" name="industries" placeholder="Auto dealer, Local services" />
          </div>
          <div className="field">
            <label htmlFor="titles">Titles</label>
            <input id="titles" name="titles" placeholder="Owner, Founder, General Manager" />
          </div>
          <div className="field">
            <label htmlFor="requiredFields">Required fields</label>
            <input id="requiredFields" name="requiredFields" placeholder="Company, Email, Phone, Domain" />
          </div>
          <div className="field">
            <label htmlFor="estimatedVolume">Estimated volume</label>
            <input id="estimatedVolume" name="estimatedVolume" type="number" min="0" placeholder="500" />
          </div>
          <div className="field">
            <label htmlFor="defaultRouting">Default routing</label>
            <input id="defaultRouting" name="defaultRouting" placeholder="Round-robin: SDR pod" />
          </div>
          <div className="field">
            <label>Sources</label>
            <div className="chip-row">
              {["CSV Upload", "Apollo", "Hunter", "Google Places"].map((source) => (
                <label className="pill" key={source}>
                  <input name="sources" type="checkbox" value={source} defaultChecked={source === "CSV Upload"} /> {source}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="scoringProfile">Scoring profile</label>
            <input id="scoringProfile" name="scoringProfile" placeholder="Basic fit" />
          </div>
          <div className="field">
            <label htmlFor="segmentRules">Segment rules</label>
            <input id="segmentRules" name="segmentRules" placeholder="Owner identified, Has phone, Local business" />
          </div>
          <div className="field">
            <label htmlFor="complianceNote">Compliance note</label>
            <textarea id="complianceNote" name="complianceNote" placeholder="Source label required before export." />
          </div>
          <div className="field">
            <label aria-hidden="true">&nbsp;</label>
            <button className="button primary" type="submit">
              <Plus size={17} aria-hidden="true" />
              Save profile
            </button>
          </div>
        </form>
      </section>

      <section className="grid three">
        {searchProfiles.map((profile) => (
          <article className="item-card" key={profile.id}>
            <div className="item-card-header">
              <div>
                <h2 className="card-title">{profile.name}</h2>
                <p className="section-subtitle">{profile.targetMarket}</p>
              </div>
              <StatusPill label={`${formatNumber(profile.estimatedVolume)} est.`} tone="info" />
            </div>

            <div className="stage-list">
              <div className="list-row">
                <div className="row-meta">
                  <strong>Sources</strong>
                  <span>{profile.updatedAt}</span>
                </div>
                <div className="chip-row">
                  {profile.sources.map((source) => (
                    <span className="source-chip" key={source}>
                      {source}
                    </span>
                  ))}
                </div>
              </div>

              <div className="list-row">
                <strong>Geography</strong>
                <div className="chip-row">
                  {profile.geographies.map((geo) => (
                    <span className="pill" key={geo}>
                      {geo}
                    </span>
                  ))}
                </div>
              </div>

              <div className="list-row">
                <strong>Target titles</strong>
                <div className="chip-row">
                  {profile.titles.map((title) => (
                    <span className="pill" key={title}>
                      {title}
                    </span>
                  ))}
                </div>
              </div>

              <div className="list-row">
                <strong>Required fields</strong>
                <div className="chip-row">
                  {profile.requiredFields.map((field) => (
                    <span className="pill success" key={field}>
                      {field}
                    </span>
                  ))}
                </div>
              </div>

              <p className="section-subtitle">{profile.complianceNote}</p>
            </div>

            <div className="item-card-actions">
              <form action={createLeadJobAction}>
                <input name="searchProfileId" type="hidden" value={profile.id} />
                <input name="name" type="hidden" value={`${profile.name} - Manual run`} />
                {profile.sources.map((source) => (
                  <input key={source} name="sources" type="hidden" value={source} />
                ))}
                <button className="button primary" type="submit">
                  <Play size={16} aria-hidden="true" />
                  Run
                </button>
              </form>
              <form action={duplicateSearchProfileAction}>
                <input name="id" type="hidden" value={profile.id} />
                <button className="button secondary" type="submit">
                  <Copy size={16} aria-hidden="true" />
                  Copy
                </button>
              </form>
              <form action={deleteSearchProfileAction}>
                <input name="id" type="hidden" value={profile.id} />
                <button className="button danger" type="submit">
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
              </form>
              <Link href="/lead-jobs" className="button secondary">
                <Play size={16} aria-hidden="true" />
                Jobs
              </Link>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
