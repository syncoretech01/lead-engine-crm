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
