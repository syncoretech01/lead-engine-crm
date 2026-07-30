import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FinancialEventKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { actualSpendEffectCents } from "@/lib/growth/repositories/financial-ledger-repository";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("Growth financial-ledger foundation invariants", () => {
  it("declares the accepted immutable event kinds and nullable historical compatibility", () => {
    const schema = read("prisma/schema.prisma");
    const kinds = schema.match(/enum FinancialEventKind \{([^}]*)\}/)?.[1] ?? "";
    expect(kinds.match(/[A-Z_]+/g)).toEqual(["ESTIMATE", "AUTHORIZATION", "ACTUAL", "ADJUSTMENT", "REVERSAL"]);
    const cost = schema.slice(schema.indexOf("model CostEntry {"));
    expect(cost).toMatch(/^\s*eventKind\s+FinancialEventKind\?/m);
    expect(cost).toMatch(/^\s*currency\s+String\?/m);
    expect(cost).toMatch(/^\s*idempotencyKey\s+String\?/m);
    expect(cost).toContain("@@unique([workspaceId, idempotencyKey])");
    expect(cost).toContain("providerUsageLedgerId");
  });

  it("keeps the projected provider ledger out of native financial relations and writers", () => {
    const schema = read("prisma/schema.prisma");
    const providerLedger = schema.slice(
      schema.indexOf("model ProviderUsageLedger {"),
      schema.indexOf("model ProviderMetricDaily {")
    );
    expect(providerLedger).not.toContain("CostEntry");
    const repository = read("lib/growth/repositories/financial-ledger-repository.ts");
    expect(repository).not.toMatch(/providerUsageLedger\.(create|upsert|update|delete)/);
  });

  it("exposes append-only operations and no generic update or delete path", () => {
    const repository = read("lib/growth/repositories/financial-ledger-repository.ts");
    for (const operation of [
      "recordEstimate",
      "recordAuthorization",
      "recordActual",
      "recordAdjustment",
      "recordReversal",
      "getFinancialEvent",
      "getCostActionEvents"
    ]) {
      expect(repository).toContain(`export async function ${operation}`);
    }
    expect(repository).not.toMatch(/costEntry\.(update|updateMany|delete|deleteMany)/);
  });

  it("keeps the forward migration data-preserving and provider-projection neutral", () => {
    const migration = read(
      "prisma/migrations/20260730190000_growth_os_cost_entry_foundation/migration.sql"
    );
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toMatch(/UPDATE\s+"?(CostEntry|ProviderUsageLedger)/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"ProviderUsageLedger"/i);
    expect(migration).toContain("NOT VALID");
  });

  it("makes CostEntry the only source for authoritative totals", () => {
    const readModel = read("lib/growth/read-models/cost-ledger.ts");
    expect(readModel).toContain('source: "legacy_operational_evidence"');
    expect(readModel).toContain("isAuthoritativeFinancial: false");
    expect(readModel).toContain("calculateCampaignFinancialTotals");
    expect(readModel).toContain("calculateStageFinancialTotals");
    expect(readModel).not.toMatch(/providerUsageLedger\.(aggregate|groupBy)/);
  });

  it("projects target-aware actual-spend effects for every immutable event kind", () => {
    expect(actualSpendEffectCents(FinancialEventKind.ESTIMATE, 100)).toBe(0);
    expect(actualSpendEffectCents(FinancialEventKind.AUTHORIZATION, 90)).toBe(0);
    expect(actualSpendEffectCents(FinancialEventKind.ACTUAL, 70)).toBe(70);
    expect(actualSpendEffectCents(FinancialEventKind.ADJUSTMENT, -15)).toBe(-15);
    expect(
      actualSpendEffectCents(FinancialEventKind.REVERSAL, 100, {
        eventKind: FinancialEventKind.ESTIMATE,
        amountCents: 100
      })
    ).toBe(0);
    expect(
      actualSpendEffectCents(FinancialEventKind.REVERSAL, 90, {
        eventKind: FinancialEventKind.AUTHORIZATION,
        amountCents: 90
      })
    ).toBe(0);
    expect(
      actualSpendEffectCents(FinancialEventKind.REVERSAL, 70, {
        eventKind: FinancialEventKind.ACTUAL,
        amountCents: 70
      })
    ).toBe(-70);
    expect(
      actualSpendEffectCents(FinancialEventKind.REVERSAL, 15, {
        eventKind: FinancialEventKind.ADJUSTMENT,
        amountCents: -15
      })
    ).toBe(15);
  });
});
