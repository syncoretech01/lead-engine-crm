import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  addWaterfallStepAction,
  moveWaterfallStepAction,
  removeWaterfallStepAction,
  updateWaterfallStepAction,
  updateWaterfallTemplateMetaAction
} from "@/lib/phase1/waterfall-template-service";
import { supportedProviders } from "@/lib/providers/registry";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { WaterfallCondition, WaterfallStep } from "@/lib/phase1/types";
import type { ProviderCapability } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const STAGES = [
  "source",
  "discover_contacts",
  "find_email",
  "find_phone",
  "enrich",
  "verify_email",
  "verify_phone",
  "suppression_check"
] as const;

const CAPABILITIES: ProviderCapability[] = [
  "discover_companies",
  "discover_contacts",
  "find_email",
  "verify_email",
  "find_phone",
  "verify_phone",
  "enrich_company",
  "enrich_contact",
  "send_campaign",
  "process_webhook",
  "send_transactional_email"
];

export default async function WaterfallTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, workspaceId: scopedWorkspaceId } = await getWorkspaceSessionContext("manage_waterfalls");
  let workspaceId = scopedWorkspaceId;
  let state = await readFastLeadDashboardState(session, workspaceId);
  if (!state) {
    const context = await getWorkspaceContext("manage_waterfalls");
    state = context.state;
    workspaceId = context.workspaceId;
  }
  const template = state.waterfallTemplates.find((item) => item.id === id && item.workspaceId === workspaceId);
  if (!template) {
    notFound();
  }

  const orderedSteps = [...template.steps].sort((a, b) => a.order - b.order);
  const providersFor = (capability: ProviderCapability) =>
    supportedProviders()
      .filter((provider) => provider.capabilities.includes(capability))
      .map((provider) => provider.id);

  return (
    <>
      <PageHeader
        kicker="Provider waterfalls"
        title={template.name}
        copy={`${labelize(template.campaignType)} · ${template.outreachChannel} · stop on ${template.requiredFields.join(", ") || "completeness"}`}
      />
      <p className="surface-note">
        <Link href="/waterfalls">← Back to templates</Link>
      </p>

      {template.isDefault ? (
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Read-only default</h2>
              <p className="section-subtitle">Default templates can&apos;t be edited. Clone it from the templates list to customize the order, providers, and budgets.</p>
            </div>
            <StatusPill label="Default" tone="info" />
          </div>
          <ReadOnlySteps steps={orderedSteps} />
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Template settings</h2>
                <p className="section-subtitle">Name, budget caps, and the high-value score threshold for premium-only steps.</p>
              </div>
              <StatusPill label={template.status} tone="info" />
            </div>
            <form action={updateWaterfallTemplateMetaAction} className="panel-body form-grid">
              <input name="templateId" type="hidden" value={template.id} />
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" defaultValue={template.name} />
              </div>
              <div className="field">
                <label htmlFor="maxCostPerLeadCents">Max cost / lead (cents)</label>
                <input id="maxCostPerLeadCents" name="maxCostPerLeadCents" type="number" min="0" defaultValue={template.maxCostPerLeadCents ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="maxCostPerCampaignCents">Max cost / campaign (cents)</label>
                <input id="maxCostPerCampaignCents" name="maxCostPerCampaignCents" type="number" min="0" defaultValue={template.maxCostPerCampaignCents ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="highValueScoreThreshold">High-value score threshold</label>
                <input id="highValueScoreThreshold" name="highValueScoreThreshold" type="number" min="0" defaultValue={template.highValueScoreThreshold ?? ""} />
              </div>
              <div className="field">
                <label aria-hidden="true">&nbsp;</label>
                <button className="button primary" type="submit">
                  <Save size={16} aria-hidden="true" />
                  Save settings
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Steps</h2>
                <p className="section-subtitle">Order is the waterfall priority. Provider IDs are tried in order; leave blank for any enabled provider with the capability. Run/stop conditions and quality gates are inherited from the clone source.</p>
              </div>
            </div>
            <div className="panel-body" style={{ display: "grid", gap: "14px" }}>
              {orderedSteps.map((step, index) => (
                <article className="item-card" key={step.id}>
                  <div className="item-card-header">
                    <div className="entity">
                      <strong>Step {step.order} · {labelize(step.stage)}</strong>
                      <span>Eligible providers for {labelize(step.capability)}: {providersFor(step.capability).join(", ") || "none configured"}</span>
                      {describeStepConditions(step) ? <span className="field-note">{describeStepConditions(step)}</span> : null}
                    </div>
                    <div className="item-card-actions">
                      <MoveButton templateId={template.id} stepId={step.id} direction="up" disabled={index === 0} />
                      <MoveButton templateId={template.id} stepId={step.id} direction="down" disabled={index === orderedSteps.length - 1} />
                      <form action={removeWaterfallStepAction}>
                        <input name="templateId" type="hidden" value={template.id} />
                        <input name="stepId" type="hidden" value={step.id} />
                        <button className="button subtle" type="submit" aria-label="Remove step">
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </form>
                    </div>
                  </div>
                  <form action={updateWaterfallStepAction} className="form-grid">
                    <input name="templateId" type="hidden" value={template.id} />
                    <input name="stepId" type="hidden" value={step.id} />
                    <div className="field">
                      <label>Stage</label>
                      <select name="stage" defaultValue={step.stage}>
                        {STAGES.map((stage) => (
                          <option key={stage} value={stage}>{labelize(stage)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Capability</label>
                      <select name="capability" defaultValue={step.capability}>
                        {CAPABILITIES.map((capability) => (
                          <option key={capability} value={capability}>{labelize(capability)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Provider IDs (ranked, comma-separated)</label>
                      <input name="providerIds" defaultValue={step.providerIds.join(", ")} placeholder="leadmagic, prospeo, …" />
                    </div>
                    <div className="field">
                      <label>Step cost cap (cents)</label>
                      <input name="costCapCents" type="number" min="0" defaultValue={step.costCapCents ?? ""} />
                    </div>
                    <div className="field integration-options">
                      <label>Flags</label>
                      <label className="pill">
                        <input name="highValueOnly" type="checkbox" defaultChecked={step.highValueOnly ?? false} />
                        High-value only
                      </label>
                      <label className="pill">
                        <input name="allowCompanyMainPhone" type="checkbox" defaultChecked={step.allowCompanyMainPhone ?? false} />
                        Allow company-main phone
                      </label>
                    </div>
                    <div className="field">
                      <label aria-hidden="true">&nbsp;</label>
                      <button className="button secondary" type="submit">
                        <Save size={15} aria-hidden="true" />
                        Save step
                      </button>
                    </div>
                  </form>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Add step</h2>
                <p className="section-subtitle">Appends a step at the end; reorder it with the arrows.</p>
              </div>
            </div>
            <form action={addWaterfallStepAction} className="panel-body form-grid">
              <input name="templateId" type="hidden" value={template.id} />
              <div className="field">
                <label htmlFor="add-stage">Stage</label>
                <select id="add-stage" name="stage" defaultValue="find_email">
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>{labelize(stage)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="add-capability">Capability</label>
                <select id="add-capability" name="capability" defaultValue="find_email">
                  {CAPABILITIES.map((capability) => (
                    <option key={capability} value={capability}>{labelize(capability)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="add-providers">Provider IDs</label>
                <input id="add-providers" name="providerIds" placeholder="leadmagic, prospeo" />
              </div>
              <div className="field">
                <label aria-hidden="true">&nbsp;</label>
                <button className="button primary" type="submit">
                  <Plus size={16} aria-hidden="true" />
                  Add step
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  );
}

function MoveButton({ templateId, stepId, direction, disabled }: { templateId: string; stepId: string; direction: "up" | "down"; disabled: boolean }) {
  return (
    <form action={moveWaterfallStepAction}>
      <input name="templateId" type="hidden" value={templateId} />
      <input name="stepId" type="hidden" value={stepId} />
      <input name="direction" type="hidden" value={direction} />
      <button className="button subtle" type="submit" disabled={disabled} aria-label={`Move ${direction}`}>
        {direction === "up" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
      </button>
    </form>
  );
}

function ReadOnlySteps({ steps }: { steps: WaterfallStep[] }) {
  return (
    <ol className="waterfall-steps">
      {steps.map((step) => (
        <li key={step.id}>
          <span className="pill">{step.order}</span>
          <div className="entity">
            <strong>{labelize(step.stage)}{step.highValueOnly ? " · high-value only" : ""}</strong>
            <span>{step.providerIds.length ? step.providerIds.join(" → ") : "any enabled provider"}</span>
            {describeStepConditions(step) ? <span className="field-note">{describeStepConditions(step)}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function describeStepConditions(step: WaterfallStep): string {
  const parts: string[] = [];
  if (step.runIf) parts.push(`run if ${describeCondition(step.runIf)}`);
  if (step.stopIf) parts.push(`stop if ${describeCondition(step.stopIf)}`);
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
