import Link from "next/link";
import {
  Copy,
  Database,
  Filter,
  Layers3,
  MapPin,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  createLeadJobAction,
  createSearchProfileAction,
  deleteSearchProfileAction,
  duplicateSearchProfileAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { sourceHealth } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { SearchProfile } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { StatCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function SearchProfilesPage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_profiles");
  const searchProfiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const activeJobs = leadJobs.filter((job) => job.status !== "Completed");
  const sourceCount = new Set(searchProfiles.flatMap((profile) => profile.sources)).size;
  const totalEstimatedVolume = searchProfiles.reduce((total, profile) => total + profile.estimatedVolume, 0);
  const recentProfiles = [...searchProfiles].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const primaryProfile = recentProfiles[0];
  const topSources = sourceUsage(searchProfiles);

  const stats = [
    {
      label: "Saved profiles",
      value: formatNumber(searchProfiles.length),
      note: "Reusable ICP templates",
      icon: Target,
      tone: "info" as const
    },
    {
      label: "Estimated volume",
      value: formatNumber(totalEstimatedVolume),
      note: "Expected leads across profiles",
      icon: Database,
      tone: "success" as const
    },
    {
      label: "Source mix",
      value: formatNumber(sourceCount),
      note: "Distinct acquisition sources",
      icon: Search,
      tone: sourceCount ? "info" as const : "warning" as const
    },
    {
      label: "Active jobs",
      value: formatNumber(activeJobs.length),
      note: "Runs launched from profiles",
      icon: Play,
      tone: activeJobs.length ? "warning" as const : "success" as const
    }
  ];

  const builderFilters = [
    {
      label: "Geography",
      value: joinList(primaryProfile?.geographies),
      icon: MapPin
    },
    {
      label: "Industries",
      value: joinList(primaryProfile?.industries),
      icon: Layers3
    },
    {
      label: "Personas",
      value: joinList(primaryProfile?.titles),
      icon: Users
    },
    {
      label: "Required fields",
      value: joinList(primaryProfile?.requiredFields),
      icon: ShieldCheck
    },
    {
      label: "Scoring",
      value: primaryProfile?.scoringProfile ?? "No scoring profile selected",
      icon: Target
    },
    {
      label: "Routing",
      value: primaryProfile?.defaultRouting ?? "No routing rule selected",
      icon: Filter
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

      <section className="stat-grid" aria-label="Search profile metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="profile-card-grid" aria-label="Saved search profiles">
        {recentProfiles.map((profile) => (
          <ProfileCard key={profile.id} profile={profile} />
        ))}
        {recentProfiles.length === 0 ? (
          <div className="empty-state">
            <Target size={24} aria-hidden="true" />
            <span>No search profiles exist yet.</span>
          </div>
        ) : null}
      </section>

      <section className="grid two profile-builder-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Builder preview</div>
              <h2 className="section-title">ICP definition</h2>
              <p className="section-subtitle">
                The newest profile becomes the working reference for the filters operators use before launching acquisition.
              </p>
            </div>
            <StatusPill label={primaryProfile ? "Profile loaded" : "Empty"} tone={primaryProfile ? "success" : "warning"} />
          </div>
          <div className="panel-body profile-meta-grid">
            {builderFilters.map((filter) => (
              <FilterTile key={filter.label} {...filter} />
            ))}
          </div>
        </div>

        <div className="profile-source-panel">
          <div className="volume-card">
            <div>
              <span>Projected available volume</span>
              <strong>{formatNumber(totalEstimatedVolume)}</strong>
            </div>
            <p>{topSources.length ? `${topSources.length} sources are represented across saved profiles.` : "Add a profile to model source coverage."}</p>
          </div>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Source mix</h2>
                <p className="section-subtitle">Profile-selected providers and current local readiness signals.</p>
              </div>
              <Database size={20} aria-hidden="true" />
            </div>
            <div className="panel-body source-option-list">
              {sourceHealth.map((source) => (
                <div className="source-option" key={source.source}>
                  <div className="source-option-header">
                    <div className="source-dot-row">
                      <span className="source-dot" style={{ background: sourceColor(source.source) }}>
                        {source.source.slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <strong>{source.source}</strong>
                      <span>{source.credits}</span>
                    </div>
                    <StatusPill label={source.status} tone={statusTone(source.status)} />
                  </div>
                  <ProgressBar value={source.trust} />
                  <div className="chip-row">
                    {source.fields.map((field) => (
                      <span className="source-chip" key={field}>
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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
                    <SourceDots sources={profile.sources} />
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
          <div className="field full">
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
          <div className="field full">
            <label htmlFor="complianceNote">Compliance note</label>
            <textarea id="complianceNote" name="complianceNote" placeholder="Source label required before export." />
          </div>
          <div className="field full">
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


function ProfileCard({ profile }: { profile: SearchProfile }) {
  return (
    <article className="profile-card card-hover">
      <div className="profile-card-top">
        <div className="profile-glyph">
          <Target size={18} aria-hidden="true" />
        </div>
        <StatusPill label={`${formatNumber(profile.estimatedVolume)} est.`} tone="info" />
      </div>
      <div className="profile-card-copy">
        <h2 className="card-title">{profile.name}</h2>
        <p>{profile.targetMarket}</p>
      </div>
      <div className="profile-filter-row">
        {profile.geographies.slice(0, 3).map((geography) => (
          <span className="profile-filter-pill" key={geography}>
            {geography}
          </span>
        ))}
        {profile.industries.slice(0, 2).map((industry) => (
          <span className="profile-filter-pill strong" key={industry}>
            {industry}
          </span>
        ))}
      </div>
      <div className="chip-row">
        {profile.titles.slice(0, 3).map((title) => (
          <span className="pill" key={title}>
            {title}
          </span>
        ))}
      </div>
      <div className="profile-source-row">
        <SourceDots sources={profile.sources} />
        <span>{profile.sources.join(", ")}</span>
      </div>
      <div className="profile-card-footer">
        <span>{formatDate(profile.updatedAt)}</span>
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
            <button className="button secondary" type="submit" title="Copy profile">
              <Copy size={16} aria-hidden="true" />
              Copy
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

function FilterTile({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="profile-filter-tile">
      <Icon size={17} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <span className="source-dot-row">
      {sources.map((source) => (
        <span className="source-dot" key={source} style={{ background: sourceColor(source) }} title={source}>
          {source.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function sourceUsage(profiles: SearchProfile[]) {
  const counts = new Map<string, number>();

  for (const profile of profiles) {
    for (const source of profile.sources) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function joinList(values: string[] | undefined) {
  return values?.length ? values.slice(0, 5).join(", ") : "No filter selected";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function sourceColor(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("apollo")) return "var(--blue-500)";
  if (normalized.includes("hunter")) return "var(--teal-600)";
  if (normalized.includes("google")) return "var(--warning)";
  if (normalized.includes("csv")) return "var(--ink-600)";
  if (normalized.includes("apify")) return "var(--ink-700)";
  return "var(--syn-primary)";
}
