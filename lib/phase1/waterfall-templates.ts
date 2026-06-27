import type { WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type {
  AppState,
  Contact,
  WaterfallOverride,
  WaterfallStep,
  WaterfallTemplate
} from "@/lib/phase1/types";
import { providerRegistry } from "@/lib/providers/registry";

/**
 * Merge a lead-job's inline override onto its selected template at run time
 * (see docs/CAMPAIGN_WATERFALLS.md §5). `steps` fully replaces the template's
 * steps when provided; scalar caps override individually.
 */
export function mergeWaterfallOverride(template: WaterfallTemplate, override?: WaterfallOverride): WaterfallTemplate {
  if (!override) return template;
  return {
    ...template,
    steps: override.steps ?? template.steps,
    maxCostPerLeadCents: override.maxCostPerLeadCents ?? template.maxCostPerLeadCents,
    maxCostPerCampaignCents: override.maxCostPerCampaignCents ?? template.maxCostPerCampaignCents,
    highValueScoreThreshold: override.highValueScoreThreshold ?? template.highValueScoreThreshold
  };
}

/** Derive the engine's lead state from a contact and its field-source provenance. */
export function buildContactLeadState(state: AppState, contact: Contact): WaterfallLeadState {
  const company = state.companies.find((item) => item.id === contact.companyId);
  const sourcesFor = (field: string) =>
    state.fieldSources
      .filter((source) => source.targetType === "contact" && source.targetId === contact.id && source.field === field)
      .sort((a, b) => Date.parse(b.enrichmentDate) - Date.parse(a.enrichmentDate))[0];
  const emailSource = sourcesFor("email");
  const phoneSource = sourcesFor("phone");

  return {
    fullName: contact.name || undefined,
    companyName: company?.name || undefined,
    email: contact.email || undefined,
    emailValidationStatus: emailSource?.validationStatus,
    phone: contact.phone || undefined,
    phoneType: phoneSource?.phoneType,
    phoneValidationStatus: phoneSource?.validationStatus,
    domain: company?.domain || undefined,
    country: company?.country || undefined,
    leadScore: contact.score,
    isHighValue: contact.priority === "P1",
    companyId: contact.companyId
  };
}

function steps(templateId: string, defs: Array<Omit<WaterfallStep, "id">>): WaterfallStep[] {
  return defs.map((def) => ({ id: `${templateId}-s${def.order}`, ...def }));
}

/** The seeded, editable default templates (the 6 priority campaign types). */
export function defaultWaterfallTemplates(workspaceId: string, now = new Date().toISOString()): WaterfallTemplate[] {
  const base = (
    id: string,
    name: string,
    campaignType: WaterfallTemplate["campaignType"],
    outreachChannel: WaterfallTemplate["outreachChannel"],
    requiredFields: string[],
    stepDefs: Array<Omit<WaterfallStep, "id">>,
    extra: Partial<WaterfallTemplate> = {}
  ): WaterfallTemplate => ({
    id: `wf-${workspaceId}-${id}`,
    workspaceId,
    name,
    campaignType,
    status: "Active",
    isDefault: true,
    outreachChannel,
    requiredFields,
    steps: steps(`wf-${workspaceId}-${id}`, stepDefs),
    createdAt: now,
    updatedAt: now,
    ...extra
  });

  const phoneMissing = { field: "phone", op: "isMissing" as const };
  const emailMissing = { field: "email", op: "isMissing" as const };
  const validPhone = { field: "phone.validationStatus", op: "in" as const, value: ["valid"] };
  const validEmail = { field: "email.validationStatus", op: "in" as const, value: ["valid"] };

  return [
    base(
      "hunter-phone-only",
      "Existing Hunter - Phone Only",
      "hunter_phone_only",
      "phone",
      ["phone:validated"],
      [
        { order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["lusha", "apollo"], runIf: phoneMissing },
        { order: 2, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], runIf: { all: [phoneMissing, { field: "linkedinUrl", op: "exists" }] } },
        { order: 3, stage: "find_phone", capability: "find_phone", providerIds: ["apollo"], runIf: phoneMissing },
        { order: 4, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"], rejectVoipForSms: true, minConfidence: 70 }, stopIf: validPhone }
      ],
      { maxCostPerLeadCents: 80, highValueScoreThreshold: 80 }
    ),
    base(
      "local-business",
      "Local Business - Google Maps First",
      "local_business",
      "both",
      ["company.phone:validated"],
      [
        { order: 1, stage: "source", capability: "discover_companies", providerIds: ["google_places", "apify"] },
        { order: 2, stage: "enrich", capability: "enrich_company", providerIds: ["people_data_labs", "website_scrape"], runIf: { field: "domain", op: "exists" } },
        { order: 3, stage: "find_email", capability: "find_email", providerIds: ["hunter", "lusha", "website_scrape"], runIf: emailMissing },
        { order: 4, stage: "discover_contacts", capability: "discover_contacts", providerIds: ["apollo", "apify"], optional: true },
        { order: 5, stage: "verify_email", capability: "verify_email", providerIds: ["zerobounce", "hunter"], qualityGate: { acceptStatus: ["valid", "catch_all"], allowCatchAll: true } },
        { order: 6, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { allowCompanyMain: true }, allowCompanyMainPhone: true, stopIf: { field: "company.phone.validationStatus", op: "in", value: ["valid"] } }
      ],
      { allowGenericEmail: true }
    ),
    base(
      "email-first-call-later",
      "Email First, Call Later",
      "email_first_call_later",
      "both",
      ["email:verified"],
      [
        { order: 1, stage: "find_email", capability: "find_email", providerIds: ["hunter", "apollo", "lusha"], runIf: emailMissing },
        { order: 2, stage: "find_email", capability: "find_email", providerIds: ["lusha"], runIf: { all: [emailMissing, { field: "linkedinUrl", op: "exists" }] } },
        { order: 3, stage: "verify_email", capability: "verify_email", providerIds: ["zerobounce", "hunter"], qualityGate: { acceptStatus: ["valid"], allowCatchAll: false, minConfidence: 80 }, stopIf: validEmail },
        { order: 4, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], runIf: { all: [phoneMissing, { any: [{ field: "engagement", op: "in", value: ["opened", "clicked", "replied", "booked"] }, { field: "leadScore", op: "gte", value: 70 }] }] } },
        { order: 5, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"], rejectVoipForSms: true }, stopIf: validPhone }
      ],
      { maxCostPerLeadCents: 60 }
    ),
    base(
      "phone-heavy-cold-calling",
      "US Phone-Heavy Cold Calling",
      "phone_heavy_cold_calling",
      "phone",
      ["phone:validated"],
      [
        { order: 1, stage: "suppression_check", capability: "verify_phone", providerIds: ["dnc"], runIf: { field: "country", op: "equals", value: "US" } },
        { order: 2, stage: "find_phone", capability: "find_phone", providerIds: ["lusha", "apollo"], runIf: phoneMissing },
        { order: 3, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"], allowCompanyMain: false, rejectVoipForSms: true, rejectStatus: ["invalid", "unknown", "risky"], minConfidence: 75 }, stopIf: validPhone }
      ],
      { country: "US", maxCostPerLeadCents: 120, highValueScoreThreshold: 75 }
    ),
    base(
      "linkedin-sales-navigator",
      "LinkedIn / Sales Navigator",
      "linkedin_sales_navigator",
      "both",
      ["email:verified"],
      [
        { order: 1, stage: "enrich", capability: "enrich_contact", providerIds: ["apify", "people_data_labs"], runIf: { field: "linkedinUrl", op: "exists" } },
        { order: 2, stage: "find_email", capability: "find_email", providerIds: ["hunter", "lusha"], runIf: emailMissing },
        { order: 3, stage: "verify_email", capability: "verify_email", providerIds: ["zerobounce", "hunter"], qualityGate: { acceptStatus: ["valid"], minConfidence: 80 }, stopIf: validEmail },
        { order: 4, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], runIf: phoneMissing },
        { order: 5, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"] } }
      ]
    ),
    base(
      "company-first-abm",
      "Company-First ABM",
      "company_first_abm",
      "both",
      ["contactsPerCompany:3"],
      [
        { order: 1, stage: "source", capability: "discover_companies", providerIds: ["apollo", "apify"] },
        { order: 2, stage: "enrich", capability: "enrich_company", providerIds: ["people_data_labs", "apollo", "website_scrape"], runIf: { field: "domain", op: "exists" } },
        { order: 3, stage: "discover_contacts", capability: "discover_contacts", providerIds: ["apollo", "apify"], stopIf: { field: "contactsFound", op: "gte", value: 3 } },
        { order: 4, stage: "verify_email", capability: "verify_email", providerIds: ["zerobounce", "hunter"], qualityGate: { acceptStatus: ["valid"] } },
        { order: 5, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { allowCompanyMain: true }, allowCompanyMainPhone: true }
      ],
      { personas: ["owner", "ceo", "general_manager", "operations_manager", "marketing_manager", "sales_manager", "procurement_manager"] }
    )
  ];
}

/** Renumber steps to a contiguous 1..n `order` after add/remove/reorder. */
export function normalizeStepOrders(steps: WaterfallStep[]): WaterfallStep[] {
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index + 1 }));
}

