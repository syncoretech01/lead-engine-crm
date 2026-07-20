import type { SdrLeadStatus } from "@/lib/phase1/types";

export const SDR_DAILY_CALL_TARGET = 150;

const callableStatuses = new Set<SdrLeadStatus>([
  "New",
  "Assigned",
  "Working",
  "Contacted",
  "Opened",
  "Replied",
  "Interested",
  "Meeting Booked",
  "Qualified",
  "Proposal Sent",
  "Nurture"
]);

export type SdrCallCycleRow = {
  assignedSdrId: string;
  assignedAt: string;
  status: SdrLeadStatus;
  phone: string;
  doNotContact?: boolean;
  isSuppressed?: boolean;
  firstCallCompletedAt?: string;
  secondCallCompletedAt?: string;
  callCycleCompletedAt?: string;
};

export type SdrDailyCallPlan<T extends SdrCallCycleRow> = {
  assignments: T[];
  target: number;
  completedToday: number;
  remainingToday: number;
  pass: 1 | 2 | null;
  activeBatchSize: number;
  batchRemaining: number;
};

export function isCurrentCallCycleAssignment(
  assignment: Pick<
    SdrCallCycleRow,
    "status" | "phone" | "doNotContact" | "isSuppressed" | "callCycleCompletedAt"
  >
) {
  return Boolean(
    !assignment.callCycleCompletedAt &&
      assignment.phone.trim() &&
      !assignment.doNotContact &&
      !assignment.isSuppressed &&
      callableStatuses.has(assignment.status)
  );
}

export function buildSdrDailyCallPlan<T extends SdrCallCycleRow>(
  assignments: T[],
  sdrUserId: string,
  completedToday: number,
  target = SDR_DAILY_CALL_TARGET
): SdrDailyCallPlan<T> {
  const active = assignments.filter(
    (assignment) => assignment.assignedSdrId === sdrUserId && isCurrentCallCycleAssignment(assignment)
  );
  const firstPass = active.filter((assignment) => !assignment.firstCallCompletedAt);
  const pass: 1 | 2 | null = firstPass.length ? 1 : active.length ? 2 : null;
  const pending = pass === 1
    ? firstPass
    : pass === 2
      ? active.filter((assignment) => !assignment.secondCallCompletedAt)
      : [];
  const remainingToday = Math.max(0, target - completedToday);

  return {
    assignments: pending.slice(0, remainingToday),
    target,
    completedToday,
    remainingToday,
    pass,
    activeBatchSize: active.length,
    batchRemaining: pending.length
  };
}
