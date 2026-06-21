import { afterEach, describe, expect, it } from "vitest";
import { createWaterfallExecutor, mapProviderResultToOutcome } from "@/lib/phase1/waterfall-provider-executor";
import { applyWaterfallResults, runWaterfallForLead } from "@/lib/phase1/waterfall-runner";
import { createSeedState } from "@/lib/phase1/seed";
import { registerLiveProviderAdapter, resetLiveProviderAdapters } from "@/lib/providers/live-adapters";
import type { FieldSource, ProviderConnection, WaterfallTemplate } from "@/lib/phase1/types";
import type { ProviderCapability, ProviderResult } from "@/lib/providers/types";

function result(status: ProviderResult<unknown>["status"], data: Record<string, unknown>[]): ProviderResult<unknown> {
  return { status, data, meta: { providerId: "leadmagic" } };
}

describe("mapProviderResultToOutcome", () => {
  it("returns not-found for non-ok or empty results", () => {
    expect(mapProviderResultToOutcome("find_email", result("skipped", []))).toEqual({ found: false });
    expect(mapProviderResultToOutcome("find_email", result("ok", []))).toEqual({ found: false });
  });

  it("maps email find/verify (incl. catch-all)", () => {
    expect(mapProviderResultToOutcome("find_email", result("ok", [{ email: "a@b.com", confidence: 80 }]))).toEqual({
      found: true,
      value: "a@b.com",
      confidence: 80
    });
    expect(mapProviderResultToOutcome("verify_email", result("ok", [{ email: "a@b.com", status: "valid" }])).validationStatus).toBe("valid");
    expect(mapProviderResultToOutcome("verify_email", result("ok", [{ email: "a@b.com", status: "valid", catchAll: true }])).validationStatus).toBe("catch_all");
  });

  it("maps phone find/verify and line types", () => {
    expect(mapProviderResultToOutcome("find_phone", result("ok", [{ phone: "+15551234567", phoneType: "mobile" }]))).toMatchObject({
      found: true,
      value: "+15551234567",
      phoneType: "mobile"
    });
    const verified = mapProviderResultToOutcome("verify_phone", result("ok", [{ phone: "+15551234567", status: "valid", lineType: "toll_free" }]));
    expect(verified).toMatchObject({ found: true, validationStatus: "valid", phoneType: "company_main" });
  });

  it("treats discovery/enrichment as presence-only", () => {
    expect(mapProviderResultToOutcome("discover_contacts", result("ok", [{ fullName: "A" }, { fullName: "B" }]))).toEqual({ found: true });
  });
});

describe("applyWaterfallResults", () => {
  it("persists field sources, updates the contact, and books cost to the ledger", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts[0];
    const ledgerBefore = state.providerUsageLedger.length;
    const fieldsBefore = state.fieldSources.length;

    const fieldSource: FieldSource = {
      id: "fs-test-1",
      workspaceId,
      targetType: "contact",
      targetId: contact.id,
      field: "phone",
      value: "+15559990000",
      providerId: "leadmagic",
      capability: "find_phone",
      confidence: 90,
      validationStatus: "valid",
      phoneType: "mobile",
      costCents: 12,
      cacheHit: false,
      enrichmentDate: "2026-06-20T00:00:00.000Z"
    };

    const summary = applyWaterfallResults(state, workspaceId, [
      {
        contactId: contact.id,
        result: {
          fieldSources: [fieldSource],
          attempts: 1,
          accepted: 1,
          costCents: 12,
          reason: "done",
          finalState: { phone: "+15559990000", phoneValidationStatus: "valid" }
        }
      }
    ]);

    expect(summary).toMatchObject({ contactsProcessed: 1, fieldsWritten: 1, costCents: 12 });
    expect(state.fieldSources.length).toBe(fieldsBefore + 1);
    expect(state.contacts.find((item) => item.id === contact.id)?.phone).toBe("+15559990000");
    expect(state.providerUsageLedger.length).toBe(ledgerBefore + 1);
  });
});

