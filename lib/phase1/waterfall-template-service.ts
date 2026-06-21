"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/phase1/auth";
import { appendAudit, updateState } from "@/lib/phase1/store";
import { defaultWaterfallTemplates } from "@/lib/phase1/waterfall-templates";
import type { WaterfallTemplate } from "@/lib/phase1/types";

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
  });

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
  });

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
  });

  revalidatePath("/waterfalls");
}
