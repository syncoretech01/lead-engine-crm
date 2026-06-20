import { describe, expect, it } from "vitest";
import {
  isHighValueLead,
  passesQualityGate,
  planNextWaterfallStep,
  rankProviders,
  type WaterfallPlanOptions
} from "@/lib/phase1/waterfall-engine";
import type { WaterfallLeadState } from "@/lib/phase1/waterfall-conditions";
import type { ProviderConnection, WaterfallStep, WaterfallTemplate } from "@/lib/phase1/types";
import type { ProviderCapability } from "@/lib/providers/types";

function conn(
  providerId: string,
  capabilities: ProviderCapability[],
  overrides: Partial<ProviderConnection> = {}
): ProviderConnection {
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
    costPerUnitCents: 10,
    waterfallOrder: 1,
    lastTestStatus: "Not tested",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function step(overrides: Partial<WaterfallStep> & Pick<WaterfallStep, "id" | "order" | "stage" | "capability">): WaterfallStep {
  return { providerIds: [], ...overrides };
}

function template(steps: WaterfallStep[], overrides: Partial<WaterfallTemplate> = {}): WaterfallTemplate {
  return {
    id: "tmpl-1",
    workspaceId: "ws",
    name: "Test",
    campaignType: "hunter_phone_only",
    status: "Active",
    isDefault: false,
    outreachChannel: "phone",
    requiredFields: ["phone:validated"],
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const noBudget = (connections: ProviderConnection[], attempted: string[] = []): WaterfallPlanOptions => ({
  connections,
  attempted: new Set(attempted),
  leadCostCents: 0
});

describe("rankProviders", () => {
  it("uses the explicit providerIds order, filtering to enabled+capable", () => {
    const conns = [
      conn("leadmagic", ["find_phone"]),
      conn("prospeo", ["find_phone"], { enabled: false }),
      conn("apollo", ["find_email"]) // not phone-capable
    ];
    const s = step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["prospeo", "leadmagic", "apollo"] });
    expect(rankProviders(s, conns)).toEqual(["leadmagic"]); // prospeo disabled, apollo lacks capability
  });

  it("falls back to waterfallOrder when providerIds is empty", () => {
    const conns = [
      conn("leadmagic", ["find_phone"], { waterfallOrder: 3 }),
      conn("prospeo", ["find_phone"], { waterfallOrder: 1 }),
      conn("kaspr", ["find_phone"], { waterfallOrder: 2 })
    ];
    const s = step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: [] });
    expect(rankProviders(s, conns)).toEqual(["prospeo", "kaspr", "leadmagic"]);
  });

  it("filters out providers outside the template country", () => {
    const conns = [conn("lead411", ["find_phone"], { supportedCountries: ["US"] }), conn("kaspr", ["find_phone"], { supportedCountries: ["EU"] })];
    const s = step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["lead411", "kaspr"] });
    expect(rankProviders(s, conns, "US")).toEqual(["lead411"]);
  });
});

describe("planNextWaterfallStep", () => {
  const phoneState: WaterfallLeadState = { email: "a@b.com", phone: undefined, leadScore: 60 };

  it("dispatches the first eligible provider of the first applicable step", () => {
    const tmpl = template([
      step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo"], runIf: { field: "phone", op: "isMissing" } })
    ]);
    const plan = planNextWaterfallStep(tmpl, phoneState, noBudget([conn("leadmagic", ["find_phone"]), conn("prospeo", ["find_phone"])]));
    expect(plan).toMatchObject({ kind: "dispatch", stepId: "s1", providerId: "leadmagic", estimatedCostCents: 10 });
  });

  it("skips a step whose runIf is false", () => {
    const tmpl = template([
      step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic"], runIf: { field: "phone", op: "isMissing" } })
    ]);
    const plan = planNextWaterfallStep(tmpl, { ...phoneState, phone: "+15550101000" }, noBudget([conn("leadmagic", ["find_phone"])]));
    expect(plan.kind).toBe("done");
  });

  it("skips highValueOnly steps for low-value leads, runs them for high-value", () => {
    const tmpl = template(
      [step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"], highValueOnly: true })],
      { highValueScoreThreshold: 80 }
    );
    const conns = [conn("lusha", ["find_phone"])];
    expect(planNextWaterfallStep(tmpl, { ...phoneState, leadScore: 60 }, noBudget(conns)).kind).toBe("done");
    expect(planNextWaterfallStep(tmpl, { ...phoneState, leadScore: 90 }, noBudget(conns))).toMatchObject({ kind: "dispatch", providerId: "lusha" });
  });

  it("skips already-attempted providers and moves to the next", () => {
    const tmpl = template([
      step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic", "prospeo"] })
    ]);
    const conns = [conn("leadmagic", ["find_phone"]), conn("prospeo", ["find_phone"])];
    const plan = planNextWaterfallStep(tmpl, phoneState, noBudget(conns, ["s1:leadmagic"]));
    expect(plan).toMatchObject({ kind: "dispatch", providerId: "prospeo" });
  });

  it("stops when the lead-level budget would be exceeded", () => {
    const tmpl = template(
      [step({ id: "s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["lusha"] })],
      { maxCostPerLeadCents: 5 }
    );
    const plan = planNextWaterfallStep(tmpl, phoneState, noBudget([conn("lusha", ["find_phone"], { costPerUnitCents: 10 })]));
    expect(plan.kind).toBe("done"); // 10c > 5c cap
  });

  it("skips a step whose stop condition is already satisfied", () => {
    const tmpl = template([
      step({
        id: "s1",
        order: 1,
        stage: "verify_phone",
        capability: "verify_phone",
        providerIds: ["twilio_lookup"],
        stopIf: { field: "phone.validationStatus", op: "in", value: ["valid"] }
      })
    ]);
    const plan = planNextWaterfallStep(tmpl, { ...phoneState, phoneValidationStatus: "valid" }, noBudget([conn("twilio_lookup", ["verify_phone"])]));
    expect(plan.kind).toBe("done");
  });
});

describe("passesQualityGate", () => {
  it("rejects not-found and honors confidence/status/phone-type gates", () => {
    expect(passesQualityGate({ found: false })).toBe(false);
    expect(passesQualityGate({ found: true })).toBe(true);
    expect(passesQualityGate({ found: true, confidence: 60 }, { minConfidence: 80 })).toBe(false);
    expect(passesQualityGate({ found: true, validationStatus: "valid" }, { acceptStatus: ["valid"] })).toBe(true);
    expect(passesQualityGate({ found: true, validationStatus: "catch_all" }, { allowCatchAll: false })).toBe(false);
    expect(passesQualityGate({ found: true, phoneType: "voip" }, { phoneTypeIn: ["mobile", "direct_dial"] })).toBe(false);
    expect(passesQualityGate({ found: true, phoneType: "company_main" }, { phoneTypeIn: ["mobile"], allowCompanyMain: true })).toBe(true);
  });
});

describe("isHighValueLead", () => {
  it("respects the explicit flag and the score threshold", () => {
    expect(isHighValueLead({ isHighValue: true }, {})).toBe(true);
    expect(isHighValueLead({ leadScore: 90 }, { highValueScoreThreshold: 80 })).toBe(true);
    expect(isHighValueLead({ leadScore: 70 }, { highValueScoreThreshold: 80 })).toBe(false);
  });
});
