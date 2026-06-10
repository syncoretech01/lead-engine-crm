import { AlertTriangle, BarChart3, Database, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { addSuppressionAction, deleteSuppressionAction, resetPhase1DataAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { rolePermissions } from "@/lib/phase1/auth";
import { complianceReadRowsForWorkspace } from "@/lib/phase1/compliance-read-path";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { SuppressionRecord } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const { state, workspaceId } = await getWorkspaceContext("manage_compliance");
  const complianceRows = await complianceReadRowsForWorkspace(state, workspaceId);
  const suppressionSummary = suppressionMetrics(complianceRows.suppressionRecords, workspaceId);
  const members = state.workspaceMembers
    .filter((member) => member.workspaceId === workspaceId)
    .map((member) => ({
      ...member,
      user: state.users.find((user) => user.id === member.userId)
    }));
  const retentionPolicies = state.retentionPolicies.filter((policy) => policy.workspaceId === workspaceId);

  return (
    <>
      <PageHeader
        kicker="Controls and audit"
        title="Compliance"
        copy="Workspace guardrails for suppression, consent/source labels, retention, audit logs, outbound requirements, and sanctioned integration boundaries."
        actions={
          <>
            <a className="button secondary" href="#audit-logs">
              <Database size={17} aria-hidden="true" />
              Audit logs
            </a>
            <a className="button secondary" href="/reports/compliance">
              <BarChart3 size={17} aria-hidden="true" />
              Retention workflows
            </a>
            <form action={resetPhase1DataAction}>
              <button className="button danger" type="submit">
                <Trash2 size={17} aria-hidden="true" />
                Reset local data
              </button>
            </form>
          </>
        }
      />

      <section className="grid metrics">
        {suppressionSummary.map((item) => (
          <article className="metric-card" key={item.label}>
            <div className="metric-top">
              <span className="metric-label">{item.label}</span>
              <StatusPill label={item.policy} tone="warning" />
            </div>
            <div className="metric-value">{formatNumber(item.count)}</div>
            <span className="metric-note">Enforced before export, CRM assignment, and outreach.</span>
          </article>
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Add suppression</h2>
              <p className="section-subtitle">New suppression records immediately update matching contacts to grade S and block exports.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <form action={addSuppressionAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="suppType">Type</label>
              <select id="suppType" name="type">
                <option value="Unsubscribe">Unsubscribe</option>
                <option value="Hard bounce">Hard bounce</option>
                <option value="Do not call">Do not call</option>
                <option value="Existing customer">Existing customer</option>
                <option value="Competitor">Competitor</option>
                <option value="Spam complaint">Spam complaint</option>
                <option value="SMS opt-out">SMS opt-out</option>
                <option value="Deletion request">Deletion request</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="suppEmail">Email</label>
              <input id="suppEmail" name="email" placeholder="person@company.com" />
            </div>
            <div className="field">
              <label htmlFor="suppPhone">Phone</label>
              <input id="suppPhone" name="phone" placeholder="+1 555 000 0000" />
            </div>
            <div className="field">
              <label htmlFor="suppDomain">Domain</label>
              <input id="suppDomain" name="domain" placeholder="customer.com" />
            </div>
            <div className="field">
              <label htmlFor="suppReason">Reason</label>
              <input id="suppReason" name="reason" placeholder="hard bounce, active customer, DNC" required />
            </div>
            <div className="field">
              <label htmlFor="suppSource">Source</label>
              <input id="suppSource" name="source" defaultValue="Manual" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Add suppression
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Workspace members</h2>
              <p className="section-subtitle">Demo auth context and workspace RBAC permissions.</p>
            </div>
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="entity">
                        <strong>{member.user?.name}</strong>
                        <span>{member.user?.email}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={member.role} tone={member.role === "Admin" ? "success" : "info"} />
                    </td>
                    <td>
                      <div className="chip-row">
                        {rolePermissions(member.role).map((permission) => (
                          <span className="pill" key={permission}>
                            {permission}
                          </span>
                        ))}
                      </div>
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
              <h2 className="section-title">Retention defaults</h2>
              <p className="section-subtitle">Practical defaults from the blueprint ready for admin configuration.</p>
            </div>
            <Trash2 size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data type</th>
                  <th>Retention</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {retentionPolicies.map((policy) => (
                  <tr key={policy.id}>
                    <td>{policy.dataType}</td>
                    <td>{policy.retentionDays === 0 ? "Indefinite" : `${policy.retentionDays} days`}</td>
                    <td>{policy.action}</td>
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
            <h2 className="section-title">Suppression records</h2>
            <p className="section-subtitle">Global email, phone, and domain blocks enforced before assignment and export.</p>
          </div>
          <StatusPill label={`${complianceRows.suppressionRecords.length} records`} tone="warning" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Source</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {complianceRows.suppressionRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <StatusPill label={record.type} tone="warning" />
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{record.email ?? record.phone ?? record.domain ?? "Global"}</strong>
                      <span>{record.id}</span>
                    </div>
                  </td>
                  <td>{record.reason}</td>
                  <td>{record.source}</td>
                  <td>{new Date(record.createdAt).toLocaleDateString("en-US")}</td>
                  <td>
                    <form action={deleteSuppressionAction}>
                      <input name="id" type="hidden" value={record.id} />
                      <button className="button danger" type="submit">
                        Delete
                      </button>
                    </form>
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
              <h2 className="section-title">Integration boundaries</h2>
              <p className="section-subtitle">Controls that keep outbound work aligned with source rules and sending policy.</p>
            </div>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <div className="list-row">
              <div className="row-meta">
                <strong>LinkedIn automation</strong>
                <StatusPill label="Not supported" tone="danger" />
              </div>
              <p className="section-subtitle">Use sanctioned integrations or manual/import workflows only.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Cold email requirements</strong>
                <StatusPill label="Required" tone="warning" />
              </div>
              <p className="section-subtitle">Templates must include unsubscribe handling and physical address fields.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>SMS and DNC</strong>
                <StatusPill label="Global enforcement" tone="success" />
              </div>
              <p className="section-subtitle">STOP replies, opt-outs, and DNC records block phone/SMS actions.</p>
            </div>
            <div className="list-row">
              <div className="row-meta">
                <strong>Provider secrets</strong>
                <StatusPill label="Workspace scoped" tone="info" />
              </div>
              <p className="section-subtitle">API keys belong to integrations and should be encrypted at rest.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" id="audit-logs">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Audit logs</h2>
            <p className="section-subtitle">Profile, job, import, verification, suppression, dedupe, export, and reset activity.</p>
          </div>
          <StatusPill label={`${complianceRows.auditLogs.length} events`} tone="info" />
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
              {complianceRows.auditLogs.slice(0, 12).map((log) => (
                <tr key={log.id}>
                  <td>
                    {new Date(log.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </td>
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
                  <td>{log.reason ?? "Recorded by Syncore workflow"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid three">
        <div className="item-card">
          <KeyRound size={22} aria-hidden="true" />
          <h2 className="card-title">RBAC baseline</h2>
          <p className="section-subtitle">Admin, Manager, SDR, Data Operator, Viewer, and Compliance Admin roles are represented in the schema.</p>
        </div>
        <div className="item-card">
          <Database size={22} aria-hidden="true" />
          <h2 className="card-title">Audit trail</h2>
          <p className="section-subtitle">Critical changes should write actor, object, old/new value, IP, user agent, and timestamp.</p>
        </div>
        <div className="item-card">
          <ShieldCheck size={22} aria-hidden="true" />
          <h2 className="card-title">Source lineage</h2>
          <p className="section-subtitle">Field-level provenance is modeled so provider conflicts can be reviewed and explained.</p>
        </div>
      </section>
    </>
  );
}

function suppressionMetrics(records: SuppressionRecord[], workspaceId: string) {
  const groups = [
    { label: "Unsubscribed emails", type: "Unsubscribe", policy: "Global block" },
    { label: "Hard bounces", type: "Hard bounce", policy: "Global block" },
    { label: "Do-not-call phones", type: "Do not call", policy: "Phone/SMS block" },
    { label: "Existing customers", type: "Existing customer", policy: "Export block" },
    { label: "SMS opt-outs", type: "SMS opt-out", policy: "SMS block" }
  ];

  return groups.map((group) => ({
    ...group,
    count: records.filter(
      (record) => record.workspaceId === workspaceId && record.type === group.type
    ).length
  }));
}
