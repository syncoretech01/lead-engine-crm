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
import type { LucideIcon } from "lucide-react";
import {
  detectDuplicatesAction,
  ignoreDuplicateAction,
  mergeDuplicateAction,
  runVerificationAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState, LeadGrade } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const { state, workspaceId } = await getWorkspaceContext("run_jobs");
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const verificationResults = state.verificationResults.filter((result) => result.workspaceId === workspaceId);
  const openMatches = state.dedupeMatches.filter(
    (match) => match.workspaceId === workspaceId && match.status === "Open"
  );
  const suppressed = contacts.filter((contact) => contact.isSuppressed).length;
  const verified = contacts.filter((contact) => contact.grade === "A" || contact.grade === "B").length;
  const risky = contacts.filter((contact) => contact.grade === "C").length;
  const invalid = contacts.filter((contact) => contact.grade === "D").length;
  const missingEmail = verificationResults.filter((result) => result.emailStatus === "Missing").length;
  const catchAll = verificationResults.filter((result) => result.catchAll).length;
  const roleEmail = verificationResults.filter((result) => result.roleEmail).length;
  const validPhones = verificationResults.filter((result) => result.phoneStatus === "Valid").length;
  const expiringSoon = verificationResults.filter((result) => {
    const expiresAt = Date.parse(result.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt - Date.now() < 1000 * 60 * 60 * 24 * 30;
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
      value: formatNumber(openMatches.length),
      note: "Company/contact candidates",
      icon: GitMerge,
      tone: openMatches.length ? "warning" as const : "success" as const
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
          <QualityLaneCard key={lane.label} {...lane} />
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
            <RiskRow label="Missing email" value={missingEmail} total={verificationResults.length} tone={missingEmail ? "warning" : "success"} />
            <RiskRow label="Suppressed contacts" value={suppressed} total={contacts.length} tone={suppressed ? "warning" : "success"} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Duplicate candidates</h2>
            <p className="section-subtitle">Resolve open candidates before export or CRM sync.</p>
          </div>
          <StatusPill label={`${openMatches.length} open`} tone={openMatches.length ? "warning" : "success"} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Primary</th>
                <th>Duplicate</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {openMatches.map((match) => (
                <tr key={match.id}>
                  <td>
                    <StatusPill label={match.objectType} tone="info" />
                  </td>
                  <td>{entityName(state, match.objectType, match.primaryId)}</td>
                  <td>{entityName(state, match.objectType, match.duplicateId)}</td>
                  <td>
                    <div className="entity">
                      <strong>{match.reason}</strong>
                      <span>{match.confidence}% confidence</span>
                    </div>
                  </td>
                  <td>
                    <div className="item-card-actions">
                      <form action={mergeDuplicateAction}>
                        <input name="id" type="hidden" value={match.id} />
                        <button className="button primary" type="submit">
                          Merge
                        </button>
                      </form>
                      <form action={ignoreDuplicateAction}>
                        <input name="id" type="hidden" value={match.id} />
                        <button className="button secondary" type="submit">
                          Ignore
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {openMatches.length === 0 ? (
                <tr>
                  <td colSpan={5}>No open duplicate candidates.</td>
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
          <StatusPill label={`${verificationResults.length} checks`} tone="info" />
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
              {latestVerification.slice(0, 40).map((result) => (
                <tr key={result.id}>
                  <td>{state.contacts.find((contact) => contact.id === result.contactId)?.name ?? "Unknown"}</td>
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
              ))}
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

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  tone: "info" | "success" | "warning" | "danger";
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-label">
        <span className="stat-icon">
          <Icon size={15} aria-hidden="true" />
        </span>
        {label}
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </article>
  );
}

function QualityLaneCard({
  icon: Icon,
  label,
  value,
  note,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  note: string;
  tone: "info" | "success" | "warning";
}) {
  return (
    <article className={`ops-stage-card ${tone}`}>
      <span className="ops-stage-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <div>
        <strong>{formatNumber(value)}</strong>
        <span>{label}</span>
        <p>{note}</p>
      </div>
    </article>
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

function entityName(
  state: AppState,
  objectType: "company" | "contact",
  id: string
) {
  if (objectType === "company") {
    return state.companies.find((company) => company.id === id)?.name ?? id;
  }

  return state.contacts.find((contact) => contact.id === id)?.name ?? id;
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
