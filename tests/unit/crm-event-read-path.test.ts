import { describe, expect, it } from "vitest";
import {
  crmEventReadRowsFromState,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { createSeedState } from "@/lib/phase1/seed";

describe("normalized CRM event read path", () => {
  it("extracts workspace-scoped CRM event rows", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.opportunities.push({
      ...state.opportunities[0],
      id: "opp-other",
      workspaceId: otherWorkspaceId
    });
    state.activities.push({
      ...state.activities[0],
      id: "activity-other",
      workspaceId: otherWorkspaceId
    });
    state.tasks.push({
      ...state.tasks[0],
      id: "task-other",
      workspaceId: otherWorkspaceId
    });

    const rows = crmEventReadRowsFromState(state, workspaceId);

    expect(rows.opportunities.map((row) => row.id)).not.toContain("opp-other");
    expect(rows.activities.map((row) => row.id)).not.toContain("activity-other");
    expect(rows.tasks.map((row) => row.id)).not.toContain("task-other");
    expect(rows.notes.length).toBeGreaterThan(0);
    expect(rows.callLogs.length).toBeGreaterThan(0);
  });

  it("replaces only active workspace CRM event rows", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.notes.push({
      ...state.notes[0],
      id: "note-other",
      workspaceId: otherWorkspaceId
    });

    const readState = stateWithCrmEventReadRows(state, workspaceId, {
      opportunities: [
        {
          ...state.opportunities[0],
          id: "opp-normalized",
          workspaceId
        }
      ],
      activities: [
        {
          ...state.activities[0],
          id: "activity-normalized",
          workspaceId
        }
      ],
      tasks: [
        {
          ...state.tasks[0],
          id: "task-normalized",
          workspaceId
        }
      ],
      notes: [
        {
          ...state.notes[0],
          id: "note-normalized",
          workspaceId
        }
      ],
      callLogs: [
        {
          ...state.callLogs[0],
          id: "call-normalized",
          workspaceId
        }
      ]
    });

    expect(readState.opportunities.map((row) => row.id)).toContain("opp-normalized");
    expect(readState.opportunities.map((row) => row.id)).not.toContain(state.opportunities[0].id);
    expect(readState.activities.map((row) => row.id)).toContain("activity-normalized");
    expect(readState.tasks.map((row) => row.id)).toContain("task-normalized");
    expect(readState.notes.map((row) => row.id)).toContain("note-normalized");
    expect(readState.notes.map((row) => row.id)).toContain("note-other");
    expect(readState.callLogs.map((row) => row.id)).toEqual(["call-normalized"]);
  });
});
