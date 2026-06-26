"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/phase1/auth";
import { waterfallTemplateWriteTables } from "@/lib/phase1/normalized-write-tables";
import { appendAudit, updateState } from "@/lib/phase1/store";
import { defaultWaterfallTemplates, normalizeStepOrders, reorderTemplateStep } from "@/lib/phase1/waterfall-templates";
import type { AppState, Session, WaterfallStage, WaterfallStep, WaterfallTemplate } from "@/lib/phase1/types";
import type { ProviderCapability } from "@/lib/providers/types";

const waterfallStages: WaterfallStage[] = [
  "source",
  "discover_contacts",
  "find_email",
  "find_phone",
  "enrich",
  "verify_email",
  "verify_phone",
  "suppression_check"
];

const providerCapabilities: ProviderCapability[] = [
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

/** Find a workspace template that the caller may edit (defaults are read-only). */
function findEditableTemplate(state: AppState, session: Session, templateId: string): WaterfallTemplate {
  assertPermission(session, "manage_waterfalls");
  const template = state.waterfallTemplates.find(
    (item) => item.id === templateId && item.workspaceId === session.workspace.id
  );
  if (!template) {
    throw new Error("Waterfall template not found.");
  }
  if (template.isDefault) {
    throw new Error("Default templates are read-only. Clone it first to edit.");
  }
  return template;
}

function optionalInt(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function parseProviderIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asStage(value: FormDataEntryValue | null): WaterfallStage {
  const stage = typeof value === "string" ? value : "";
  if (!waterfallStages.includes(stage as WaterfallStage)) {
    throw new Error(`Invalid stage "${stage}".`);
  }
  return stage as WaterfallStage;
}

function asCapability(value: FormDataEntryValue | null): ProviderCapability {
  const capability = typeof value === "string" ? value : "";
  if (!providerCapabilities.includes(capability as ProviderCapability)) {
    throw new Error(`Invalid capability "${capability}".`);
  }
  return capability as ProviderCapability;
}

function requireString(value: FormDataEntryValue | null, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

/** Clone a template into an editable, draft, non-default workspace copy. */
export async function cloneWaterfallTemplateAction(formData: FormData) {
  const sourceId = requireString(formData.get("templateId"), "templateId");
  const requestedName = typeof formData.get("name") === "string" ? String(formData.get("name")).trim() : "";

  await updateState((state, session) => {
    assertPermission(session, "manage_waterfalls");
    const source = state.waterfallTemplates.find(
      (template) => template.id === sourceId && template.workspaceId === session.workspace.id
    );
    if (!source) {
      throw new Error("Waterfall template not found.");
    }

    const now = new Date().toISOString();
    const id = `wf-${session.workspace.id}-${randomUUID()}`;
    const clone: WaterfallTemplate = {
      ...source,
      id,
      name: requestedName || `${source.name} (copy)`,
      isDefault: false,
      status: "Draft",
      steps: source.steps.map((step) => ({ ...step, id: `${id}-s${step.order}` })),
      createdById: session.user.id,
      createdAt: now,
      updatedAt: now
    };

    state.waterfallTemplates.unshift(clone);
    appendAudit(state, session, {
      objectType: "waterfall_template",
      objectId: id,
      action: "cloned",
      newValue: { from: sourceId, name: clone.name, campaignType: clone.campaignType }
    });
  }, { normalizedTables: waterfallTemplateWriteTables });

  revalidatePath("/waterfalls");
}

/** Activate / archive / draft a template. Default templates cannot be archived. */
export async function setWaterfallTemplateStatusAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  const status = requireString(formData.get("status"), "status");
  if (status !== "Active" && status !== "Draft" && status !== "Archived") {
    throw new Error("Invalid template status.");
  }

  await updateState((state, session) => {
    assertPermission(session, "manage_waterfalls");
    const template = state.waterfallTemplates.find(
      (item) => item.id === templateId && item.workspaceId === session.workspace.id
    );
    if (!template) {
      throw new Error("Waterfall template not found.");
    }
    if (template.isDefault && status === "Archived") {
      throw new Error("Default templates cannot be archived. Clone it to customize instead.");
    }

    const previous = template.status;
    template.status = status;
    template.updatedAt = new Date().toISOString();
    appendAudit(state, session, {
      objectType: "waterfall_template",
      objectId: template.id,
      action: "status_changed",
      oldValue: { status: previous },
      newValue: { status }
    });
  }, { normalizedTables: waterfallTemplateWriteTables });

  revalidatePath("/waterfalls");
}

/** Re-seed any missing default templates (idempotent; never overwrites edits). */
export async function restoreDefaultWaterfallTemplatesAction() {
  await updateState((state, session) => {
    assertPermission(session, "manage_waterfalls");
    const now = new Date().toISOString();
    const existingDefaultTypes = new Set(
      state.waterfallTemplates
        .filter((template) => template.workspaceId === session.workspace.id && template.isDefault)
        .map((template) => template.campaignType)
    );
    let restored = 0;
    for (const template of defaultWaterfallTemplates(session.workspace.id, now)) {
      if (!existingDefaultTypes.has(template.campaignType)) {
        state.waterfallTemplates.push(template);
        restored += 1;
      }
    }
    if (restored > 0) {
      appendAudit(state, session, {
        objectType: "waterfall_template",
        objectId: session.workspace.id,
        action: "defaults_restored",
        newValue: { restored }
      });
    }
  }, { normalizedTables: waterfallTemplateWriteTables });

  revalidatePath("/waterfalls");
}

/** Edit a custom template's name, budget caps, and high-value threshold. */
export async function updateWaterfallTemplateMetaAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  await updateState((state, session) => {
    const template = findEditableTemplate(state, session, templateId);
    const name = typeof formData.get("name") === "string" ? String(formData.get("name")).trim() : "";
    if (name) template.name = name;
    template.maxCostPerLeadCents = optionalInt(formData.get("maxCostPerLeadCents"));
    template.maxCostPerCampaignCents = optionalInt(formData.get("maxCostPerCampaignCents"));
    template.highValueScoreThreshold = optionalInt(formData.get("highValueScoreThreshold"));
    template.updatedAt = new Date().toISOString();
    appendAudit(state, session, { objectType: "waterfall_template", objectId: template.id, action: "meta_updated" });
  }, { normalizedTables: waterfallTemplateWriteTables });
  revalidatePath(`/waterfalls/${templateId}`);
  revalidatePath("/waterfalls");
}

export async function addWaterfallStepAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  await updateState((state, session) => {
    const template = findEditableTemplate(state, session, templateId);
    const stage = asStage(formData.get("stage"));
    const capability = asCapability(formData.get("capability"));
    const nextOrder = template.steps.reduce((max, step) => Math.max(max, step.order), 0) + 1;
    const newStep: WaterfallStep = {
      id: `${template.id}-s${randomUUID()}`,
      order: nextOrder,
      stage,
      capability,
      providerIds: parseProviderIds(formData.get("providerIds"))
    };
    template.steps = normalizeStepOrders([...template.steps, newStep]);
    template.updatedAt = new Date().toISOString();
    appendAudit(state, session, { objectType: "waterfall_template", objectId: template.id, action: "step_added", newValue: { stage, capability } });
  }, { normalizedTables: waterfallTemplateWriteTables });
  revalidatePath(`/waterfalls/${templateId}`);
}