/** Move a step up or down one slot and renumber. Pure; returns a new array. */
export function reorderTemplateStep(steps: WaterfallStep[], stepId: string, direction: "up" | "down"): WaterfallStep[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((step) => step.id === stepId);
  if (index === -1) return normalizeStepOrders(steps);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return normalizeStepOrders(steps);
  [sorted[index], sorted[swapWith]] = [sorted[swapWith], sorted[index]];
  return sorted.map((step, position) => ({ ...step, order: position + 1 }));
}

/**
 * Remove provider ids that are no longer in the registry from every template's
 * steps. A step whose only providers were removed is dropped and the remaining
 * steps renumbered. Cleans up workspaces seeded before a provider was removed
 * (the refs were inert, but they shouldn't show in the UI). Idempotent.
 */
export function pruneWaterfallTemplateProviders(state: AppState) {
  if (!Array.isArray(state.waterfallTemplates)) {
    return { changed: false };
  }
  const validIds = new Set<string>(providerRegistry.map((provider) => provider.id));
  let changed = false;

  for (const template of state.waterfallTemplates) {
    const keptSteps: WaterfallStep[] = [];
    for (const step of template.steps) {
      const filtered = step.providerIds.filter((id) => validIds.has(id));
      if (step.providerIds.length > 0 && filtered.length === 0) {
        changed = true;
        continue;
      }
      if (filtered.length !== step.providerIds.length) {
        changed = true;
        keptSteps.push({ ...step, providerIds: filtered });
      } else {
        keptSteps.push(step);
      }
    }
    template.steps = keptSteps.length === template.steps.length ? keptSteps : normalizeStepOrders(keptSteps);
  }

  return { changed };
}