function conn(providerId: string, capabilities: ProviderCapability[]): ProviderConnection {
  return {
    id: `conn-${providerId}`,
    workspaceId: "ws",
    providerId: providerId as ProviderConnection["providerId"],
    displayName: providerId,
    status: "Connected",
    enabled: true,
    executionMode: "live",
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
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const phoneTemplate: WaterfallTemplate = {
  id: "t1",
  workspaceId: "ws",
  name: "Phone",
  campaignType: "hunter_phone_only",
  status: "Active",
  isDefault: false,
  outreachChannel: "phone",
  requiredFields: ["phone:validated"],
  steps: [
    { id: "t1-s1", order: 1, stage: "find_phone", capability: "find_phone", providerIds: ["leadmagic"], runIf: { field: "phone", op: "isMissing" } },
    {
      id: "t1-s2",
      order: 2,
      stage: "verify_phone",
      capability: "verify_phone",
      providerIds: ["twilio_lookup"],
      qualityGate: { phoneTypeIn: ["mobile", "direct_dial"] },
      stopIf: { field: "phone.validationStatus", op: "in", value: ["valid"] }
    }
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("waterfall enrichment end-to-end with a registered adapter", () => {
  afterEach(() => resetLiveProviderAdapters());

  it("runs live adapters through the executor and persists field sources to a contact", async () => {
    registerLiveProviderAdapter({
      id: "leadmagic",
      operations: {
        find_phone: async () => ({ status: "ok", data: [{ phone: "+15551234567", phoneType: "mobile", confidence: 92 }], meta: { providerId: "leadmagic" } })
      }
    });
    registerLiveProviderAdapter({
      id: "twilio_lookup",
      operations: {
        verify_phone: async () => ({ status: "ok", data: [{ phone: "+15551234567", status: "valid", lineType: "mobile" }], meta: { providerId: "twilio_lookup" } })
      }
    });

    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts[0];
    const connections = [conn("leadmagic", ["find_phone"]), conn("twilio_lookup", ["verify_phone"])];
    const executor = createWaterfallExecutor({ workspaceId, liveProviderIds: new Set(["leadmagic", "twilio_lookup"]) });

    const runResult = await runWaterfallForLead({
      template: phoneTemplate,
      workspaceId,
      targetType: "contact",
      targetId: contact.id,
      initialState: { fullName: contact.name, phone: undefined },
      connections,
      executor
    });

    expect(runResult.finalState.phone).toBe("+15551234567");
    expect(runResult.finalState.phoneValidationStatus).toBe("valid");
    expect(runResult.fieldSources).toHaveLength(2);

    const fieldsBefore = state.fieldSources.length;
    applyWaterfallResults(state, workspaceId, [{ contactId: contact.id, result: runResult }]);
    expect(state.fieldSources.length).toBe(fieldsBefore + 2);
    expect(state.fieldSources.some((source) => source.targetId === contact.id && source.providerId === "leadmagic")).toBe(true);
    expect(state.contacts.find((item) => item.id === contact.id)?.phone).toBe("+15551234567");
  });

  it("makes no call and finds nothing when the provider is not in liveProviderIds (mock/kill-switch)", async () => {
    let called = false;
    registerLiveProviderAdapter({
      id: "leadmagic",
      operations: {
        find_phone: async () => {
          called = true;
          return { status: "ok", data: [{ phone: "+15551234567" }], meta: { providerId: "leadmagic" } };
        }
      }
    });

    const executor = createWaterfallExecutor({ workspaceId: "ws", liveProviderIds: new Set() });
    const runResult = await runWaterfallForLead({
      template: phoneTemplate,
      workspaceId: "ws",
      targetType: "contact",
      targetId: "c1",
      initialState: { phone: undefined },
      connections: [conn("leadmagic", ["find_phone"]), conn("twilio_lookup", ["verify_phone"])],
      executor
    });

    expect(called).toBe(false);
    expect(runResult.accepted).toBe(0);
  });
});
