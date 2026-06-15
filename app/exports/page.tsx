import { BadgeCheck, Download, FileText, Mail, Phone, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createExportAction, createExportRuleAction, deleteExportRuleAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { exportReadRowsForWorkspace } from "@/lib/phase1/export-read-path";
import { exportTemplates } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { ExportRecord } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  const { state, workspaceId } = await getWorkspaceContext("export_csv");
  const templates = exportTemplates(state, workspaceId);
  const exportHistory = await exportReadRowsForWorkspace(state, workspaceId);
  const rules = state.exportRules.filter((rule) => rule.workspaceId === workspaceId);
  const eligibleTotal = templates.reduce((total, template) => total + template.eligible, 0);
  const blockedTotal = exportHistory.reduce((total, exportItem) => total + (exportItem.blockedCount ?? 0), 0);
  const readyExports = exportHistory.filter((exportItem) => exportItem.status === "Ready").length;
  const generatedRecords = exportHistory.reduce((total, exportItem) => total + exportItem.recordCount, 0);
  const strictRules = rules.filter((rule) => rule.excludeSuppressed && !rule.includeCatchAll && !rule.includeRoleEmails).length;

  const stats = [
    {
      label: "Export types",
      value: formatNumber(templates.length),
      note: "CSV and SDR handoff templates",
      icon: Download,
      tone: "info" as const
    },
    {
      label: "Eligible records",
      value: formatNumber(eligibleTotal),
      note: "Across current export templates",
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Ready exports",
      value: formatNumber(readyExports),
      note: `${formatNumber(exportHistory.length)} total generated`,
      icon: FileText,
      tone: "success" as const
    },
    {
      label: "Blocked rows",
      value: formatNumber(blockedTotal),
      note: "Stopped by export gates",
      icon: ShieldCheck,
      tone: blockedTotal ? "warning" as const : "success" as const
    }
  ];

  const lanes = [
    {
      label: "Generated records",
      value: generatedRecords,
      note: "Rows written to export files",
      icon: FileText,
      tone: "info" as const
    },
    {
      label: "Strict rules",
      value: strictRules,
      note: "Suppression-safe gates",
      icon: ShieldCheck,
      tone: strictRules ? "success" as const : "warning" as const
    },
    {
      label: "Email-ready",
      value: templates.find((template) => template.id === "verified_email_leads")?.eligible ?? 0,
      note: "Verified outbound rows",
      icon: Mail,
      tone: "success" as const
    },
    {
      label: "SDR handoff",
      value: templates.find((template) => template.id === "sdr_assignments")?.eligible ?? 0,
      note: "Assignment-ready rows",
      icon: Users,
      tone: "info" as const
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

      <section className="stat-grid" aria-label="Export metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Export readiness lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="export-template-grid" id="export-templates">
        {templates.map((template) => (
          <ExportTemplateCard key={template.id} template={template} rules={rules.filter((rule) => rule.exportType === template.id)} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel" id="export-history">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">History</div>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {exportHistory.map((exportItem) => (
                  <tr key={exportItem.id}>
                    <td>
                      <div className="entity">
                        <strong>{exportItem.name}</strong>
                        <span>{exportItem.leadJobId ?? "Manual"}</span>
                      </div>
                    </td>
                    <td>{formatNumber(exportItem.recordCount)}</td>
                    <td>{state.users.find((user) => user.id === exportItem.createdById)?.name ?? "Syncore user"}</td>
                    <td>{formatDate(exportItem.createdAt)}</td>
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
                    <td colSpan={5}>No exports have been generated yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Rules</div>
              <h2 className="section-title">Export gates</h2>
              <p className="section-subtitle">Active rules used when generating CSV output.</p>
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
      </section>

      <section className="panel" id="create-export-rule">
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
          <div className="field full">
            <label>Allowed grades</label>
            <div className="chip-row">
              {["A", "B", "C", "D"].map((grade) => (
                <label className="pill" key={grade}>
                  <input name="allowedGrades" type="checkbox" value={grade} defaultChecked={grade === "A" || grade === "B"} /> {grade}
                </label>
              ))}
            </div>
          </div>
          <div className="field full">
            <label>Allowed statuses</label>
            <div className="chip-row">
              {["Ready for SDR", "Needs enrichment", "Exported", "In review"].map((status) => (
                <label className="pill" key={status}>
                  <input name="allowedStatuses" type="checkbox" value={status} defaultChecked={status === "Ready for SDR"} /> {status}
                </label>
              ))}
            </div>
          </div>
          <div className="field full">
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
          <div className="field full">
            <button className="button primary" type="submit">
              Save rule
            </button>
          </div>
        </form>
      </section>

      <section className="grid three">
        <GateCard
          icon={Mail}
          title="Email CSV"
          copy="Excludes D-grade emails, suppressed contacts, and hard-bounced addresses."
        />
        <GateCard
          icon={Phone}
          title="Phone CSV"
          copy="Includes phone-normalized leads with DNC and SMS opt-out controls applied."
        />
        <GateCard
          icon={ShieldCheck}
          title="CRM sync"
          copy="Future sync jobs can use the same dedupe, source, assignment, and audit patterns."
        />
      </section>
    </>
  );
}

type ExportTemplate = ReturnType<typeof exportTemplates>[number];


function ExportTemplateCard({
  template,
  rules
}: {
  template: ExportTemplate;
  rules: Array<{ id: string; name: string }>;
}) {
  const Icon = templateIcon(template.id);
  const readiness = Math.min(100, Math.max(0, Math.round(template.eligible * 10)));

  return (
    <article className="export-template-card card-hover">
      <div className="item-card-header">
        <div className="template-icon">
          <Icon size={18} aria-hidden="true" />
        </div>
        <StatusPill label={`${formatNumber(template.eligible)} eligible`} tone={template.eligible ? "success" : "warning"} />
      </div>
      <div>
        <h2 className="card-title">{template.name}</h2>
        <p className="section-subtitle">{template.description}</p>
      </div>
      <SummaryMeter label="Readiness" value={readiness} total={100} note={`${formatNumber(template.columns.length)} columns`} />
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
            {rules.map((rule) => (
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
  );
}

function SummaryMeter({
  label,
  value,
  total,
  note
}: {
  label: string;
  value: number;
  total: number;
  note: string;
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="summary-meter">
      <div className="row-meta">
        <strong>{label}</strong>
        <span>{formatNumber(value)}</span>
      </div>
      <ProgressBar value={percent} />
      <div className="row-meta">
        <span>{percent}%</span>
        <span>{note}</span>
      </div>
    </div>
  );
}

function GateCard({
  icon: Icon,
  title,
  copy
}: {
  icon: LucideIcon;
  title: string;
  copy: string;
}) {
  return (
    <article className="item-card workflow-card">
      <Icon size={22} aria-hidden="true" />
      <h2 className="card-title">{title}</h2>
      <p className="section-subtitle">{copy}</p>
    </article>
  );
}

function templateIcon(type: ExportRecord["type"]) {
  if (type === "verified_email_leads") return Mail;
  if (type === "sdr_assignments") return Users;
  if (type === "contacts") return Phone;
  return FileText;
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
