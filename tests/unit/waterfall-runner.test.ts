import { describe, expect, it } from "vitest";
import { runWaterfallForLead, type WaterfallExecutor } from "@/lib/phase1/waterfall-runner";
import {
  defaultWaterfallTemplates,
  ensureWaterfallDefaults,
  mergeWaterfallOverride,
  normalizeStepOrders,
  reorderTemplateStep
} from "@/lib/phase1/waterfall-templates";
import { createSeedState } from "@/lib/phase1/seed";
import type { ProviderConnection, WaterfallTemplate } from "@/lib/phase1/types";
import type { ProviderCapability } from "@/lib/providers/types";

function conn(providerId: string, capabilities: ProviderCapability[], costPerUnitCents = 10): ProviderConnection {
  return {
    id: `conn-${providerId}`,
    workspaceId: "ws",
    providerId: providerId as ProviderConnection["providerId"],
    displayName: providerId,
    status: "Connected",
    enabled: true,
    executionMode: "mock",
    categories: [],
    capabilities,
    scopes: [],
    allowedOperations: capabilities,
    secretStorage: "Not configured",
    secretVersion: 0,
    costPerUnitCents,
    waterfallOrder: 1,
    lastTestStatus: "Not tested",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function phoneTemplate(overrides: Partial<WaterfallTemplate> = {}): WaterfallTemplate {
  const id = "tmpl-phone";
  return {
    id,
    workspaceId: "ws",
    name: "Phone",
    campaignType: "hunter_phone_only",
    status: "Active",
    isDefault: false,
    outreachChannel: "phone",
    requiredFields: ["phone:validated"],
    steps: [
      { id: `${id}-s1`, order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo"], runIf: { field: "phone", op: "isMissing" } },
      {
        id: `${id}-s2`,
        order: 2,
        stage: "verify_phone",
        capability: "verify_phone",
        providerIds: ["twilio_lookup"],
        qualityGate: { phoneTypeIn: ["mobile", "direct_dial"] },
        stopIf: { field: "phone.validationStatus", op: "in", value: ["valid"] }
      }
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const connections = [conn("leadmagic", ["find_phone"]), conn("prospeo", ["find_phone"]), conn("twilio_lookup", ["verify_phone"])];

const executor: WaterfallExecutor = async (dispatch) => {
  if (dispatch.providerId === "leadmagic") return { found: false };
  if (dispatch.providerId === "prospeo") return { found: true, value: "+15551234567", phoneType: "mobile", confidence: 90 };
  if (dispatch.providerId === "twilio_lookup") return { found: true, validationStatus: "valid", phoneType: "mobile", confidence: 95 };
  return { found: false };
};

describe("runWaterfallForLead", () => {
  it("walks the waterfall, accepts on fallback, validates, and stops the track", async () => {
    const result = await runWaterfallForLead({
      template: phoneTemplate(),
      workspaceId: "ws",
      targetType: "contact",
      targetId: "contact-1",
      initialState: { phone: undefined, leadScore: 60 },
      connections,
      executor
    });

    expect(result.attempts).toBe(3); // leadmagic (miss), prospeo (hit), twilio (validate)
    expect(result.accepted).toBe(2); // phone found + phone validated
    expect(result.costCents).toBe(30);
    expect(result.fieldSources).toHaveLength(2);
    expect(result.finalState.phone).toBe("+15551234567");
    expect(result.finalState.phoneValidationStatus).toBe("valid");
    expect(result.fieldSources.every((source) => source.field === "phone")).toBe(true);
  });

  it("stops dispatching when the lead budget would be exceeded", async () => {
    const result = await runWaterfallForLead({
      template: phoneTemplate({ maxCostPerLeadCents: 15 }),
      workspaceId: "ws",
      targetType: "contact",
      targetId: "contact-1",
      initialState: { phone: undefined },
      connections,
      executor
    });

    // First call costs 10; a second would hit 20 > 15, so the run halts after one attempt.
    expect(result.attempts).toBe(1);
    expect(result.costCents).toBe(10);
    expect(result.finalState.phoneValidationStatus).toBeUndefined();
  });
});

describe("ensureWaterfallDefaults + defaults", () => {
  it("seeds the six default templates and is idempotent", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const seeded = state.waterfallTemplates.filter((template) => template.workspaceId === workspaceId);

    expect(seeded).toHaveLength(6);
    expect(new Set(seeded.map((template) => template.campaignType))).toEqual(
      new Set([
        "hunter_phone_only",
        "local_business",
        "email_first_call_later",
        "phone_heavy_cold_calling",
        "linkedin_sales_navigator",
        "company_first_abm"
      ])
    );

    const before = state.waterfallTemplates.length;
    expect(ensureWaterfallDefaults(state, workspaceId).changed).toBe(false);
    expect(state.waterfallTemplates).toHaveLength(before);
  });

  it("gives every default template steps with unique ids", () => {
    const templates = defaultWaterfallTemplates("ws");
    for (const template of templates) {
      const ids = template.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(template.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("reorderTemplateStep / normalizeStepOrders", () => {
  const steps = defaultWaterfallTemplates("ws")[0].steps;

  it("moves a step up and renumbers contiguously", () => {
    const second = steps[1];
    const moved = reorderTemplateStep(steps, second.id, "up");
    expect(moved[0].id).toBe(second.id);
    expect(moved.map((step) => step.order)).toEqual(moved.map((_, i) => i + 1));
  });

  it("is a no-op at the boundaries (but still normalizes)", () => {
    const first = steps[0];
    const moved = reorderTemplateStep(steps, first.id, "up");
    expect(moved[0].id).toBe(first.id);
    expect(moved.map((step) => step.order)).toEqual(steps.map((_, i) => i + 1));
  });

  it("normalizeStepOrders compacts gaps", () => {
    const gapped = steps.map((step, i) => ({ ...step, order: (i + 1) * 10 }));
    expect(normalizeStepOrders(gapped).map((step) => step.order)).toEqual(gapped.map((_, i) => i + 1));
  });
});

describe("mergeWaterfallOverride", () => {
  it("overrides caps and steps when provided", () => {
    const tmpl = phoneTemplate();
    const merged = mergeWaterfallOverride(tmpl, { maxCostPerLeadCents: 5, steps: [] });
    expect(merged.maxCostPerLeadCents).toBe(5);
    expect(merged.steps).toEqual([]);
    // unchanged when no override
    expect(mergeWaterfallOverride(tmpl)).toBe(tmpl);
  });
});
