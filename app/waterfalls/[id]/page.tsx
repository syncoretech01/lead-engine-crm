import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { fieldClass, fieldLabelClass } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
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
        copy={`${labelize(template.campaignType)} - ${template.outreachChannel} - stop on ${template.requiredFields.join(", ") || "completeness"}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/waterfalls">Back to templates</Link>
          </Button>
        }
      />

      {template.isDefault ? (
        <section>
          <Panel
            title="Read-only default"
            subtitle="Default templates can't be edited. Clone it from the templates list to customize the order, providers, and budgets."
            action={<StatusBadge label="Default" tone="info" />}
          >
            <ReadOnlySteps steps={orderedSteps} />
          </Panel>
        </section>
      ) : (
        <>
          <section>
            <Panel
              title="Template settings"
              subtitle="Name, budget caps, and the high-value score threshold for premium-only steps."
              action={<StatusBadge label={template.status} tone="info" />}
            >
              <form action={updateWaterfallTemplateMetaAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <input name="templateId" type="hidden" value={template.id} />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="name" className={fieldLabelClass}>Name</label>
                  <input id="name" name="name" defaultValue={template.name} className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="maxCostPerLeadCents" className={fieldLabelClass}>Max cost / lead (cents)</label>
                  <input id="maxCostPerLeadCents" name="maxCostPerLeadCents" type="number" min="0" defaultValue={template.maxCostPerLeadCents ?? ""} className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="maxCostPerCampaignCents" className={fieldLabelClass}>Max cost / campaign (cents)</label>
                  <input id="maxCostPerCampaignCents" name="maxCostPerCampaignCents" type="number" min="0" defaultValue={template.maxCostPerCampaignCents ?? ""} className={fieldClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="highValueScoreThreshold" className={fieldLabelClass}>High-value score threshold</label>
                  <input id="highValueScoreThreshold" name="highValueScoreThreshold" type="number" min="0" defaultValue={template.highValueScoreThreshold ?? ""} className={fieldClass} />
                </div>
                <div className="flex flex-col justify-end gap-1.5">
                  <label aria-hidden="true" className={fieldLabelClass}>&nbsp;</label>
                  <Button type="submit">
                    <Save size={16} aria-hidden="true" />
                    Save settings
                  </Button>
                </div>
              </form>
            </Panel>
          </section>

          <section>
            <Panel
              title="Steps"
              subtitle="Order is the waterfall priority. Provider IDs are tried in order; leave blank for any enabled provider with the capability. Run/stop conditions and quality gates are inherited from the clone source."
            >
              <div className="grid gap-4">
                {orderedSteps.map((step, index) => (
                  <article className="rounded-xl border bg-[var(--bg-surface)] p-4" key={step.id}>
                    <div className="flex items-start justify-between gap-3 border-b pb-4">
                      <div className="min-w-0">
                        <strong className="text-sm font-semibold text-foreground">Step {step.order} - {labelize(step.stage)}</strong>
                        <span className="mt-0.5 block text-xs text-muted-foreground">Eligible providers for {labelize(step.capability)}: {providersFor(step.capability).join(", ") || "none configured"}</span>
                        {describeStepConditions(step) ? <span className="mt-0.5 block text-xs text-muted-foreground">{describeStepConditions(step)}</span> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <MoveButton templateId={template.id} stepId={step.id} direction="up" disabled={index === 0} />
                        <MoveButton templateId={template.id} stepId={step.id} direction="down" disabled={index === orderedSteps.length - 1} />
                        <form action={removeWaterfallStepAction}>
                          <input name="templateId" type="hidden" value={template.id} />
                          <input name="stepId" type="hidden" value={step.id} />
                          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Remove step">
                            <Trash2 size={15} aria-hidden="true" />
                          </Button>
                        </form>
                      </div>
                    </div>
                    <form action={updateWaterfallStepAction} className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
                      <input name="templateId" type="hidden" value={template.id} />
                      <input name="stepId" type="hidden" value={step.id} />
                      <div className="flex flex-col gap-1.5">
                        <label className={fieldLabelClass}>Stage</label>
                        <select name="stage" defaultValue={step.stage} className={fieldClass}>
                          {STAGES.map((stage) => (
                            <option key={stage} value={stage}>{labelize(stage)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={fieldLabelClass}>Capability</label>
                        <select name="capability" defaultValue={step.capability} className={fieldClass}>
                          {CAPABILITIES.map((capability) => (
                            <option key={capability} value={capability}>{labelize(capability)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={fieldLabelClass}>Provider IDs (ranked, comma-separated)</label>
                        <input name="providerIds" defaultValue={step.providerIds.join(", ")} placeholder="leadmagic, prospeo, lusha" className={fieldClass} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={fieldLabelClass}>Step cost cap (cents)</label>
                        <input name="costCapCents" type="number" min="0" defaultValue={step.costCapCents ?? ""} className={fieldClass} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={fieldLabelClass}>Flags</label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input name="highValueOnly" type="checkbox" defaultChecked={step.highValueOnly ?? false} />
                          High-value only
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input name="allowCompanyMainPhone" type="checkbox" defaultChecked={step.allowCompanyMainPhone ?? false} />
                          Allow company-main phone
                        </label>
                      </div>
                      <div className="flex flex-col justify-end gap-1.5">
                        <label aria-hidden="true" className={fieldLabelClass}>&nbsp;</label>
                        <Button type="submit" variant="outline">
                          <Save size={15} aria-hidden="true" />
                          Save step
                        </Button>
                      </div>
                    </form>
                  </article>
                ))}
              </div>
            </Panel>
          </section>

          <section>
            <Panel
              title="Add step"
              subtitle="Appends a step at the end; reorder it with the arrows."
            >
              <form action={addWaterfallStepAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <input name="templateId" type="hidden" value={template.id} />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-stage" className={fieldLabelClass}>Stage</label>
                  <select id="add-stage" name="stage" defaultValue="find_email" className={fieldClass}>
                    {STAGES.map((stage) => (
                      <option key={stage} value={stage}>{labelize(stage)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-capability" className={fieldLabelClass}>Capability</label>
                  <select id="add-capability" name="capability" defaultValue="find_email" className={fieldClass}>
                    {CAPABILITIES.map((capability) => (
                      <option key={capability} value={capability}>{labelize(capability)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-providers" className={fieldLabelClass}>Provider IDs</label>
                  <input id="add-providers" name="providerIds" placeholder="leadmagic, prospeo" className={fieldClass} />
                </div>
                <div className="flex flex-col justify-end gap-1.5">
                  <label aria-hidden="true" className={fieldLabelClass}>&nbsp;</label>
                  <Button type="submit">
                    <Plus size={16} aria-hidden="true" />
                    Add step
                  </Button>
                </div>
              </form>
            </Panel>
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
      <Button type="submit" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Move ${direction}`}>
        {direction === "up" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
      </Button>
    </form>
  );
}

function ReadOnlySteps({ steps }: { steps: WaterfallStep[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-3">
          <StatusBadge label={String(step.order)} tone="default" />
          <div className="min-w-0">
            <strong className="text-sm font-semibold text-foreground">{labelize(step.stage)}{step.highValueOnly ? " - high-value only" : ""}</strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">{step.providerIds.length ? step.providerIds.join(" -> ") : "any enabled provider"}</span>
            {describeStepConditions(step) ? <span className="mt-0.5 block text-xs text-muted-foreground">{describeStepConditions(step)}</span> : null}
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
  return parts.join(" - ");
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
      return `${field} != ${condition.value}`;
    case "in":
      return `${field} in [${condition.value.join(", ")}]`;
    case "notIn":
      return `${field} not in [${condition.value.join(", ")}]`;
    case "gte":
      return `${field} >= ${condition.value}`;
    case "lte":
      return `${field} <= ${condition.value}`;
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
