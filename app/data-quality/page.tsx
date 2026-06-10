import { BadgeCheck, GitMerge, SearchCheck, ShieldCheck } from "lucide-react";
import {
  detectDuplicatesAction,
  ignoreDuplicateAction,
  mergeDuplicateAction,
  runVerificationAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { AppState } from "@/lib/phase1/types";
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

  return (
    <>
      <PageHeader
        kicker="Data quality"
        title="Data quality"
        copy="Run deterministic local verification, maintain A/B/C/D/S grades, review verification history, and resolve duplicate company/contact candidates before export."
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

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Verified A/B</span>
            <BadgeCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(verified)}</div>
          <span className="metric-note">Eligible under strict email rules when score/status pass.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Risk-labeled C</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(risky)}</div>
          <span className="metric-note">Role or catch-all heuristic; enrichment recommended.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Invalid D</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(invalid)}</div>
          <span className="metric-note">Blocked from verified email exports.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Suppressed S</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(suppressed)}</div>
          <span className="metric-note">Blocked globally by email, phone, or domain.</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Duplicate candidates</h2>
            <p className="section-subtitle">Matches use domain, email, company name/location, fuzzy company name, and full name/company keys.</p>
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
                <th>Confidence</th>
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
                  <td>{match.reason}</td>
                  <td>{match.confidence}%</td>
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
                  <td colSpan={6}>No open duplicate candidates.</td>
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
            <p className="section-subtitle">Each verification run records provider, grade, checks, raw response, timestamp, and TTL.</p>
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
                <th>Verified</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {verificationResults.slice(0, 40).map((result) => (
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
                  <td>{formatDate(result.verifiedAt)}</td>
                  <td>{formatDate(result.expiresAt)}</td>
                </tr>
              ))}
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

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