export async function updateWaterfallStepAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  const stepId = requireString(formData.get("stepId"), "stepId");
  await updateState((state, session) => {
    const template = findEditableTemplate(state, session, templateId);
    const step = template.steps.find((item) => item.id === stepId);
    if (!step) throw new Error("Waterfall step not found.");
    step.stage = asStage(formData.get("stage"));
    step.capability = asCapability(formData.get("capability"));
    step.providerIds = parseProviderIds(formData.get("providerIds"));
    step.costCapCents = optionalInt(formData.get("costCapCents"));
    step.highValueOnly = formData.get("highValueOnly") != null;
    step.allowCompanyMainPhone = formData.get("allowCompanyMainPhone") != null;
    template.updatedAt = new Date().toISOString();
    appendAudit(state, session, { objectType: "waterfall_template", objectId: template.id, action: "step_updated", newValue: { stepId } });
  }, { normalizedTables: waterfallTemplateWriteTables });
  revalidatePath(`/waterfalls/${templateId}`);
}

export async function removeWaterfallStepAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  const stepId = requireString(formData.get("stepId"), "stepId");
  await updateState((state, session) => {
    const template = findEditableTemplate(state, session, templateId);
    template.steps = normalizeStepOrders(template.steps.filter((item) => item.id !== stepId));
    template.updatedAt = new Date().toISOString();
    appendAudit(state, session, { objectType: "waterfall_template", objectId: template.id, action: "step_removed", newValue: { stepId } });
  }, { normalizedTables: waterfallTemplateWriteTables });
  revalidatePath(`/waterfalls/${templateId}`);
}

export async function moveWaterfallStepAction(formData: FormData) {
  const templateId = requireString(formData.get("templateId"), "templateId");
  const stepId = requireString(formData.get("stepId"), "stepId");
  const direction = formData.get("direction") === "down" ? "down" : "up";
  await updateState((state, session) => {
    const template = findEditableTemplate(state, session, templateId);
    template.steps = reorderTemplateStep(template.steps, stepId, direction);
    template.updatedAt = new Date().toISOString();
  }, { normalizedTables: waterfallTemplateWriteTables });
  revalidatePath(`/waterfalls/${templateId}`);
}
