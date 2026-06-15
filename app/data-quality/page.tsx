import { BadgeCheck, GitMerge, SearchCheck, ShieldCheck } from "lucide-react";
import {
  detectDuplicatesAction,
  ignoreDuplicateAction,
  mergeDuplicateAction,
  runVerificationAction
} from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricIcons = [BadgeCheck, ShieldCheck, ShieldCheck, GitMerge];

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
  const latestVerification = [...verificationResults].sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt));

  const metrics = [
    {
      label: "Verified A/B",
      value: verified,
      note: "Eligible under strict email gates",
      tone: "success" as const
    },
    {
      label: "Risk C",
      value: risky,
      note: "Needs enrichment or risk label",
      tone: risky ? "warning" as const : "success" as const
    },
    {
      label: "Blocked D/S",
      value: invalid + suppressed,
      note: "Invalid or globally suppressed",
      tone: invalid + suppressed ? "danger" as const : "success" as const
    },
    {
      label: "Open duplicates",
      value: openMatches.length,
      note: "Company/contact candidates",
      tone: openMatches.length ? "warning" as const : "success" as const
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

      <section className="grid metrics" aria-label="Data quality metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? BadgeCheck;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid two">
        <div className="panel">
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
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Grade distribution</h2>
              <p className="section-subtitle">Current contact quality by export eligibility.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <GradeRow label="A/B verified" value={verified} total={contacts.length} tone="success" />
            <GradeRow label="C risk-labeled" value={risky} total={contacts.length} tone="warning" />
            <GradeRow label="D invalid" value={invalid} total={contacts.length} tone="danger" />
            <GradeRow label="S suppressed" value={suppressed} total={contacts.length} tone="warning" />
          </div>
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

function GradeRow({
  label,
  value,
  total,
  tone
}: {
  label: string;
  value: number;
  total: number;
  tone: "success" | "info" | "warning" | "danger";
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="stage-row">
      <div className="stage-meta">
        <strong>{label}</strong>
        <StatusPill label={`${formatNumber(value)} contacts`} tone={tone} />
      </div>
      <div className="row-meta">
        <span>{percent}% of contacts</span>
        <span>{formatNumber(total)} total</span>
      </div>
    </div>
  );
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
