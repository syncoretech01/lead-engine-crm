import { describe, expect, it } from "vitest";

import {
  backfillFollowUpOrigins,
  classifyLegacyFollowUpOrigin,
  indexWrapupAudits,
  WRAPUP_FOLLOW_UP_RECEIPT
} from "@/lib/phase1/follow-up-origin-backfill";
import type { AuditLog, FollowUpReminder } from "@/lib/phase1/types";

function wrapupAudit(overrides: {
  objectId: string;
  createdAt: string;
  created: string[];
}): AuditLog {
  return {
    id: `audit-${overrides.objectId}-${overrides.createdAt}`,
    workspaceId: "workspace-1",
    actorUserId: "user-sdr",
    objectType: "sdr_assignment",
    objectId: overrides.objectId,
    action: "call_wrapup_saved",
    newValue: {
      requestId: "req-1",
      outcome: "Connected",
      leadStatus: "Contacted",
      created: overrides.created
    },
    createdAt: overrides.createdAt
  } as AuditLog;
}

function reminder(overrides: Partial<FollowUpReminder> = {}): FollowUpReminder {
  return {
    id: "reminder-1",
    workspaceId: "workspace-1",
    assignmentId: "assign-1",
    companyId: "company-1",
    contactId: "contact-1",
    ownerUserId: "user-sdr",
    title: "Follow up with Kimberly Reed",
    channel: "Call",
    dueAt: "2026-08-24T10:00:00.000Z",
    status: "Open",
    createdAt: "2026-08-22T12:00:00.000Z",
    ...overrides
  } as FollowUpReminder;
}

const LEAD_STATUS_ONLY = ["Lead status -> Contacted"];
const WITH_FOLLOW_UP = ["Lead status -> Contacted", WRAPUP_FOLLOW_UP_RECEIPT];

