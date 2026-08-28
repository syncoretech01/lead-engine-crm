import { describe, expect, it } from "vitest";

import { calculateSlaStatus, reminderStatusForDueAt } from "@/lib/phase1/sdr";
import type { SdrAssignment } from "@/lib/phase1/types";

// The bug these guard: the stored slaStatus/reminder status columns only advance
// when something writes. Prod reads through the Prisma fast paths, so an
// assignment that lapsed overnight kept reporting "On track" in the queue and in
// the manager's overdue/slaAdherence metrics — while its own live timer label
// said "14h overdue". Read models now call these pure functions instead.

const NOW = "2026-08-29T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

function assignment(overrides: Partial<SdrAssignment> = {}): SdrAssignment {
  return {
    id: "assignment-1",
    workspaceId: "workspace-acme",
    companyId: "company-1",
    contactId: "contact-1",
    assignedSdrId: "user-sdr",
    assignedById: "user-manager",
    assignmentMethod: "Round robin",
    assignmentReason: "Test",
    assignedAt: "2026-08-28T12:00:00.000Z",
    status: "Assigned",
    slaStatus: "On track",
    touchCount: 0,
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:00:00.000Z",
    ...overrides
  } as SdrAssignment;
}

describe("SLA status computed at read time", () => {
  it("reports Overdue for a lapsed first-touch deadline even when the column says On track", () => {
    const lapsed = assignment({
      firstTouchDueAt: new Date(Date.parse(NOW) - 14 * HOUR).toISOString(),
      slaStatus: "On track"
    });
    expect(calculateSlaStatus(lapsed, NOW)).toBe("Overdue");
  });

  it("uses the follow-up deadline once the lead has been touched", () => {
    const touched = assignment({
      firstTouchedAt: "2026-08-28T13:00:00.000Z",
      firstTouchDueAt: new Date(Date.parse(NOW) - 20 * HOUR).toISOString(),
      followUpDueAt: new Date(Date.parse(NOW) + 6 * HOUR).toISOString()
    });
    expect(calculateSlaStatus(touched, NOW)).toBe("On track");
  });

  it("warns Due soon inside the two-hour window", () => {
    expect(
      calculateSlaStatus(assignment({ firstTouchDueAt: new Date(Date.parse(NOW) + HOUR).toISOString() }), NOW)
    ).toBe("Due soon");
  });

  it("keeps terminal and paused states out of the SLA clock", () => {
    const past = new Date(Date.parse(NOW) - HOUR).toISOString();
    expect(calculateSlaStatus(assignment({ firstTouchDueAt: past, callCycleCompletedAt: NOW }), NOW)).toBe("No SLA");
    expect(calculateSlaStatus(assignment({ firstTouchDueAt: past, status: "Suppressed" }), NOW)).toBe("Paused");
    expect(calculateSlaStatus(assignment({ firstTouchDueAt: past, status: "Disqualified" }), NOW)).toBe("No SLA");
    expect(calculateSlaStatus(assignment({}), NOW)).toBe("No SLA");
  });
});

describe("reminder status computed at read time", () => {
  it("reports Overdue past the due time and Open before it", () => {
    expect(reminderStatusForDueAt(new Date(Date.parse(NOW) - HOUR).toISOString(), NOW)).toBe("Overdue");
    expect(reminderStatusForDueAt(new Date(Date.parse(NOW) + HOUR).toISOString(), NOW)).toBe("Open");
  });
});
