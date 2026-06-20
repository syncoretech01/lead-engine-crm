import type { WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type {
  AppState,
  Contact,
  WaterfallOverride,
  WaterfallStep,
  WaterfallTemplate
} from "@/lib/phase1/types";

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
        { order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo"], runIf: phoneMissing },
        { order: 2, stage: "find_phone", capability: "find_phone", providerIds: ["contactout"], runIf: { all: [phoneMissing, { field: "linkedinUrl", op: "exists" }] } },
        { order: 3, stage: "find_phone", capability: "find_phone", providerIds: ["bettercontact", "fullenrich", "apollo"], runIf: phoneMissing },
        { order: 4, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], highValueOnly: true, runIf: phoneMissing },
        { order: 5, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"], rejectVoipForSms: true, minConfidence: 70 }, stopIf: validPhone }
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
        { order: 1, stage: "source", capability: "discover_companies", providerIds: ["google_places", "apify_maps"] },
        { order: 2, stage: "enrich", capability: "enrich_company", providerIds: ["website_scrape"], runIf: { field: "domain", op: "exists" } },
        { order: 3, stage: "find_email", capability: "find_email", providerIds: ["website_scrape", "leadmagic", "prospeo"], runIf: emailMissing },
        { order: 4, stage: "discover_contacts", capability: "discover_contacts", providerIds: ["lead411", "contactout"], optional: true },
        { order: 5, stage: "verify_email", capability: "verify_email", providerIds: ["bouncer", "millionverifier"], qualityGate: { acceptStatus: ["valid", "catch_all"], allowCatchAll: true } },
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
        { order: 1, stage: "find_email", capability: "find_email", providerIds: ["hunter", "leadmagic", "prospeo"], runIf: emailMissing },
        { order: 2, stage: "find_email", capability: "find_email", providerIds: ["findymail"], runIf: { all: [emailMissing, { field: "linkedinUrl", op: "exists" }] } },
        { order: 3, stage: "verify_email", capability: "verify_email", providerIds: ["bouncer", "millionverifier"], qualityGate: { acceptStatus: ["valid"], allowCatchAll: false, minConfidence: 80 }, stopIf: validEmail },
        { order: 4, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo", "contactout", "bettercontact", "fullenrich"], runIf: { all: [phoneMissing, { any: [{ field: "engagement", op: "in", value: ["opened", "clicked", "replied", "booked"] }, { field: "leadScore", op: "gte", value: 70 }] }] } },
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
        { order: 2, stage: "find_phone", capability: "find_phone", providerIds: ["lead411", "leadmagic", "prospeo", "bettercontact", "fullenrich", "apollo"], runIf: phoneMissing },
        { order: 3, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], highValueOnly: true, runIf: phoneMissing },
        { order: 4, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"], allowCompanyMain: false, rejectVoipForSms: true, rejectStatus: ["invalid", "unknown", "risky"], minConfidence: 75 }, stopIf: validPhone }
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
        { order: 1, stage: "enrich", capability: "enrich_contact", providerIds: ["apify_harvest"], runIf: { field: "linkedinUrl", op: "exists" } },
        { order: 2, stage: "find_email", capability: "find_email", providerIds: ["findymail", "leadmagic", "prospeo", "contactout"], runIf: emailMissing },
        { order: 3, stage: "find_email", capability: "find_email", providerIds: ["bettercontact"], runIf: emailMissing },
        { order: 4, stage: "verify_email", capability: "verify_email", providerIds: ["bouncer"], qualityGate: { acceptStatus: ["valid"], minConfidence: 80 }, stopIf: validEmail },
        { order: 5, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo", "contactout"], runIf: phoneMissing },
        { order: 6, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { phoneTypeIn: ["mobile", "direct_dial"] } }
      ]
    ),
    base(
      "company-first-abm",
      "Company-First ABM",
      "company_first_abm",
      "both",
      ["contactsPerCompany:3"],
      [
        { order: 1, stage: "source", capability: "discover_companies", providerIds: ["apify_maps", "apollo"] },
        { order: 2, stage: "enrich", capability: "enrich_company", providerIds: ["website_scrape", "apollo"], runIf: { field: "domain", op: "exists" } },
        { order: 3, stage: "discover_contacts", capability: "discover_contacts", providerIds: ["lead411", "apollo", "leadmagic", "prospeo", "contactout"], stopIf: { field: "contactsFound", op: "gte", value: 3 } },
        { order: 4, stage: "discover_contacts", capability: "discover_contacts", providerIds: ["fullenrich"], highValueOnly: true, stopIf: { field: "contactsFound", op: "gte", value: 3 } },
        { order: 5, stage: "verify_email", capability: "verify_email", providerIds: ["bouncer", "millionverifier"], qualityGate: { acceptStatus: ["valid"] } },
        { order: 6, stage: "verify_phone", capability: "verify_phone", providerIds: ["twilio_lookup"], qualityGate: { allowCompanyMain: true }, allowCompanyMainPhone: true }
      ],
      { personas: ["owner", "ceo", "general_manager", "operations_manager", "marketing_manager", "sales_manager", "procurement_manager"] }
    )
  ];
}

/** Seed default templates for a workspace if it has none yet. */
export function ensureWaterfallDefaults(state: AppState, workspaceId: string, now = new Date().toISOString()) {
  if (!Array.isArray(state.waterfallTemplates)) {
    state.waterfallTemplates = [];
  }
  const hasTemplates = state.waterfallTemplates.some((template) => template.workspaceId === workspaceId);
  if (hasTemplates) {
    return { changed: false };
  }
  state.waterfallTemplates.push(...defaultWaterfallTemplates(workspaceId, now));
  return { changed: true };
}