describe("follow-up origin backfill", () => {
  it("reads the wrap-up receipt as recorded fact when the SDR set a date", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:01.000Z", created: WITH_FOLLOW_UP })
    ]);

    expect(classifyLegacyFollowUpOrigin(reminder(), audits)).toEqual({
      origin: "sdr",
      reason: "wrapup-receipt-sdr"
    });
  });

  it("reads the same receipt as system when the SDR set no date", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:01.000Z", created: LEAD_STATUS_ONLY })
    ]);

    expect(classifyLegacyFollowUpOrigin(reminder(), audits)).toEqual({
      origin: "system",
      reason: "wrapup-receipt-system"
    });
  });

  // Regression: a second touch that writes no audit of its own (the direct-email
  // and direct-SMS paths call recordFirstTouch without one) lands seconds after a
  // real wrap-up on the SAME assignment. With a loose window it inherited that
  // wrap-up's verdict and was published as SDR-scheduled. Two prod rows did this,
  // at 38.6s and 50.4s; every genuine pairing is inside 100ms.
  it("does not let a reminder borrow a neighbouring wrap-up's receipt", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-05T17:40:37.308Z", created: WITH_FOLLOW_UP })
    ]);
    const secondTouch = reminder({
      title: "Next step with Lachunda Hunter",
      createdAt: "2026-08-05T17:41:27.731Z"
    });

    expect(classifyLegacyFollowUpOrigin(secondTouch, audits).reason).toBe("no-evidence");
    expect(classifyLegacyFollowUpOrigin(secondTouch, audits).origin).toBeUndefined();
  });

  it("still pairs a reminder with the receipt written milliseconds later", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-05T17:40:37.308Z", created: WITH_FOLLOW_UP })
    ]);
    const sameRequest = reminder({ createdAt: "2026-08-05T17:40:37.306Z" });

    expect(classifyLegacyFollowUpOrigin(sameRequest, audits)).toEqual({
      origin: "sdr",
      reason: "wrapup-receipt-sdr"
    });
  });

  it("clears a verdict that no longer holds up on a reclassify pass", () => {
    const rows = [
      reminder({
        id: "r-borrowed",
        title: "Next step with Lachunda Hunter",
        createdAt: "2026-08-05T17:41:27.731Z",
        origin: "sdr"
      })
    ];
    const auditLogs = [
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-05T17:40:37.308Z", created: WITH_FOLLOW_UP })
    ];

    // Without the flag the stale verdict survives, because the row looks classified.
    backfillFollowUpOrigins(rows, auditLogs);
    expect(rows[0].origin).toBe("sdr");

    const summary = backfillFollowUpOrigins(rows, auditLogs, {
      reclassifyCreatedBefore: "2026-08-21T00:00:00.000Z"
    });
    expect(rows[0].origin).toBeUndefined();
    expect(summary).toMatchObject({ updated: 1, "no-evidence": 1 });
  });

  it("leaves rows created after the reclassify cutoff alone", () => {
    const rows = [
      reminder({ id: "r-live", createdAt: "2026-09-01T10:00:00.000Z", origin: "sdr" })
    ];

    backfillFollowUpOrigins(rows, [], { reclassifyCreatedBefore: "2026-08-21T00:00:00.000Z" });
    expect(rows[0].origin).toBe("sdr");
  });

  it("ignores a receipt from a different assignment or outside the window", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-OTHER", createdAt: "2026-08-22T12:00:01.000Z", created: WITH_FOLLOW_UP }),
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T13:30:00.000Z", created: WITH_FOLLOW_UP })
    ]);

    // Falls through to the title rule rather than borrowing an unrelated receipt.
    expect(classifyLegacyFollowUpOrigin(reminder(), audits).reason).toBe("no-evidence");
  });

  it("prefers the nearest receipt when several land in the window", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:01.500Z", created: LEAD_STATUS_ONLY }),
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:00.050Z", created: WITH_FOLLOW_UP })
    ]);

    expect(classifyLegacyFollowUpOrigin(reminder(), audits)).toEqual({
      origin: "sdr",
      reason: "wrapup-receipt-sdr"
    });
  });

  it("refuses to classify when equally-near receipts disagree", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:00.500Z", created: WITH_FOLLOW_UP }),
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T11:59:59.500Z", created: LEAD_STATUS_ONLY })
    ]);

    expect(classifyLegacyFollowUpOrigin(reminder(), audits)).toEqual({ reason: "conflicting-receipts" });
  });

  it("classifies a first-touch reminder with no touch beside it as system", () => {
    const verdict = classifyLegacyFollowUpOrigin(
      reminder({ title: "First touch Kimberly Reed" }),
      indexWrapupAudits([])
    );

    expect(verdict).toEqual({ origin: "system", reason: "first-touch-no-touch-audit" });
  });

  it("leaves a reminder with no evidence unknown rather than guessing", () => {
    expect(classifyLegacyFollowUpOrigin(reminder(), indexWrapupAudits([]))).toEqual({ reason: "no-evidence" });
  });

  it("never rewrites a row that already carries an origin", () => {
    const audits = indexWrapupAudits([
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:01.000Z", created: WITH_FOLLOW_UP })
    ]);

    expect(classifyLegacyFollowUpOrigin(reminder({ origin: "system" }), audits)).toEqual({
      origin: "system",
      reason: "already-classified"
    });
  });

  it("applies in place, is idempotent, and reports what it did", () => {
    const rows = [
      reminder({ id: "r-sdr", assignmentId: "assign-1" }),
      reminder({ id: "r-system", assignmentId: "assign-2" }),
      reminder({ id: "r-first", assignmentId: "assign-3", title: "First touch Michael" }),
      reminder({ id: "r-unknown", assignmentId: "assign-4" })
    ];
    const auditLogs = [
      wrapupAudit({ objectId: "assign-1", createdAt: "2026-08-22T12:00:01.000Z", created: WITH_FOLLOW_UP }),
      wrapupAudit({ objectId: "assign-2", createdAt: "2026-08-22T12:00:01.000Z", created: LEAD_STATUS_ONLY })
    ];

    const first = backfillFollowUpOrigins(rows, auditLogs);
    expect(first).toMatchObject({ scanned: 4, updated: 3, "no-evidence": 1 });
    expect(rows.map((row) => row.origin)).toEqual(["sdr", "system", "system", undefined]);

    // Re-running changes nothing further.
    const second = backfillFollowUpOrigins(rows, auditLogs);
    expect(second).toMatchObject({ scanned: 4, updated: 0, "already-classified": 3, "no-evidence": 1 });
  });
});
