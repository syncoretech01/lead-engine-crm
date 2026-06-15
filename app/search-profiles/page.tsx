import Link from "next/link";
import { Copy, Database, Play, Plus, Search, Target, Trash2 } from "lucide-react";
import {
  createLeadJobAction,
  createSearchProfileAction,
  deleteSearchProfileAction,
  duplicateSearchProfileAction
} from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricIcons = [Target, Database, Search, Play];

export default async function SearchProfilesPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_profiles");
  const searchProfiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const activeJobs = leadJobs.filter((job) => job.status !== "Completed");
  const sourceCount = new Set(searchProfiles.flatMap((profile) => profile.sources)).size;
  const totalEstimatedVolume = searchProfiles.reduce((total, profile) => total + profile.estimatedVolume, 0);
  const recentProfiles = [...searchProfiles].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const metrics = [
    {
      label: "Saved profiles",
      value: searchProfiles.length,
      note: "Reusable ICP templates",
      tone: "info" as const
    },
    {
      label: "Estimated volume",
      value: totalEstimatedVolume,
      note: "Expected leads across profiles",
      tone: "success" as const
    },
    {
      label: "Source mix",
      value: sourceCount,
      note: "Distinct acquisition sources",
      tone: sourceCount ? "info" as const : "warning" as const
    },
    {
      label: "Active jobs",
      value: activeJobs.length,
      note: "Runs launched from profiles",
      tone: activeJobs.length ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Search profiles"
        copy="Saved ICP profiles package the target market, geography, titles, source mix, required fields, routing, and compliance note used to launch repeatable lead jobs."
        actions={
          <>
            <a href="#create-profile" className="button secondary">
              <Plus size={17} aria-hidden="true" />
              New profile
            </a>
            <Link href="/lead-jobs" className="button primary">
              <Play size={17} aria-hidden="true" />
              Lead jobs
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="Search profile metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Target;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Profile library</h2>
            <p className="section-subtitle">Run, copy, or delete saved ICPs without opening a backend configuration area.</p>
          </div>
          <StatusPill label={`${formatNumber(searchProfiles.length)} profiles`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Target</th>
                <th>Sources</th>
                <th>Required fields</th>
                <th>Volume</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {recentProfiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <div className="entity">
                      <strong>{profile.name}</strong>
                      <span>{profile.defaultRouting}</span>
                      <span>{profile.complianceNote}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{profile.targetMarket}</strong>
                      <span>{profile.geographies.join(", ")}</span>
                      <span>{profile.industries.join(", ")}</span>
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      {profile.sources.map((source) => (
                        <span className="source-chip" key={source}>
                          {source}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      {profile.requiredFields.slice(0, 4).map((field) => (
                        <span className="pill success" key={field}>
                          {field}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{formatNumber(profile.estimatedVolume)}</td>
                  <td>{formatDate(profile.updatedAt)}</td>
                  <td>
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
                    </div>
                  </td>
                </tr>
              ))}
              {recentProfiles.length === 0 ? (
                <tr>
                  <td colSpan={7}>No search profiles exist yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid three">
        {recentProfiles.slice(0, 3).map((profile) => (
          <article className="item-card compact-profile-card" key={`profile-card-${profile.id}`}>
            <div className="item-card-header">
              <div>
                <h2 className="card-title">{profile.name}</h2>
                <p className="section-subtitle">{profile.targetMarket}</p>
              </div>
              <StatusPill label={`${formatNumber(profile.estimatedVolume)} est.`} tone="info" />
            </div>
            <div className="chip-row">
              {profile.titles.slice(0, 3).map((title) => (
                <span className="pill" key={title}>
                  {title}
                </span>
              ))}
            </div>
            <p className="section-subtitle">{profile.segmentRules.join(", ")}</p>
          </article>
        ))}
      </section>

      <section className="panel" id="create-profile">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Create profile</h2>
            <p className="section-subtitle">Save a reusable ICP once the target, source mix, and required fields are clear.</p>
          </div>
          <StatusPill label="Profile setup" tone="success" />
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
    </>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
