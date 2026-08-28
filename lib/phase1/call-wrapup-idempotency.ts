import type { AuditLog } from "@/lib/phase1/types";

type CallWrapupReceiptLookup = {
  workspaceId: string;
  assignmentId: string;
  requestId: string;
};

/**
 * A committed wrap-up leaves an audit receipt in the same atomic snapshot
 * transaction. Reusing its request ID therefore returns success without
 * repeating any notes, tasks, opportunities, call-cycle, or session effects.
 */
export function findCallWrapupReceipt(
  auditLogs: readonly AuditLog[],
  input: CallWrapupReceiptLookup
): string[] | undefined {
  const receipt = auditLogs.find((entry) => {
    if (
      entry.workspaceId !== input.workspaceId ||
      entry.objectType !== "sdr_assignment" ||
      entry.objectId !== input.assignmentId ||
      entry.action !== "call_wrapup_saved" ||
      !entry.newValue ||
      typeof entry.newValue !== "object" ||
      Array.isArray(entry.newValue)
    ) {
      return false;
    }
    return (entry.newValue as { requestId?: unknown }).requestId === input.requestId;
  });

  if (!receipt) return undefined;
  const created = (receipt.newValue as { created?: unknown }).created;
  return Array.isArray(created)
    ? created.filter((item): item is string => typeof item === "string")
    : [];
}

type PlacedCallReceiptLookup = {
  workspaceId: string;
  requestId: string;
};

/**
 * placeCallAction writes a `call_placed` / `call_failed` audit row carrying its
 * requestId in the SAME transaction that records the TrackedCall, so that row is
 * a receipt: if one exists, this dial already happened and must not be dialled
 * again. Without this lookup the requestId was inert — a retry (or a double
 * submit) placed a second REAL phone call to the lead.
 */
export function findPlacedCallReceipt(
  auditLogs: readonly AuditLog[],
  input: PlacedCallReceiptLookup
): { callId: string; liveState?: string } | undefined {
  const receipt = auditLogs.find((entry) => {
    if (
      entry.workspaceId !== input.workspaceId ||
      entry.objectType !== "tracked_call" ||
      (entry.action !== "call_placed" && entry.action !== "call_failed") ||
      !entry.newValue ||
      typeof entry.newValue !== "object" ||
      Array.isArray(entry.newValue)
    ) {
      return false;
    }
    return (entry.newValue as { requestId?: unknown }).requestId === input.requestId;
  });

  if (!receipt) return undefined;
  const liveState = (receipt.newValue as { liveState?: unknown }).liveState;
  return { callId: receipt.objectId, liveState: typeof liveState === "string" ? liveState : undefined };
}
