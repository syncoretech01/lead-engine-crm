import { describe, expect, it } from "vitest";
import {
  exportReadRowsFromState,
  stateWithExportReadRows
} from "@/lib/phase1/export-read-path";
import {
  outreachEventReadRowsFromState,
  stateWithOutreachEventReadRows
} from "@/lib/phase1/outreach-read-path";
import { createSeedState } from "@/lib/phase1/seed";

describe("normalized outreach and export read paths", () => {
  it("extracts workspace-scoped outreach events", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.emailEvents.push({
      ...state.emailEvents[0],
      id: "email-other",
      workspaceId: otherWorkspaceId
    });
    state.smsEvents.push({
      ...state.smsEvents[0],
      id: "sms-other",
      workspaceId: otherWorkspaceId
    });
    state.trackedCalls.push({
      ...state.trackedCalls[0],
      id: "call-other",
      workspaceId: otherWorkspaceId
    });

    const rows = outreachEventReadRowsFromState(state, workspaceId);

    expect(rows.emailEvents.map((event) => event.id)).not.toContain("email-other");
    expect(rows.smsEvents.map((event) => event.id)).not.toContain("sms-other");
    expect(rows.trackedCalls.map((call) => call.id)).not.toContain("call-other");
  });

  it("replaces only active workspace outreach events", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.emailEvents.push({
      ...state.emailEvents[0],
      id: "email-other",
      workspaceId: otherWorkspaceId
    });

    const readState = stateWithOutreachEventReadRows(state, workspaceId, {
      emailEvents: [{ ...state.emailEvents[0], id: "email-normalized", workspaceId }],
      smsEvents: [{ ...state.smsEvents[0], id: "sms-normalized", workspaceId }],
      trackedCalls: [{ ...state.trackedCalls[0], id: "call-normalized", workspaceId }]
    });

    expect(readState.emailEvents.map((event) => event.id)).toContain("email-normalized");
    expect(readState.emailEvents.map((event) => event.id)).toContain("email-other");
    expect(readState.emailEvents.map((event) => event.id)).not.toContain(state.emailEvents[0].id);
    expect(readState.smsEvents.map((event) => event.id)).toEqual(["sms-normalized"]);
    expect(readState.trackedCalls.map((call) => call.id)).toEqual(["call-normalized"]);
  });

  it("extracts and replaces workspace-scoped export rows", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";
    const exportRecord = {
      id: "export-current",
      workspaceId,
      name: "Current workspace export",
      type: "contacts" as const,
      columns: ["contact"],
      recordIds: [state.contacts[0].id],
      recordCount: 1,
      createdById: state.users[0].id,
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "Ready" as const
    };

    state.exports.push(exportRecord, {
      ...exportRecord,
      id: "export-other",
      workspaceId: otherWorkspaceId
    });

    const exportIds = exportReadRowsFromState(state, workspaceId).map((row) => row.id);
    expect(exportIds).toContain("export-current");
    expect(exportIds).not.toContain("export-other");

    const readState = stateWithExportReadRows(state, workspaceId, [
      {
        ...exportRecord,
        id: "export-normalized"
      }
    ]);

    expect(readState.exports.map((row) => row.id)).toContain("export-normalized");
    expect(readState.exports.map((row) => row.id)).toContain("export-other");
    expect(readState.exports.map((row) => row.id)).not.toContain("export-current");
  });
});
