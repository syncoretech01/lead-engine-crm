import { describe, expect, it } from "vitest";
import {
  applyLeadOverride,
  createLeadJobFromPreflight,
  createLeadJobPreflight
} from "@/lib/phase1/lead-planning";
import { createSeedState } from "@/lib/phase1/seed";
import type { Session } from "@/lib/phase1/types";

describe("lead job preflight and overrides", () => {
  it("estimates records, credits, cost, and budget status before a job is queued", () => {
    const state = createSeedState();
    const profile = state.searchProfiles[0];
    const preflight = createLeadJobPreflight({
      profile,
      sources: profile.sources,
      requestedRecords: profile.estimatedVolume
    });

    expect(preflight.estimatedRecords).toBeGreaterThan(0);
    expect(preflight.estimatedCostCents).toBeGreaterThanOrEqual(0);
    expect(preflight.estimatedCredits).toBeGreaterThanOrEqual(0);
    expect(preflight.budgetCapCents).toBeGreaterThanOrEqual(preflight.estimatedCostCents);
    expect(preflight.sourceEstimates.map((estimate) => estimate.source)).toEqual(profile.sources);
  });

  it("requires budget confirmation and rejects under-budget lead jobs", () => {
    const state = createSeedState();
    const profile = state.searchProfiles[0];
    const session = sessionForState(state);

    expect(() =>
      createLeadJobFromPreflight({
        session,
        profile,
        sources: profile.sources,
        budgetConfirmed: false
      })
    ).toThrow("Budget confirmation is required");

    expect(() =>
      createLeadJobFromPreflight({
        session,
        profile,
        sources: profile.sources,
        requestedRecords: profile.estimatedVolume,
        budgetCapCents: 1,
        budgetConfirmed: true
      })
    ).toThrow("Budget cap must be greater than or equal");

    const job = createLeadJobFromPreflight({
      session,
      profile,
      sources: profile.sources,
      requestedRecords: profile.estimatedVolume,
      budgetConfirmed: true
    });

    expect(job.status).toBe("Queued");
    expect(job.budgetStatus).toBe("Confirmed");
    expect(job.preflightSourceEstimates?.length).toBe(profile.sources.length);
  });

  it("requires a reason when manually overriding priority or segment and syncs normalized records", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const contact = state.contacts.find((item) =>
      state.normalizedRecords.some((record) => record.workspaceId === workspaceId && record.email === item.email)
    );

    expect(contact).toBeDefined();
    if (!contact) return;

    expect(() =>
      applyLeadOverride({
        state,
        workspaceId,
        contactId: contact.id,
        priorityOverride: "P1",
        reason: ""
      })
    ).toThrow("An override reason is required");

    const priorityOverride = contact.priority === "P1" ? "P2" : "P1";
    const result = applyLeadOverride({
      state,
      workspaceId,
      contactId: contact.id,
      priorityOverride,
      segmentOverride: "Manual high-intent segment",
      reason: "Owner confirmed this account is a strategic fit."
    });

    expect(result.before.priority).not.toBe(result.after.priority);
    expect(result.after).toMatchObject({
      priority: priorityOverride,
      segment: "Manual high-intent segment"
    });
    expect(
      state.normalizedRecords.some(
        (record) =>
          record.email === contact.email &&
          record.priority === priorityOverride &&
          record.segment === "Manual high-intent segment"
      )
    ).toBe(true);
  });
});

function sessionForState(state: ReturnType<typeof createSeedState>): Session {
  return {
    user: state.users[0],
    workspace: state.workspaces[0],
    role: "Admin",
    permissions: ["run_jobs"]
  };
}
