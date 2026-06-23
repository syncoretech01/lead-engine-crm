import { describe, expect, it } from "vitest";
import { pruneWaterfallTemplateProviders } from "@/lib/phase1/waterfall-templates";
import type { AppState, WaterfallStep, WaterfallTemplate } from "@/lib/phase1/types";

function step(order: number, providerIds: string[]): WaterfallStep {
  return { id: `s${order}`, order, stage: "find_phone", capability: "find_phone", providerIds } as WaterfallStep;
}

function template(steps: WaterfallStep[]): WaterfallTemplate {
  return {
    id: "t",
    workspaceId: "ws",
    name: "T",
    campaignType: "email_first_call_later",
    status: "Active",
    isDefault: true,
    outreachChannel: "both",
    requiredFields: [],
    steps,
    createdAt: "",
    updatedAt: ""
  } as WaterfallTemplate;
}

describe("pruneWaterfallTemplateProviders", () => {
  it("drops removed providers from mixed steps and removes now-empty steps", () => {
    const state = {
      waterfallTemplates: [
        template([
          step(1, ["leadmagic", "prospeo", "fullenrich"]),
          step(2, ["lusha"]),
          step(3, ["twilio_lookup"])
        ])
      ]
    } as unknown as AppState;

    const result = pruneWaterfallTemplateProviders(state);

    expect(result.changed).toBe(true);
    const steps = state.waterfallTemplates[0].steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].providerIds).toEqual(["leadmagic", "prospeo"]);
    expect(steps.map((item) => item.order)).toEqual([1, 2]);
    expect(steps.some((item) => item.providerIds.includes("lusha") || item.providerIds.includes("fullenrich"))).toBe(false);
  });

  it("is a no-op for clean templates", () => {
    const state = {
      waterfallTemplates: [template([step(1, ["leadmagic"]), step(2, ["twilio_lookup"])])]
    } as unknown as AppState;

    expect(pruneWaterfallTemplateProviders(state).changed).toBe(false);
  });

  it("keeps intentionally-empty steps (any eligible provider)", () => {
    const state = {
      waterfallTemplates: [template([step(1, [])])]
    } as unknown as AppState;

    const result = pruneWaterfallTemplateProviders(state);
    expect(result.changed).toBe(false);
    expect(state.waterfallTemplates[0].steps).toHaveLength(1);
  });
});
