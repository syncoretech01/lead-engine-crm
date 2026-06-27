import {
  BadgeCheck,
  Clock,
  GitMerge,
  MailCheck,
  Phone,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import {
  detectDuplicatesAction,
  ignoreDuplicateGroupAction,
  ignoreDuplicateAction,
  ignoreUnactionableDuplicatesAction,
  mergeDuplicateGroupAction,
  mergeDuplicateAction,
  runVerificationAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill } from "@/components/status-pill";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { buildLeadEngineMetrics, displayContactLabel, groupOpenDedupeMatches } from "@/lib/phase1/lead-engine-metrics";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { AppState, LeadGrade } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const { session, workspaceId: scopedWorkspaceId } = await getWorkspaceSessionContext("run_jobs");
  let workspaceId = scopedWorkspaceId;
  let state = await readFastLeadDashboardState(session, workspaceId);
  if (!state) {
    const context = await getWorkspaceContext("run_jobs");
    state = context.state;
    workspaceId = context.workspaceId;
  }
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const verificationResults = state.verificationResults.filter((result) => result.workspaceId === workspaceId);
  const openMatches = state.dedupeMatches.filter(
    (match) => match.workspaceId === workspaceId && match.status === "Open"
  );
  const metrics = buildLeadEngineMetrics(state, workspaceId);
  const duplicateGroups = groupOpenDedupeMatches(state, workspaceId);
  const visibleDuplicateGroups = duplicateGroups.slice(0, 25);
  const suppressed = contacts.filter((contact) => contact.isSuppressed).length;
  const verified = metrics.verifiedCount;
  const risky = metrics.riskCount;
  const invalid = metrics.invalidCount;
  const missingEmail = verificationResults.filter((result) => result.emailStatus === "Missing").length;
  const catchAll = verificationResults.filter((result) => result.catchAll).length;
  const roleEmail = verificationResults.filter((result) => result.roleEmail).length;
  const validPhones = verificationResults.filter((result) => result.phoneStatus === "Valid").length;
  const verificationReferenceTime = verificationResults.reduce(
    (latest, result) => Math.max(latest, Date.parse(result.verifiedAt) || 0),
    0
  );
  const expiringSoon = verificationResults.filter((result) => {
    const expiresAt = Date.parse(result.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt - verificationReferenceTime < 1000 * 60 * 60 * 24 * 30;
  }).length;
  const latestVerification = [...verificationResults].sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt));
  const gradeRows = gradeDistribution(contacts);

  const stats = [
    {
      label: "Verified A/B",
      value: formatNumber(verified),
      note: "Eligible under strict email gates",
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Risk C",
      value: formatNumber(risky),
      note: "Needs enrichment or risk label",
      icon: TriangleAlert,
      tone: risky ? "warning" as const : "success" as const
    },
    {
      label: "Blocked D/S",
      value: formatNumber(invalid + suppressed),
      note: "Invalid or globally suppressed",
      icon: ShieldAlert,
      tone: invalid + suppressed ? "danger" as const : "success" as const
    },
    {
      label: "Open duplicates",
      value: formatNumber(metrics.duplicateGroupCount),
      note: `${formatNumber(metrics.actionableDuplicatePairCount)} actionable pairs`,
      icon: GitMerge,
      tone: metrics.duplicateGroupCount ? "warning" as const : "success" as const
    }
  ];

  const qualityLanes = [
    {
      label: "Verification checks",
      value: verificationResults.length,
      note: "Local verification history",
      icon: MailCheck,
      tone: "info" as const
    },
    {
      label: "Phone valid",
      value: validPhones,
      note: "Callable records",
      icon: Phone,
      tone: "success" as const
    },
    {
      label: "Catch-all / role",
      value: catchAll + roleEmail,
      note: "Needs cautious export rules",
      icon: TriangleAlert,
      tone: catchAll + roleEmail ? "warning" as const : "success" as const
    },
    {
      label: "Expiring soon",
      value: expiringSoon,
      note: "Recheck within 30 days",
      icon: Clock,
      tone: expiringSoon ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Data quality"
        copy="Run local verification, maintain A/B/C/D/S grades, review duplicate candidates, and keep risky records out of export-ready lists."
        actions={
          <>
            <form action={runVerificationAction}>
              <button className="button primary" type="submit">
                <SearchCheck size={17} aria-hidden="true" />
                Run verification
              </button>
            </form>
            <form action={detectDuplicatesAction}>
              <button className="button secondary" type="submit">
                <GitMerge size={17} aria-hidden="true" />
                Scan duplicates
              </button>
            </form>
          </>
        }
      />

      <section className="stat-grid" aria-label="Data quality metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="ops-stage-strip" aria-label="Data quality lanes">
        {qualityLanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two quality-ops-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Grade control</div>
              <h2 className="section-title">Export eligibility distribution</h2>
              <p className="section-subtitle">The current contact base split by quality gate and suppression state.</p>
            </div>
            <StatusPill label={`${formatNumber(contacts.length)} contacts`} tone="info" />
          </div>
          <div className="panel-body quality-grade-grid">
            {gradeRows.map((row) => (
              <GradeCard key={row.grade} {...row} total={contacts.length} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Risk lanes</div>
              <h2 className="section-title">Verification warnings</h2>
              <p className="section-subtitle">Signals that should affect exports, campaigns, and SDR assignment.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body signal-list">
            <RiskRow label="Catch-all domains" value={catchAll} total={verificationResults.length} tone={catchAll ? "warning" : "success"} />
            <RiskRow label="Role-based emails" value={roleEmail} total={verificationResults.length} tone={roleEmail ? "warning" : "success"} />
            <RiskRow label="Personal email domains" value={metrics.personalEmailCount} total={contacts.length} tone={metrics.personalEmailCount ? "warning" : "success"} />
            <RiskRow label="Missing company" value={metrics.missingCompanyCount} total={contacts.length} tone={metrics.missingCompanyCount ? "warning" : "success"} />
            <RiskRow label="Missing contact name" value={metrics.missingContactCount} total={contacts.length} tone={metrics.missingContactCount ? "warning" : "success"} />
            <RiskRow label="Missing email" value={missingEmail} total={verificationResults.length} tone={missingEmail ? "warning" : "success"} />
            <RiskRow label="Suppressed contacts" value={suppressed} total={contacts.length} tone={suppressed ? "warning" : "success"} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Duplicate candidates</h2>
            <p className="section-subtitle">
              Actionable duplicate groups are shown first. Placeholder or low-quality legacy matches are hidden from the operator queue.
            </p>
          </div>
          <div className="page-actions">
            {metrics.hiddenDuplicatePairCount ? (
              <form action={ignoreUnactionableDuplicatesAction}>
                <button className="button secondary" type="submit">
                  Ignore {formatNumber(metrics.hiddenDuplicatePairCount)} stale
                </button>
              </form>
            ) : null}
            <StatusPill
              label={`${formatNumber(metrics.duplicateGroupCount)} groups`}
              tone={metrics.duplicateGroupCount ? "warning" : "success"}
            />
          </div>
        </div>
        <div className="quality-queue-summary">
          <span>{formatNumber(metrics.duplicatePairCount)} open raw pairs</span>
          <span>{formatNumber(metrics.actionableDuplicatePairCount)} actionable pairs</span>
          <span>{formatNumber(metrics.hiddenDuplicatePairCount)} hidden stale pairs</span>
          <span>Showing {formatNumber(visibleDuplicateGroups.length)} groups</span>
        </div>
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Primary</th>
                <th>Duplicates</th>
                <th>Evidence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleDuplicateGroups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <div className="entity">
                      <StatusPill label={group.matchType} tone="info" />
                      <span>{group.objectType}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{group.primaryLabel}</strong>
                      <span>{group.primaryDetail}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{formatNumber(group.duplicateIds.length)} duplicate{group.duplicateIds.length === 1 ? "" : "s"}</strong>
                      <span>{group.duplicateLabels.slice(0, 3).join(", ")}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{group.reason}</strong>
                      <span>{group.confidence}% confidence</span>
                    </div>
                  </td>
                  <td>
                    <div className="item-card-actions">
                      <form action={group.matchIds.length > 1 ? mergeDuplicateGroupAction : mergeDuplicateAction}>
                        {group.matchIds.map((id) => (
                          <input name="id" type="hidden" value={id} key={id} />
                        ))}
                        <button className="button primary" type="submit">
                          Merge
                        </button>
                      </form>
                      <form action={group.matchIds.length > 1 ? ignoreDuplicateGroupAction : ignoreDuplicateAction}>
                        {group.matchIds.map((id) => (
                          <input name="id" type="hidden" value={id} key={id} />
                        ))}
                        <button className="button secondary" type="submit">
                          Ignore
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleDuplicateGroups.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {openMatches.length
                      ? "No actionable duplicate groups. Use the stale cleanup action to clear old placeholder matches."
                      : "No open duplicate candidates."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Verification history</h2>
            <p className="section-subtitle">Recent verification checks with grade, email, phone, checks, and expiry.</p>
          </div>
          <StatusPill label={`${formatNumber(verificationResults.length)} checks`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Grade</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Checks</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {latestVerification.slice(0, 25).map((result) => {
                const contact = state.contacts.find((item) => item.id === result.contactId);
                return (
                <tr key={result.id}>
                  <td>{displayContactLabel(contact, result.email || "Unknown contact")}</td>
                  <td>
                    <span className={`grade ${result.grade.toLowerCase()}`}>{result.grade}</span>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{result.emailStatus}</strong>
                      <span>{result.email}</span>
                    </div>
                  </td>
                  <td>{result.phoneStatus}</td>
                  <td>
                    <div className="chip-row">
                      {result.checks.slice(0, 4).map((check) => (
                        <span className="pill" key={check}>
                          {check}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{formatDate(result.expiresAt)}</td>
                </tr>
              );
              })}
              {latestVerification.length === 0 ? (
                <tr>
                  <td colSpan={6}>No verification results have been recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}


function GradeCard({
  grade,
  label,
  value,
  total,
  tone
}: {
  grade: LeadGrade;
  label: string;
  value: number;
  total: number;
  tone: "success" | "info" | "warning" | "danger";
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="quality-grade-card">
      <div className="grade-card-top">
        <span className={`grade ${grade.toLowerCase()}`}>{grade}</span>
        <StatusPill label={label} tone={tone} />
      </div>
      <strong>{formatNumber(value)}</strong>
      <ProgressBar value={percent} />
      <span>{percent}% of contacts</span>
    </div>
  );
}

function RiskRow({
  label,
  value,
  total,
  tone
}: {
  label: string;
  value: number;
  total: number;
  tone: "success" | "warning";
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="signal-row">
      <div className="signal-main">
        <span className={`risk-dot ${tone}`} />
        <div>
          <strong>{label}</strong>
          <span>{percent}% of scoped records</span>
        </div>
      </div>
      <div className="signal-meta">
        <StatusPill label={`${formatNumber(value)} records`} tone={tone} />
      </div>
    </div>
  );
}

function gradeDistribution(contacts: AppState["contacts"]) {
  const rows: Array<{
    grade: LeadGrade;
    label: string;
    value: number;
    tone: "success" | "info" | "warning" | "danger";
  }> = [
    { grade: "A", label: "Best", value: 0, tone: "success" },
    { grade: "B", label: "Good", value: 0, tone: "info" },
    { grade: "C", label: "Risk", value: 0, tone: "warning" },
    { grade: "D", label: "Invalid", value: 0, tone: "danger" },
    { grade: "S", label: "Suppressed", value: 0, tone: "warning" }
  ];

  for (const row of rows) {
    row.value = contacts.filter((contact) => (row.grade === "S" ? contact.isSuppressed || contact.grade === "S" : contact.grade === row.grade)).length;
  }

  return rows;
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