export function waterfallTemplatesForWorkspace(state: AppState, workspaceId: string): WaterfallTemplate[] {
  return state.waterfallTemplates
    .filter((template) => template.workspaceId === workspaceId)
    .sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1));
}

/** Seed default templates for a workspace if it has none yet. */
export function ensureWaterfallDefaults(state: AppState, workspaceId: string, now = new Date().toISOString()) {
  if (!Array.isArray(state.waterfallTemplates)) {
    state.waterfallTemplates = [];
  }
  let changed = false;
  const seededTemplates = defaultWaterfallTemplates(workspaceId, now);
  const defaultsByType = new Map(
    state.waterfallTemplates
      .filter((template) => template.workspaceId === workspaceId && template.isDefault)
      .map((template) => [template.campaignType, template])
  );

  for (const seeded of seededTemplates) {
    const existing = defaultsByType.get(seeded.campaignType);
    if (!existing) {
      state.waterfallTemplates.push(seeded);
      changed = true;
      continue;
    }

    if (defaultTemplateSignature(existing) !== defaultTemplateSignature(seeded)) {
      Object.assign(existing, {
        ...seeded,
        id: existing.id,
        status: existing.status,
        createdAt: existing.createdAt,
        createdById: existing.createdById,
        updatedAt: now
      });
      changed = true;
    }
  }

  return { changed };
}

function defaultTemplateSignature(template: WaterfallTemplate) {
  return JSON.stringify({
    name: template.name,
    campaignType: template.campaignType,
    outreachChannel: template.outreachChannel,
    country: template.country,
    requiredFields: template.requiredFields,
    maxCostPerLeadCents: template.maxCostPerLeadCents,
    maxCostPerCampaignCents: template.maxCostPerCampaignCents,
    highValueScoreThreshold: template.highValueScoreThreshold,
    allowGenericEmail: template.allowGenericEmail,
    personas: template.personas,
    steps: normalizeStepOrders(template.steps).map((step) => ({
      order: step.order,
      stage: step.stage,
      capability: step.capability,
      providerIds: step.providerIds,
      runIf: step.runIf,
      stopIf: step.stopIf,
      qualityGate: step.qualityGate,
      optional: step.optional,
      costCapCents: step.costCapCents,
      highValueOnly: step.highValueOnly,
      allowCompanyMainPhone: step.allowCompanyMainPhone
    }))
  });
}
