import Link from "next/link";
import { Copy, Layers, ListOrdered, Pencil, Workflow } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { StatCard } from "@/components/ui-metrics";
import {
  cloneWaterfallTemplateAction,
  restoreDefaultWaterfallTemplatesAction,
  setWaterfallTemplateStatusAction
} from "@/lib/phase1/waterfall-template-service";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { waterfallTemplatesForWorkspace } from "@/lib/phase1/waterfall-templates";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { WaterfallCondition, WaterfallStep, WaterfallTemplate } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function WaterfallsPage() {
  const { session, workspaceId: scopedWorkspaceId } = await getWorkspaceSessionContext("manage_waterfalls");
  let workspaceId = scopedWorkspaceId;
  let state = await readFastLeadDashboardState(session, workspaceId);
  if (!state) {
    const context = await getWorkspaceContext("manage_waterfalls");
    state = context.state;
    workspaceId = context.workspaceId;
  }
  const templates = waterfallTemplatesForWorkspace(state, workspaceId);
  const active = templates.filter((template) => template.status === "Active").length;
  const custom = templates.filter((template) => !template.isDefault).length;

  const stats = [
    { label: "Templates", value: formatNumber(templates.length), note: "Campaign-specific provider waterfalls.", icon: Workflow, tone: "info" as const },
    { label: "Active", value: formatNumber(active), note: "Selectable on a campaign / lead job.", icon: Layers, tone: active ? ("success" as const) : ("warning" as const) },
    { label: "Custom", value: formatNumber(custom), note: "Cloned and edited from a default.", icon: Copy, tone: "info" as const }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead engine"
        title="Provider Waterfalls"
        copy="Campaign-specific provider order for sourcing, email, phone, enrichment, and verification. Global provider settings stay the defaults and limits; a template defines the order, conditions, quality gates, and budgets for a campaign type. Mock-first — no live provider calls."
      />

      <section className="stat-grid" aria-label="Waterfall metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Templates</h2>
            <p className="section-subtitle">Clone a default to customize it, then activate it for use on a campaign.</p>
          </div>
          <form action={restoreDefaultWaterfallTemplatesAction}>
            <button className="button subtle" type="submit">
              <ListOrdered size={16} aria-hidden="true" />
              Restore missing defaults
            </button>
          </form>
        </div>

        <div className="grid two">
          {templates.map((template) => (
            <WaterfallTemplateCard key={template.id} template={template} />
          ))}
          {templates.length === 0 ? (
            <div className="empty-state">
              <Workflow size={24} aria-hidden="true" />
              <span>No waterfall templates yet. Restore the defaults to get started.</span>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function WaterfallTemplateCard({ template }: { template: WaterfallTemplate }) {
  return (
    <article className="item-card">
      <div className="item-card-header">
        <div className="entity">
          <strong>{template.name}</strong>
          <span>{labelize(template.campaignType)}</span>
        </div>
        <div className="chip-row">
          <StatusPill label={template.status} tone={statusTone(template.status)} />
          {template.isDefault ? <StatusPill label="Default" tone="info" /> : <StatusPill label="Custom" tone="default" />}
        </div>
      </div>

      <div className="chip-row">
        <span className="pill">Channel: {template.outreachChannel}</span>
        {template.country ? <span className="pill">Country: {template.country}</span> : null}
        {template.maxCostPerLeadCents != null ? <span className="pill">Max ${(template.maxCostPerLeadCents / 100).toFixed(2)}/lead</span> : null}
        {template.requiredFields.map((field) => (
          <span className="pill" key={field}>
            Stop: {field}
          </span>
        ))}
      </div>

      <ol className="waterfall-steps">
        {[...template.steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <li key={step.id}>
              <span className="pill">{step.order}</span>
              <div className="entity">
                <strong>
                  {labelize(step.stage)}
                  {step.highValueOnly ? " · high-value only" : ""}
                </strong>
                <span>{step.providerIds.length ? step.providerIds.join(" → ") : "any enabled provider"}</span>
                {describeStep(step) ? <span className="field-note">{describeStep(step)}</span> : null}
              </div>
            </li>
          ))}
      </ol>

      <div className="item-card-actions">
        <Link className="button subtle" href={`/waterfalls/${template.id}`}>
          <Pencil size={16} aria-hidden="true" />
          {template.isDefault ? "View" : "Edit"}
        </Link>
        <form action={cloneWaterfallTemplateAction} className="inline-form">
          <input name="templateId" type="hidden" value={template.id} />
          <input name="name" placeholder={`${template.name} (copy)`} aria-label="Clone name" />
          <button className="button secondary" type="submit">
            <Copy size={16} aria-hidden="true" />
            Clone
          </button>
        </form>
        {template.status !== "Active" ? (
          <form action={setWaterfallTemplateStatusAction}>
            <input name="templateId" type="hidden" value={template.id} />
            <input name="status" type="hidden" value="Active" />
            <button className="button primary" type="submit">
              Activate
            </button>
          </form>
        ) : null}
        {!template.isDefault && template.status !== "Archived" ? (
          <form action={setWaterfallTemplateStatusAction}>
            <input name="templateId" type="hidden" value={template.id} />
            <input name="status" type="hidden" value="Archived" />
            <button className="button subtle" type="submit">
              Archive
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function describeStep(step: WaterfallStep): string {
  const parts: string[] = [];
  if (step.runIf) parts.push(`run if ${describeCondition(step.runIf)}`);
  if (step.stopIf) parts.push(`stop if ${describeCondition(step.stopIf)}`);
  const gate = step.qualityGate;
  if (gate) {
    const gates: string[] = [];
    if (gate.minConfidence != null) gates.push(`conf ≥ ${gate.minConfidence}`);
    if (gate.acceptStatus) gates.push(`accept ${gate.acceptStatus.join("/")}`);
    if (gate.phoneTypeIn) gates.push(`phone ${gate.phoneTypeIn.join("/")}`);
    if (gate.allowCompanyMain) gates.push("company-main ok");
    if (gate.rejectVoipForSms) gates.push("no SMS to VoIP");
    if (gates.length) parts.push(`gate: ${gates.join(", ")}`);
  }
  return parts.join(" · ");
}

function describeCondition(condition: WaterfallCondition): string {
  if ("all" in condition) return condition.all.map(describeCondition).join(" and ");
  if ("any" in condition) return condition.any.map(describeCondition).join(" or ");
  if ("not" in condition) return `not (${describeCondition(condition.not)})`;
  const field = condition.field;
  switch (condition.op) {
    case "exists":
      return `${field} exists`;
    case "isMissing":
      return `${field} missing`;
    case "equals":
      return `${field} = ${condition.value}`;
    case "notEquals":
      return `${field} ≠ ${condition.value}`;
    case "in":
      return `${field} in [${condition.value.join(", ")}]`;
    case "notIn":
      return `${field} not in [${condition.value.join(", ")}]`;
    case "gte":
      return `${field} ≥ ${condition.value}`;
    case "lte":
      return `${field} ≤ ${condition.value}`;
    default:
      return field;
  }
}

function labelize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
