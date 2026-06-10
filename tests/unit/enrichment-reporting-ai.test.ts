import { describe, expect, it } from "vitest";
import { aiAutomationDashboard, runAiAutomationSuite } from "@/lib/phase1/ai";
import { runWorkspaceEnrichment } from "@/lib/phase1/enrichment";
import { reportingDashboardSnapshot } from "@/lib/phase1/reporting";
import { createSeedState } from "@/lib/phase1/seed";

describe("enrichment, reporting, and AI automation", () => {
  it("uses cached enrichment and produces explainable lead scores", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;

    const result = runWorkspaceEnrichment(state, workspaceId);

    expect(result.cacheHits).toBeGreaterThan(0);
    expect(state.enrichmentResults.length).toBeGreaterThan(0);
    expect(state.contacts.some((contact) => (contact.enrichmentCoverage ?? 0) > 0)).toBe(true);
    expect(state.leadScores[0]?.breakdown).toMatchObject({
      verification: expect.any(Number),
      enrichment: expect.any(Number),
      segment: expect.any(Number),
      fit: expect.any(Number),
      compliance: expect.any(Number)
    });
  });

  it("builds admin reporting metrics across source, SDR, campaign, deliverability, and pipeline", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const dashboard = reportingDashboardSnapshot(state, workspaceId);

    expect(dashboard.metrics.rawLeads).toBeGreaterThan(0);
    expect(dashboard.sourcePerformance.length).toBeGreaterThan(0);
    expect(dashboard.sdrPerformance.length).toBeGreaterThan(0);
    expect(dashboard.campaignPerformance.length).toBeGreaterThan(0);
    expect(dashboard.deliverabilityHealth.length).toBeGreaterThan(0);
    expect(dashboard.pipeline.some((stage) => stage.opportunities > 0)).toBe(true);
    expect(dashboard.dataQuality.some((row) => row.label === "Suppressed contacts")).toBe(true);
  });

  it("generates local AI automation records and exposes dashboard counts", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;

    const run = runAiAutomationSuite(state, workspaceId, state.users[0].id);
    const dashboard = aiAutomationDashboard(state, workspaceId);

    expect(run.status).toBe("Completed");
    expect(dashboard.metrics.personalizations).toBeGreaterThan(0);
    expect(dashboard.metrics.leadScorePredictions).toBeGreaterThan(0);
    expect(dashboard.metrics.icpRecommendations).toBeGreaterThan(0);
    expect(dashboard.metrics.deliverabilityRecommendations).toBeGreaterThan(0);
    expect(dashboard.metrics.revenueInsights).toBeGreaterThan(0);
    expect(dashboard.automationRuns[0]?.automationType).toBe("Full automation suite");
  });
});
