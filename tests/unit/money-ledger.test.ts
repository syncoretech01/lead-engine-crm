import { describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import {
  evaluateBudgetStopRules,
  moneySources,
  workspaceCostMetrics
} from "@/lib/phase1/money";
import { completeProviderJobRun, createProviderJob, startProviderJobRun } from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { processProviderJobQueue } from "@/lib/phase1/provider-worker";
import { createSeedState } from "@/lib/phase1/seed";

describe("provider usage money ledger", () => {
  it("seeds cents-based ledger entries with explicit money source labels", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const metrics = workspaceCostMetrics(state, workspaceId);

    expect(state.providerUsageLedger.length).toBeGreaterThan(0);
    expect(metrics.actualCostCents).toBeGreaterThan(0);
    expect(metrics.costPerVerifiedEmailCents).toBeGreaterThanOrEqual(0);
    for (const entry of state.providerUsageLedger) {
      expect(entry.currency).toBe("USD");
      expect(moneySources).toContain(entry.amountKind);
      expect(Number.isInteger(entry.totalCostCents)).toBe(true);
    }
  });

  it("records actual provider run usage when a provider job completes", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret",
      allowedOperations: ["verify_email"]
    });
    const { job, run } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      sourceObjectType: "lead_job",
      sourceObjectId: state.leadJobs[0].id,
      inputSummary: { email: "nora@syncore.tech", apiToken: "never-ledger" }
    });

    startProviderJobRun(state, run.id);
    completeProviderJobRun(state, {
      runId: run.id,
      recordsRead: 1,
      recordsWritten: 1,
      costCents: 2,
      responseSummary: { status: "valid" },
      rawResponseRef: "object://provider-responses/zerobounce/run-1.json"
    });

    const ledger = state.providerUsageLedger.find((entry) => entry.providerJobRunId === run.id);
    expect(ledger).toMatchObject({
      provider: "zerobounce",
      operation: "verify_email",
      jobId: state.leadJobs[0].id,
      providerJobId: job.id,
      unitsUsed: 1,
      unitCostCents: 2,
      totalCostCents: 2,
      amountKind: "Actual"
    });
    expect(JSON.stringify(ledger)).not.toContain("never-ledger");
  });

  it("evaluates provider daily budget and skips worker runs before spend exceeds the cap", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      secretValue: "apollo-secret",
      allowedOperations: ["discover_companies"],
      dailyBudgetCents: 1
    });
    createProviderJob(state, session, {
      providerId: "apollo",
      operation: "discover_companies",
      inputSummary: { industry: "SaaS" }
    });

    const preview = evaluateBudgetStopRules(state, {
      workspaceId: session.workspace.id,
      providerId: "apollo",
      nextCostCents: 8,
      now: "2026-06-16T10:00:00.000Z"
    });
    const result = processProviderJobQueue(state, {
      workerId: "worker-a",
      workspaceId: session.workspace.id,
      now: "2026-06-16T10:00:00.000Z"
    });

    expect(preview.allowed).toBe(false);
    expect(result.results[0]).toMatchObject({
      status: "Skipped"
    });
    expect(state.providerUsageLedger.some((entry) => entry.provider === "apollo")).toBe(false);
  });
});
