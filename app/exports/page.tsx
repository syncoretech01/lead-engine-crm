import { Download, FileText, Mail, Phone, ShieldCheck } from "lucide-react";
import { createExportAction, createExportRuleAction, deleteExportRuleAction } from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { exportReadRowsForWorkspace } from "@/lib/phase1/export-read-path";
import { exportTemplates } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricIcons = [Download, ShieldCheck, FileText, Mail];

export default async function ExportsPage() {
  const { state, workspaceId } = await getWorkspaceContext("export_csv");
  const templates = exportTemplates(state, workspaceId);
  const exportHistory = await exportReadRowsForWorkspace(state, workspaceId);
  const rules = state.exportRules.filter((rule) => rule.workspaceId === workspaceId);
  const eligibleTotal = templates.reduce((total, template) => total + template.eligible, 0);
  const blockedTotal = exportHistory.reduce((total, exportItem) => total + (exportItem.blockedCount ?? 0), 0);
  const readyExports = exportHistory.filter((exportItem) => exportItem.status === "Ready").length;

  const metrics = [
    {
      label: "Export types",
      value: templates.length,
      note: "CSV and SDR handoff templates",
      tone: "info" as const
    },
    {
      label: "Eligible records",
      value: eligibleTotal,
      note: "Across current export templates",
      tone: "success" as const
    },
    {
      label: "Ready exports",
      value: readyExports,
      note: `${formatNumber(exportHistory.length)} total generated`,
      tone: "success" as const
    },
    {
      label: "Blocked rows",
      value: blockedTotal,
      note: "Stopped by export gates",
      tone: blockedTotal ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Exports"
        copy="Generate approved output from clean records only: verified email leads, phone-ready contacts, segmented lists, company records, and SDR handoff queues."
        actions={
          <>
            <a href="#export-history" className="button secondary">
              <FileText size={17} aria-hidden="true" />
              Export history
            </a>
            <a href="#export-templates" className="button primary">
              <Download size={17} aria-hidden="true" />
              Generate export
            </a>
          </>
        }
      />

      <section className="grid metrics" aria-label="Export metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Download;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid four" id="export-templates">
        {templates.map((template) => (
          <article className="item-card workflow-card" key={template.id}>
            <div className="item-card-header">
              <div>
                <h2 className="card-title">{template.name}</h2>
                <p className="section-subtitle">{template.description}</p>
              </div>
              <StatusPill label={`${formatNumber(template.eligible)} eligible`} tone="success" />
            </div>
            <div className="chip-row">
              {template.columns.slice(0, 5).map((column) => (
                <span className="pill" key={column}>
                  {column}
                </span>
              ))}
            </div>
            <form action={createExportAction} className="stage-list">
              <input name="type" type="hidden" value={template.id} />
              <input name="name" type="hidden" value={template.name} />
              <div className="field">
                <label htmlFor={`rule-${template.id}`}>Export rule</label>
                <select id={`rule-${template.id}`} name="exportRuleId">
                  <option value="">Default gates</option>
                  {rules
                    .filter((rule) => rule.exportType === template.id)
                    .map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name}
                      </option>
                    ))}
                </select>
              </div>
              <button className="button primary" type="submit">
                <Download size={16} aria-hidden="true" />
                Generate
              </button>
            </form>
          </article>
        ))}
      </section>

      <section className="panel" id="export-history">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Export history</h2>
            <p className="section-subtitle">Every output stores user, timestamp, source job, filter snapshot, and record count.</p>
          </div>
          <StatusPill label={`${formatNumber(exportHistory.length)} exports`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Export</th>
                <th>Records</th>
                <th>Created by</th>
                <th>Created</th>
                <th>Source job</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {exportHistory.map((exportItem) => (
                <tr key={exportItem.id}>
                  <td>
                    <div className="entity">
                      <strong>{exportItem.name}</strong>
                      <span>{exportItem.id}</span>
                    </div>
                  </td>
                  <td>{formatNumber(exportItem.recordCount)}</td>
                  <td>{state.users.find((user) => user.id === exportItem.createdById)?.name ?? "Syncore user"}</td>
                  <td>{formatDate(exportItem.createdAt)}</td>
                  <td>{exportItem.leadJobId ?? "Manual"}</td>
                  <td>
                    <div className="chip-row">
                      <StatusPill label={exportItem.status} tone={statusTone(exportItem.status)} />
                      {exportItem.blockedCount ? <StatusPill label={`${exportItem.blockedCount} blocked`} tone="warning" /> : null}
                      <a className="button secondary" href={`/api/exports/${exportItem.id}`}>
                        Download
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {exportHistory.length === 0 ? (
                <tr>
                  <td colSpan={6}>No exports have been generated yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Export rules</h2>
              <p className="section-subtitle">Active gates used when generating CSV output.</p>
            </div>
            <StatusPill label={`${rules.length} rules`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {rules.map((rule) => (
              <div className="stage-row" key={rule.id}>
                <div className="stage-meta">
                  <strong>{rule.name}</strong>
                  <StatusPill label={rule.exportType} tone="info" />
                </div>
                <div className="chip-row">
                  <span className="pill">grades {rule.allowedGrades.join("/")}</span>
                  <span className="pill">score {rule.minScore}+</span>
                  <span className="pill">{rule.excludeSuppressed ? "suppression blocked" : "suppression allowed"}</span>
                  <span className="pill">{rule.requirePhone ? "phone required" : "phone optional"}</span>
                </div>
                <form action={deleteExportRuleAction}>
                  <input name="id" type="hidden" value={rule.id} />
                  <button className="button danger" type="submit">
                    Delete
                  </button>
                </form>
              </div>
            ))}
            {rules.length === 0 ? <p className="section-subtitle">No custom export rules have been created yet.</p> : null}
          </div>
        </div>

        <div className="panel" id="create-export-rule">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Create export rule</h2>
              <p className="section-subtitle">Rules enforce verification grade, score, status, suppression, role email, catch-all, and phone requirements.</p>
            </div>
            <StatusPill label="Rule setup" tone="success" />
          </div>
          <form action={createExportRuleAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="ruleName">Rule name</label>
              <input id="ruleName" name="name" placeholder="P1 verified email only" required />
            </div>
            <div className="field">
              <label htmlFor="exportType">Export type</label>
              <select id="exportType" name="exportType">
                <option value="verified_email_leads">Verified email leads</option>
                <option value="contacts">Contacts</option>
                <option value="sdr_assignments">SDR assignments</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="minScore">Minimum score</label>
              <input id="minScore" name="minScore" type="number" min="0" max="100" defaultValue="60" />
            </div>
            <div className="field">
              <label>Allowed grades</label>
              <div className="chip-row">
                {["A", "B", "C", "D"].map((grade) => (
                  <label className="pill" key={grade}>
                    <input name="allowedGrades" type="checkbox" value={grade} defaultChecked={grade === "A" || grade === "B"} /> {grade}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Allowed statuses</label>
              <div className="chip-row">
                {["Ready for SDR", "Needs enrichment", "Exported", "In review"].map((status) => (
                  <label className="pill" key={status}>
                    <input name="allowedStatuses" type="checkbox" value={status} defaultChecked={status === "Ready for SDR"} /> {status}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Additional gates</label>
              <div className="chip-row">
                <label className="pill">
                  <input name="includeRoleEmails" type="checkbox" /> Include role emails
                </label>
                <label className="pill">
                  <input name="includeCatchAll" type="checkbox" /> Include catch-all
                </label>
                <label className="pill">
                  <input name="requirePhone" type="checkbox" /> Require phone
                </label>
              </div>
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Save rule
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="grid three">
        <div className="item-card workflow-card">
          <Mail size={22} aria-hidden="true" />
          <h2 className="card-title">Email CSV</h2>
          <p className="section-subtitle">Excludes D-grade emails, suppressed contacts, and hard-bounced addresses.</p>
        </div>
        <div className="item-card workflow-card">
          <Phone size={22} aria-hidden="true" />
          <h2 className="card-title">Phone CSV</h2>
          <p className="section-subtitle">Includes phone-normalized leads with DNC and SMS opt-out controls applied.</p>
        </div>
        <div className="item-card workflow-card">
          <ShieldCheck size={22} aria-hidden="true" />
          <h2 className="card-title">CRM sync</h2>
          <p className="section-subtitle">Future sync jobs can use the same dedupe, source, assignment, and audit patterns.</p>
        </div>
      </section>
    </>
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
