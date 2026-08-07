import { describe, expect, it } from "vitest";

import { findCallWrapupReceipt } from "@/lib/phase1/call-wrapup-idempotency";
import type { AuditLog } from "@/lib/phase1/types";

const receipt: AuditLog = {
  id: "audit-wrapup",
  workspaceId: "workspace-1",
  actorUserId: "user-1",
  objectType: "sdr_assignment",
  objectId: "assignment-1",
  action: "call_wrapup_saved",
  newValue: {
    requestId: "wrapup-request-1",
    created: ["Lead status → Contacted", "Call note"]
  },
  createdAt: "2026-08-07T12:00:00.000Z"
};

describe("call wrap-up idempotency", () => {
  it("returns the committed receipt for the same scoped request", () => {
    expect(findCallWrapupReceipt([receipt], {
      workspaceId: "workspace-1",
      assignmentId: "assignment-1",
      requestId: "wrapup-request-1"
    })).toEqual(["Lead status → Contacted", "Call note"]);
  });

  it("does not match a request from another workspace or assignment", () => {
    expect(findCallWrapupReceipt([receipt], {
      workspaceId: "workspace-2",
      assignmentId: "assignment-1",
      requestId: "wrapup-request-1"
    })).toBeUndefined();
    expect(findCallWrapupReceipt([receipt], {
      workspaceId: "workspace-1",
      assignmentId: "assignment-2",
      requestId: "wrapup-request-1"
    })).toBeUndefined();
  });
});
