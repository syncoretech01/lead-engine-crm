import { describe, expect, it } from "vitest";

import {
  buildSdrDailyCallPlan,
  SDR_DAILY_CALL_TARGET,
  type SdrCallCycleRow
} from "@/lib/phase1/sdr-call-cycle";
import { createSeedState } from "@/lib/phase1/seed";
import { createNormalizedPersistenceProjection } from "@/lib/phase1/persistence-projection";
import {
  assignContactToSdr,
  assignWorkspaceLeads,
  recordSdrCallCycleAttempt
} from "@/lib/phase1/sdr";

describe("SDR two-pass calling cycle", () => {
  it("limits the daily plan to the SDR's remaining calls", () => {
    const rows = Array.from({ length: 175 }, (_, index) =>
      callRow(`2026-07-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`)
    );
    const plan = buildSdrDailyCallPlan(rows, "sdr-1", 10);

    expect(plan.target).toBe(SDR_DAILY_CALL_TARGET);
    expect(plan.completedToday).toBe(10);
    expect(plan.remainingToday).toBe(140);
    expect(plan.pass).toBe(1);
    expect(plan.activeBatchSize).toBe(175);
    expect(plan.batchRemaining).toBe(175);
    expect(plan.assignments).toHaveLength(140);
  });

  it("does not open pass two until every callable first pass is complete", () => {
    const rows: SdrCallCycleRow[] = [
      callRow("2026-07-01T00:00:00.000Z", { firstCallCompletedAt: "2026-07-02T00:00:00.000Z" }),
      callRow("2026-07-01T00:01:00.000Z"),
      callRow("2026-07-01T00:02:00.000Z", { status: "Suppressed", doNotContact: true })
    ];

    const firstPlan = buildSdrDailyCallPlan(rows, "sdr-1", 0);
    expect(firstPlan.pass).toBe(1);
    expect(firstPlan.assignments).toEqual([rows[1]]);

    rows[1].firstCallCompletedAt = "2026-07-02T00:05:00.000Z";
    const secondPlan = buildSdrDailyCallPlan(rows, "sdr-1", 0);
    expect(secondPlan.pass).toBe(2);
    expect(secondPlan.assignments).toEqual([rows[0], rows[1]]);
    expect(secondPlan.assignments).not.toContain(rows[2]);
  });

  it("records two ordered passes and archives the batch without deleting ownership", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const actor = state.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.role === "Admin"
    );
    const sdr = state.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.role === "SDR"
    );
    if (!actor || !sdr) throw new Error("Expected seeded admin and SDR members.");

    state.sdrAssignments = [];
    state.followUpReminders = [];
    const contacts = state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && contact.phone)
      .slice(0, 2);
    if (contacts.length < 2) throw new Error("Expected two callable seeded contacts.");

    for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
      contact.isSuppressed = !contacts.includes(contact);
      contact.doNotContact = !contacts.includes(contact);
    }
    for (const contact of contacts) {
      contact.isSuppressed = false;
      contact.doNotContact = false;
      contact.priority = "P2";
      contact.status = "Ready for SDR";
      contact.owner = "Unassigned";
      assignContactToSdr(state, {
        workspaceId,
        contactId: contact.id,
        sdrId: sdr.userId,
        actorUserId: actor.userId,
        reason: "Call-cycle test"
      });
    }

    const [first, second] = state.sdrAssignments;
    expect(recordSdrCallCycleAttempt(state, cycleInput(workspaceId, first.id, actor.userId, 1)).recordedPass).toBe(1);
    expect(recordSdrCallCycleAttempt(state, cycleInput(workspaceId, first.id, actor.userId, 2)).recordedPass).toBeNull();
    expect(recordSdrCallCycleAttempt(state, cycleInput(workspaceId, second.id, actor.userId, 3)).recordedPass).toBe(1);
    expect(recordSdrCallCycleAttempt(state, cycleInput(workspaceId, first.id, actor.userId, 4)).recordedPass).toBe(2);
    const completed = recordSdrCallCycleAttempt(state, cycleInput(workspaceId, second.id, actor.userId, 5));

    expect(completed).toMatchObject({ recordedPass: 2, batchCompleted: true, nextBatchAssigned: 0 });
    expect(first.callCycleCompletedAt).toBeTruthy();
    expect(second.callCycleCompletedAt).toBeTruthy();
    expect(first.assignedSdrId).toBe(sdr.userId);
    expect(second.assignedSdrId).toBe(sdr.userId);
    expect(state.sdrAssignments).toHaveLength(2);
    const projected = createNormalizedPersistenceProjection(state).sdrAssignments;
    expect(projected.find((assignment) => assignment.id === first.id)?.firstCallCompletedAt).toBeTruthy();
    expect(projected.find((assignment) => assignment.id === first.id)?.secondCallCompletedAt).toBeTruthy();
    expect(projected.find((assignment) => assignment.id === first.id)?.callCycleCompletedAt).toBeTruthy();
  });

  it("does not top up an SDR while their current batch is still open", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const actor = state.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.role === "Admin"
    );
    const sdr = state.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.role === "SDR"
    );
    if (!actor || !sdr) throw new Error("Expected seeded admin and SDR members.");

    const contacts = state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && contact.companyId === "company-lone-star" && contact.phone)
      .slice(0, 2);
    if (contacts.length < 2) throw new Error("Expected two callable contacts on one account.");

    state.sdrAssignments = [];
    state.followUpReminders = [];
    for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
      contact.isSuppressed = !contacts.includes(contact);
      contact.doNotContact = !contacts.includes(contact);
    }
    for (const contact of contacts) {
      contact.isSuppressed = false;
      contact.doNotContact = false;
      contact.status = "Ready for SDR";
      contact.owner = "Unassigned";
    }

    assignContactToSdr(state, {
      workspaceId,
      contactId: contacts[0].id,
      sdrId: sdr.userId,
      actorUserId: actor.userId,
      reason: "Open current batch"
    });
    const blocked = assignWorkspaceLeads(state, workspaceId, actor.userId, "2026-07-20T10:00:00.000Z", {
      eligibleContactIds: new Set([contacts[1].id]),
      orderedContactIds: [contacts[1].id]
    });
    expect(blocked.created).toBe(0);

    state.sdrAssignments[0].callCycleCompletedAt = "2026-07-20T10:01:00.000Z";
    const nextBatch = assignWorkspaceLeads(state, workspaceId, actor.userId, "2026-07-20T10:02:00.000Z", {
      eligibleContactIds: new Set([contacts[1].id]),
      orderedContactIds: [contacts[1].id]
    });
    expect(nextBatch.created).toBe(1);
  });
});

function callRow(assignedAt: string, overrides: Partial<SdrCallCycleRow> = {}): SdrCallCycleRow {
  return {
    assignedSdrId: "sdr-1",
    assignedAt,
    status: "Assigned",
    phone: "+12025550100",
    ...overrides
  };
}

function cycleInput(workspaceId: string, assignmentId: string, actorUserId: string, minute: number) {
  return {
    workspaceId,
    assignmentId,
    actorUserId,
    now: `2026-07-20T10:${String(minute).padStart(2, "0")}:00.000Z`
  };
}
