import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Database, Play, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  completeDataSubjectRequestAction,
  createDataSubjectRequestAction,
  resolveDeliverabilityAlertAction,
  runRetentionPolicyAction,
  updateComplianceChecklistStatusAction,
  updateRetentionPolicyAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  complianceChecklistStatuses,
  reportingDashboardSnapshot,
  retentionActions
} from "@/lib/phase1/reporting";
import {
  complianceReadRowsForWorkspace,
  stateWithComplianceReadRows
} from "@/lib/phase1/compliance-read-path";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { dataSubjectRequestTypes } from "@/lib/phase1/compliance";
import { exportReadRowsForWorkspace, stateWithExportReadRows } from "@/lib/phase1/export-read-path";
import {
  outreachEventReadRowsForWorkspace,
  stateWithOutreachEventReadRows
} from "@/lib/phase1/outreach-read-path";
import { getDeveloperWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReportsCompliancePage() {
  const { state, workspaceId } = await getDeveloperWorkspaceContext();
  const [complianceRows, crmRows, outreachRows, exportRows] = await Promise.all([
    complianceReadRowsForWorkspace(state, workspaceId),
    crmEventReadRowsForWorkspace(state, workspaceId),
    outreachEventReadRowsForWorkspace(state, workspaceId),
    exportReadRowsForWorkspace(state, workspaceId)
  ]);
  const readState = stateWithExportReadRows(
    stateWithOutreachEventReadRows(
      stateWithCrmEventReadRows(
        stateWithComplianceReadRows(state, workspaceId, complianceRows),
        workspaceId,
        crmRows
      ),
      workspaceId,
      outreachRows
    ),
    workspaceId,
    exportRows
  );
  const snapshot = reportingDashboardSnapshot(readState, workspaceId);
  const retentionRuns = state.retentionRuns
    .filter((run) => run.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.runAt) - Date.parse(a.runAt));
  const auditLogs = [...complianceRows.auditLogs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const dataSubjectRequests = snapshot.compliance.dataSubjectRequests;
  const openDataSubjectRequests = dataSubjectRequests.filter(
    (request) => request.status !== "Completed" && request.status !== "Rejected"
  );

  return (
    <>
      <PageHeader
        kicker="Phase 7"
        title="Compliance workflows"
        copy="Data retention, deliverability guardrails, compliance evidence, suppression posture, and audit history for the Syncore workspace."
        actions={
          <>
            <Link href="/reports" className="button secondary">
              <Database size={17} aria-hidden="true" />
              Admin reports
            </Link>
            <Link href="/compliance" className="button primary">
              <ShieldCheck size={17} aria-hidden="true" />
              Suppression controls
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Passing controls</span>
            <ClipboardCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.compliance.statusCounts.Pass)}</div>
          <span className="metric-note">
            {formatNumber(snapshot.compliance.statusCounts.Warning)} warnings and {formatNumber(snapshot.compliance.statusCounts.Fail)} failures.
          </span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Retention candidates</span>
            <SlidersHorizontal size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">
            {formatNumber(snapshot.retention.reduce((total, policy) => total + policy.candidateCount, 0))}
          </div>
          <span className="metric-note">Across active TTL policies.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Deliverability alerts</span>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(snapshot.compliance.openAlerts.length)}</div>
          <span className="metric-note">Hard bounce, spam, unsubscribe, auth, and limit guardrails.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Privacy requests</span>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(openDataSubjectRequests.length)}</div>
          <span className="metric-note">Open access, deletion, suppression, correction, and export requests.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Audit events</span>
            <Database size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(auditLogs.length)}</div>
          <span className="metric-note">Workspace-level actor, object, action, and reason history.</span>
        </article>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Open privacy request</h2>
              <p className="section-subtitle">Track access, deletion, suppression, correction, and export requests with a 30-day due date.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <form action={createDataSubjectRequestAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="requestType">Request type</label>
              <select id="requestType" name="requestType" defaultValue="Deletion">
                {dataSubjectRequestTypes.map((requestType) => (
                  <option key={requestType} value={requestType}>
                    {requestType}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="requestEmail">Email</label>
              <input id="requestEmail" name="email" placeholder="person@company.com" />
            </div>
            <div className="field">
              <label htmlFor="requestPhone">Phone</label>
              <input id="requestPhone" name="phone" placeholder="+1 555 000 0000" />
            </div>
            <div className="field">
              <label htmlFor="requestNotes">Notes</label>
              <textarea id="requestNotes" name="notes" placeholder="Identity verification, source, and requested action" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Open request
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Privacy request queue</h2>
              <p className="section-subtitle">Deletion completion anonymizes the contact and preserves suppression evidence.</p>
            </div>
            <StatusPill label={`${openDataSubjectRequests.length} open`} tone={openDataSubjectRequests.length ? "warning" : "success"} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dataSubjectRequests.slice(0, 16).map((request) => (
                  <tr key={request.id}>
                    <td>
                      <div className="entity">
                        <strong>{request.requestType}</strong>
                        <span>{request.notes}</span>
                      </div>
                    </td>
                    <td>{request.email ?? request.phone ?? request.contactId ?? "Unlinked"}</td>
                    <td>
                      <StatusPill label={request.status} tone={request.status === "Completed" ? "success" : "warning"} />
                    </td>
                    <td>{new Date(request.dueAt).toLocaleDateString("en-US")}</td>
                    <td>
                      {request.status === "Completed" || request.status === "Rejected" ? (
                        <span className="metric-note">
                          {request.completedAt ? new Date(request.completedAt).toLocaleDateString("en-US") : request.status}
                        </span>
                      ) : (
                        <form action={completeDataSubjectRequestAction} className="inline-form">
                          <input name="requestId" type="hidden" value={request.id} />
                          <input name="evidence" placeholder="Completion evidence" />
                          <button className="button secondary" type="submit">
                            Complete
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Retention policies</h2>
            <p className="section-subtitle">Preview candidate records, apply TTL actions, and tune policy basis or retention windows.</p>
          </div>
          <StatusPill label={`${snapshot.retention.length} policies`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data type</th>
                <th>TTL</th>
                <th>Action</th>
                <th>Candidates</th>
                <th>Latest run</th>
                <th>Policy</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.retention.map((policy) => (
                <tr key={policy.id}>
                  <td>
                    <div className="entity">
                      <strong>{policy.dataType}</strong>
                      <span>{policy.legalBasis}</span>
                    </div>
                  </td>
                  <td>{policy.retentionDays === 0 ? "Indefinite" : `${policy.retentionDays} days`}</td>
                  <td>
                    <StatusPill label={policy.action} tone={statusTone(policy.action)} />
                  </td>
                  <td>{formatNumber(policy.candidateCount)}</td>
                  <td>
                    {policy.latestRun ? (
                      <div className="entity">
                        <strong>{policy.latestRun.status}</strong>
                        <span>{new Date(policy.latestRun.runAt).toLocaleString("en-US")}</span>
                      </div>
                    ) : (
                      <span className="metric-note">Not run</span>
                    )}
                  </td>
                  <td>
                    <form action={updateRetentionPolicyAction} className="inline-form wide-inline">
                      <input name="id" type="hidden" value={policy.id} />
                      <label className="pill">
                        <input name="active" type="checkbox" defaultChecked={policy.active} />
                        Active
                      </label>
                      <input name="retentionDays" type="number" min="0" defaultValue={policy.retentionDays} aria-label="Retention days" />
                      <select name="action" defaultValue={policy.action} aria-label="Retention action">
                        {retentionActions.map((action) => (
                          <option key={action} value={action}>
                            {action}
                          </option>
                        ))}
                      </select>
                      <input name="legalBasis" defaultValue={policy.legalBasis} aria-label="Legal basis" />
                      <input name="notes" defaultValue={policy.notes} aria-label="Policy notes" />
                      <button className="button secondary" type="submit">
                        Save
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="chip-row">
                      <form action={runRetentionPolicyAction}>
                        <input name="policyId" type="hidden" value={policy.id} />
                        <input name="mode" type="hidden" value="Preview" />
                        <button className="button secondary" type="submit">
                          Preview
                        </button>
                      </form>
                      <form action={runRetentionPolicyAction}>
                        <input name="policyId" type="hidden" value={policy.id} />
                        <input name="mode" type="hidden" value="Apply" />
                        <button className="button danger" type="submit">
                          <Play size={16} aria-hidden="true" />
                          Apply
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Deliverability alerts</h2>
              <p className="section-subtitle">Guardrails for bounce rate, spam complaints, unsubscribe spikes, limits, auth, and catch-all ratios.</p>
            </div>
            <StatusPill label={`${snapshot.compliance.openAlerts.length} open`} tone={snapshot.compliance.openAlerts.length ? "warning" : "success"} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th>Severity</th>
                  <th>Current</th>
                  <th>Recommendation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.deliverabilityAlerts
                  .filter((alert) => alert.workspaceId === workspaceId)
                  .map((alert) => (
                    <tr key={alert.id}>
                      <td>
                        <div className="entity">
                          <strong>{alert.trigger}</strong>
                          <span>{alert.status}</span>
                        </div>
                      </td>
                      <td>
                        <StatusPill label={alert.severity} tone={alert.severity === "Critical" ? "danger" : alert.severity === "Warning" ? "warning" : "info"} />
                      </td>
                      <td>
                        {alert.currentValue}% / {alert.threshold}%
                      </td>
                      <td>{alert.recommendation}</td>
                      <td>
                        {alert.status === "Open" ? (
                          <form action={resolveDeliverabilityAlertAction} className="inline-form">
                            <input name="alertId" type="hidden" value={alert.id} />
                            <input name="reason" placeholder="Resolution note" />
                            <button className="button secondary" type="submit">
                              Resolve
                            </button>
                          </form>
                        ) : (
                          <span className="metric-note">
                            {alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleDateString("en-US") : "Resolved"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Compliance checklist</h2>
              <p className="section-subtitle">Evidence-backed controls for email, privacy, phone/SMS, admin, and platform rules.</p>
            </div>
            <StatusPill label={`${snapshot.compliance.checklist.length} controls`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Control</th>
                  <th>Status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.compliance.checklist.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="entity">
                        <strong>{item.requirement}</strong>
                        <span>{item.category} / {item.ownerRole}</span>
                      </div>
                    </td>
                    <td>{item.control}</td>
                    <td>
                      <StatusPill label={item.status} tone={statusTone(item.status)} />
                    </td>
                    <td>
                      <form action={updateComplianceChecklistStatusAction} className="inline-form wide-inline">
                        <input name="itemId" type="hidden" value={item.id} />
                        <select name="status" defaultValue={item.status} aria-label="Checklist status">
                          {complianceChecklistStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <input name="evidence" defaultValue={item.evidence} aria-label="Checklist evidence" />
                        <button className="button secondary" type="submit">
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Retention run history</h2>
              <p className="section-subtitle">Preview and apply records with candidate counts, affected counts, and summaries.</p>
            </div>
            <StatusPill label={`${retentionRuns.length} runs`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Data type</th>
                  <th>Mode</th>
                  <th>Candidates</th>
                  <th>Affected</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {retentionRuns.slice(0, 14).map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.runAt).toLocaleString("en-US")}</td>
                    <td>{run.dataType}</td>
                    <td>
                      <StatusPill label={run.mode} tone={run.mode === "Apply" ? "warning" : "info"} />
                    </td>
                    <td>{formatNumber(run.candidateCount)}</td>
                    <td>{formatNumber(run.affectedCount)}</td>
                    <td>{run.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Audit logs</h2>
              <p className="section-subtitle">Recent changes across reporting, retention, compliance, imports, outreach, exports, and CRM.</p>
            </div>
            <StatusPill label={`${auditLogs.length} events`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Object</th>
                  <th>Action</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.slice(0, 14).map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString("en-US")}</td>
                    <td>{state.users.find((user) => user.id === log.actorUserId)?.name ?? "Syncore user"}</td>
                    <td>
                      <div className="entity">
                        <strong>{log.objectType}</strong>
                        <span>{log.objectId}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={log.action} tone="info" />
                    </td>
                    <td>{log.reason ?? "Recorded by workflow"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
