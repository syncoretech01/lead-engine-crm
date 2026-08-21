import { describe, expect, it } from "vitest";

import { createSeedState } from "@/lib/phase1/seed";
import {
  assignWorkspaceLeads,
  followUpSourceRowsSnapshot,
  recordFirstTouch
} from "@/lib/phase1/sdr";
import { groupFollowUpsByContact } from "@/lib/phase1/follow-ups-read-model";
import type { AppState } from "@/lib/phase1/types";

function seededAssignment(state: AppState, workspaceId: string) {
  assignWorkspaceLeads(state, workspaceId, state.users[0].id);
  const assignment = state.sdrAssignments.find(
    (item) => item.workspaceId === workspaceId && Boolean(item.contactId)
  );
  if (!assignment) throw new Error("Expected a seeded SDR assignment with a contact.");
  return assignment;
}

function openRemindersFor(state: AppState, assignmentId: string) {
  return state.followUpReminders.filter(
    (reminder) => reminder.assignmentId === assignmentId && reminder.status !== "Completed"
  );
}

describe("follow-up origin", () => {
  it("tags the assignment's first-touch SLA reminder as system", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const assignment = seededAssignment(state, workspaceId);

    const reminders = openRemindersFor(state, assignment.id);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every((reminder) => reminder.origin === "system")).toBe(true);
  });

  it("tags a touch as sdr only when the SDR supplied a follow-up date", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const assignment = seededAssignment(state, workspaceId);

    recordFirstTouch(state, {
      workspaceId,
      assignmentId: assignment.id,
      actorUserId: assignment.assignedSdrId,
      channel: "Call",
      outcome: "Contacted",
      notes: "Spoke briefly, agreed to reconnect Thursday.",
      followUpDueAt: "2026-09-03T15:00:00.000Z"
    });

    const reminders = openRemindersFor(state, assignment.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ origin: "sdr", dueAt: "2026-09-03T15:00:00.000Z" });
  });

  // The whole reason the field exists: a blank follow-up field still creates a
  // reminder via defaultFollowUpDueAt, and it is titled exactly like a real one.
  it("tags a touch with no follow-up date as system, not sdr", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const assignment = seededAssignment(state, workspaceId);

    recordFirstTouch(state, {
      workspaceId,
      assignmentId: assignment.id,
      actorUserId: assignment.assignedSdrId,
      channel: "Call",
      outcome: "Contacted",
      notes: "Left a voicemail."
      // followUpDueAt deliberately omitted — the SDR scheduled nothing.
    });

    const reminders = openRemindersFor(state, assignment.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].origin).toBe("system");
    // ...and it is titled indistinguishably from an SDR-scheduled follow-up,
    // which is exactly why title text cannot be the filter.
    expect(reminders[0].title).toMatch(/^Follow up with /);
  });

  it("keeps auto-defaulted follow-ups off the Follow-ups directory end to end", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const assignment = seededAssignment(state, workspaceId);

    recordFirstTouch(state, {
      workspaceId,
      assignmentId: assignment.id,
      actorUserId: assignment.assignedSdrId,
      channel: "Call",
      outcome: "Contacted",
      notes: "Left a voicemail."
    });

    const rows = groupFollowUpsByContact(followUpSourceRowsSnapshot(state, workspaceId));
    expect(rows.some((row) => row.contactId === assignment.contactId)).toBe(false);
  });

  it("shows the contact once the SDR does schedule a follow-up", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const assignment = seededAssignment(state, workspaceId);

    recordFirstTouch(state, {
      workspaceId,
      assignmentId: assignment.id,
      actorUserId: assignment.assignedSdrId,
      channel: "Call",
      outcome: "Interested",
      notes: "Wants a call back Thursday.",
      followUpDueAt: "2026-09-03T15:00:00.000Z"
    });

    const rows = groupFollowUpsByContact(followUpSourceRowsSnapshot(state, workspaceId));
    const row = rows.find((item) => item.contactId === assignment.contactId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ openFollowUps: 1, nextDueAt: "2026-09-03T15:00:00.000Z" });
  });
});
