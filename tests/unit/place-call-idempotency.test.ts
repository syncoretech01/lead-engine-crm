import { describe, expect, it } from "vitest";

import { findPlacedCallReceipt } from "@/lib/phase1/call-wrapup-idempotency";
import type { AuditLog } from "@/lib/phase1/types";

// placeCallAction generated a requestId and wrote it into the audit row, but never
// looked it up — so the field implied protection it did not give, and a replayed
// request rang the lead a SECOND time. These cover the lookup that makes it real.

function auditRow(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "audit-1",
    workspaceId: "workspace-acme",
    actorUserId: "user-sdr",
    objectType: "tracked_call",
    objectId: "call-1",
    action: "call_placed",
    newValue: { providerCallId: "ringout-1", liveState: "ringing", requestId: "call-contact-1-123" },
    createdAt: "2026-08-29T12:00:00.000Z",
    ...overrides
  } as AuditLog;
}

describe("placed-call receipt lookup", () => {
  it("returns the existing call for a replayed requestId", () => {
    expect(
      findPlacedCallReceipt([auditRow()], { workspaceId: "workspace-acme", requestId: "call-contact-1-123" })
    ).toEqual({ callId: "call-1", liveState: "ringing" });
  });

  it("matches a failed placement too, so a retry does not re-dial after a provider error", () => {
    const failed = auditRow({ action: "call_failed", newValue: { liveState: "failed", requestId: "req-9" } });
    expect(findPlacedCallReceipt([failed], { workspaceId: "workspace-acme", requestId: "req-9" })).toEqual({
      callId: "call-1",
      liveState: "failed"
    });
  });

  it("does not match across workspaces, other request ids, or unrelated audit rows", () => {
    const rows = [auditRow()];
    expect(findPlacedCallReceipt(rows, { workspaceId: "workspace-other", requestId: "call-contact-1-123" })).toBeUndefined();
    expect(findPlacedCallReceipt(rows, { workspaceId: "workspace-acme", requestId: "different" })).toBeUndefined();
    expect(
      findPlacedCallReceipt([auditRow({ objectType: "sdr_assignment", action: "call_wrapup_saved" })], {
        workspaceId: "workspace-acme",
        requestId: "call-contact-1-123"
      })
    ).toBeUndefined();
  });

  it("survives audit rows with missing or malformed newValue", () => {
    const rows = [
      auditRow({ id: "a", newValue: undefined }),
      auditRow({ id: "b", newValue: "not-an-object" as unknown as AuditLog["newValue"] }),
      auditRow({ id: "c", newValue: [] as unknown as AuditLog["newValue"] })
    ];
    expect(findPlacedCallReceipt(rows, { workspaceId: "workspace-acme", requestId: "call-contact-1-123" })).toBeUndefined();
  });
});
