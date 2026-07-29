import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NICHE_TEST_INITIAL_STAGE_RUNS } from "@/lib/growth/repositories/campaign-repository";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("NICHE_TEST approval orchestration", () => {
  it("initializes only completed research and the pending free Hub search", () => {
    expect(NICHE_TEST_INITIAL_STAGE_RUNS).toEqual([
      { stageType: "RESEARCH", status: "COMPLETED" },
      { stageType: "HUB_SEARCH", status: "PENDING" }
    ]);
    const statuses: readonly string[] = NICHE_TEST_INITIAL_STAGE_RUNS.map((stage) => stage.status);
    expect(statuses).not.toContain("RUNNING");
    expect(
      statuses.includes("APPROVED")
    ).toBe(false);
  });

  it("routes dashboard and chat decisions through one production service", () => {
    for (const file of [
      "app/approvals/actions.ts",
      "app/api/approvals/[id]/decide/route.ts"
    ]) {
      const source = read(file);
      expect(source).toContain("decideApprovalWithSideEffects");
      expect(source).not.toMatch(/\bdecideApproval\s*\(/);
    }
  });

  it("pins idempotency in PostgreSQL rather than request-local checks", () => {
    const migration = read(
      "prisma/migrations/20260729214000_growth_os_niche_approval_side_effects/migration.sql"
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "NicheBrief_approvalId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "Campaign_originApprovalId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CampaignStageRun_orchestrationKey_key"');
    expect(read("prisma/schema.prisma")).toContain("originApprovalId");
  });

  it("does not introduce provider, Hub, Mailshake, verifier, Audit Bot, or spending calls", () => {
    const source = read("lib/growth/approval-orchestration.ts");
    for (const forbiddenImport of [
      "lib/providers",
      "lead-hub",
      "mailshake",
      "email-verifier",
      "audit-bot",
      "CostEntry",
      "ProviderUsageLedger"
    ]) {
      expect(source).not.toContain(forbiddenImport);
    }
  });
});
