import { describe, expect, it } from "vitest";
import { createDataSubjectRequest } from "@/lib/phase1/compliance";
import {
  complianceReadRowsFromState,
  stateWithComplianceReadRows
} from "@/lib/phase1/compliance-read-path";
import { createSeedState } from "@/lib/phase1/seed";

describe("normalized compliance read path", () => {
  it("extracts workspace-scoped suppression, privacy request, and audit rows", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.workspaces.push({
      ...state.workspaces[0],
      id: otherWorkspaceId,
      name: "Other Workspace"
    });
    state.suppressionRecords.push({
      ...state.suppressionRecords[0],
      id: "supp-other",
      workspaceId: otherWorkspaceId
    });
    state.auditLogs.push({
      ...state.auditLogs[0],
      id: "audit-other",
      workspaceId: otherWorkspaceId
    });
    createDataSubjectRequest(state, {
      workspaceId,
      requestType: "Deletion",
      email: state.contacts[0].email
    });

    const rows = complianceReadRowsFromState(state, workspaceId);

    expect(rows.suppressionRecords.map((record) => record.id)).not.toContain("supp-other");
    expect(rows.auditLogs.map((log) => log.id)).not.toContain("audit-other");
    expect(rows.dataSubjectRequests).toHaveLength(1);
    expect(rows.dataSubjectRequests[0].workspaceId).toBe(workspaceId);
  });

  it("replaces only the active workspace rows when normalized rows are applied", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const otherWorkspaceId = "workspace-other";

    state.suppressionRecords.push({
      ...state.suppressionRecords[0],
      id: "supp-other",
      workspaceId: otherWorkspaceId
    });
    state.auditLogs.push({
      ...state.auditLogs[0],
      id: "audit-other",
      workspaceId: otherWorkspaceId
    });

    const readState = stateWithComplianceReadRows(state, workspaceId, {
      suppressionRecords: [
        {
          id: "supp-normalized",
          workspaceId,
          type: "Unsubscribe",
          email: "normalized@example.com",
          reason: "Normalized read",
          source: "Unit test",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      dataSubjectRequests: [
        {
          id: "dsr-normalized",
          workspaceId,
          requestType: "Access",
          status: "Open",
          email: "normalized@example.com",
          requestedAt: "2026-01-01T00:00:00.000Z",
          dueAt: "2026-01-31T00:00:00.000Z",
          notes: "Normalized read"
        }
      ],
      auditLogs: [
        {
          id: "audit-normalized",
          workspaceId,
          actorUserId: "user-nora",
          objectType: "suppression",
          objectId: "supp-normalized",
          action: "created",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    });

    expect(readState.suppressionRecords.some((record) => record.id === "supp-normalized")).toBe(true);
    expect(readState.suppressionRecords.some((record) => record.id === state.suppressionRecords[0].id)).toBe(false);
    expect(readState.suppressionRecords.some((record) => record.id === "supp-other")).toBe(true);
    expect(readState.dataSubjectRequests.map((request) => request.id)).toEqual(["dsr-normalized"]);
    expect(readState.auditLogs.some((log) => log.id === "audit-normalized")).toBe(true);
    expect(readState.auditLogs.some((log) => log.id === "audit-other")).toBe(true);
  });
});
