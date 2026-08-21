import type { AuditLog, FollowUpOrigin, FollowUpReminder } from "@/lib/phase1/types";

/**
 * Recovers `origin` for follow-ups created before the field existed.
 *
 * This is NOT a heuristic on due dates. The call wrap-up already recorded the
 * answer: `saveCallWrapupAction` pushes the literal string below onto its audit
 * receipt's `created` array only when the SDR actually supplied a follow-up date
 *
 *   if (followUpDueAt) created.push("Follow-up reminder + task");
 *
 * so a `call_wrapup_saved` audit entry states, as recorded fact, whether that
 * wrap-up's reminder was SDR-scheduled. Anything that cannot be tied back to
 * such a receipt stays unknown rather than being guessed into a bucket.
 */
export const WRAPUP_FOLLOW_UP_RECEIPT = "Follow-up reminder + task";

/**
 * The audit row and its reminder are written in the same request, so they share
 * an instant to within milliseconds — measured across the whole prod history,
 * 715 of 717 touch-created reminders sit within 100ms of their receipt.
 *
 * This window must stay TIGHT. A loose one lets a reminder with no receipt of
 * its own borrow a neighbour's: a second touch that creates no audit (the
 * direct-email / direct-SMS paths call `recordFirstTouch` without one) lands
 * seconds after a real wrap-up and inherits its verdict. That is not
 * hypothetical — at 60s exactly two rows borrowed, at 38.6s and 50.4s, and one
 * of them was wrongly published as SDR-scheduled.
 *
 * 2s keeps a ~20x margin over the real pairings and a ~19x margin under the
 * closest observed borrower.
 */
export const AUDIT_MATCH_WINDOW_MS = 2_000;

export type BackfillVerdict = {
  origin?: FollowUpOrigin;
  /** Why this row was classified the way it was — printed by the script. */
  reason:
    | "already-classified"
    | "wrapup-receipt-sdr"
    | "wrapup-receipt-system"
    | "first-touch-no-touch-audit"
    | "no-evidence"
    | "conflicting-receipts";
};

type WrapupAudit = Pick<AuditLog, "objectType" | "objectId" | "action" | "newValue" | "createdAt">;

function wrapupSetAFollowUp(audit: WrapupAudit): boolean | undefined {
  const value = audit.newValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const created = (value as { created?: unknown }).created;
  if (!Array.isArray(created)) return undefined;
  return created.includes(WRAPUP_FOLLOW_UP_RECEIPT);
}

/**
 * Classifies one legacy reminder. Returns `origin: undefined` whenever the
 * evidence is missing or self-contradictory — an unknown row is correct, a
 * wrongly-attributed one is not.
 */
export function classifyLegacyFollowUpOrigin(
  reminder: Pick<FollowUpReminder, "assignmentId" | "title" | "createdAt" | "origin">,
  auditsByAssignment: ReadonlyMap<string, WrapupAudit[]>
): BackfillVerdict {
  if (reminder.origin) {
    return { origin: reminder.origin, reason: "already-classified" };
  }

  const createdAt = Date.parse(reminder.createdAt);
  const candidates = (auditsByAssignment.get(reminder.assignmentId) ?? [])
    .map((audit) => ({ audit, distance: Math.abs(Date.parse(audit.createdAt) - createdAt) }))
    .filter((entry) => Number.isFinite(entry.distance) && entry.distance <= AUDIT_MATCH_WINDOW_MS)
    .sort((left, right) => left.distance - right.distance);

  if (candidates.length > 0) {
    // Several wrap-ups can land inside the window for one assignment. Trust the
    // closest; if others are exactly as close and disagree, trust none of them.
    const nearest = candidates[0].distance;
    const tied = candidates.filter((entry) => entry.distance === nearest);
    const verdicts = new Set(tied.map((entry) => wrapupSetAFollowUp(entry.audit)));
    if (verdicts.size === 1) {
      const [verdict] = [...verdicts];
      if (verdict === true) return { origin: "sdr", reason: "wrapup-receipt-sdr" };
      if (verdict === false) return { origin: "system", reason: "wrapup-receipt-system" };
    } else if (verdicts.size > 1) {
      return { reason: "conflicting-receipts" };
    }
  }

  // A "First touch ..." reminder with no touch audit beside it was created by
  // assignment or bulk routing. That path never takes an SDR-supplied date, so
  // this is a fact about the code, not an inference about the data.
  if (/^first[\s-]+touch\b/i.test(reminder.title.trim())) {
    return { origin: "system", reason: "first-touch-no-touch-audit" };
  }

  return { reason: "no-evidence" };
}

/** Groups the wrap-up receipts once so the classifier stays O(1) per reminder. */
export function indexWrapupAudits(auditLogs: readonly AuditLog[]): Map<string, WrapupAudit[]> {
  const index = new Map<string, WrapupAudit[]>();
  for (const audit of auditLogs) {
    if (audit.objectType !== "sdr_assignment" || audit.action !== "call_wrapup_saved") continue;
    const list = index.get(audit.objectId);
    if (list) list.push(audit);
    else index.set(audit.objectId, [audit]);
  }
  return index;
}

export type BackfillSummary = Record<BackfillVerdict["reason"], number> & {
  scanned: number;
  updated: number;
};

/**
 * Applies the classification to a snapshot's reminders in place and reports what
 * happened. Idempotent: rows that already carry an origin are never rewritten.
 */
export function backfillFollowUpOrigins(
  reminders: FollowUpReminder[],
  auditLogs: readonly AuditLog[],
  options?: {
    /**
     * Re-evaluate rows created before this instant even if they already carry an
     * origin, so a correction to the matching rules can undo an earlier verdict.
     * Only safe for rows that predate live origin-writing — anything the app
     * itself tagged is authoritative and must never be recomputed.
     */
    reclassifyCreatedBefore?: string;
  }
): BackfillSummary {
  const index = indexWrapupAudits(auditLogs);
  const reclassifyBefore = options?.reclassifyCreatedBefore
    ? Date.parse(options.reclassifyCreatedBefore)
    : undefined;
  const summary: BackfillSummary = {
    scanned: 0,
    updated: 0,
    "already-classified": 0,
    "wrapup-receipt-sdr": 0,
    "wrapup-receipt-system": 0,
    "first-touch-no-touch-audit": 0,
    "no-evidence": 0,
    "conflicting-receipts": 0
  };

  for (const reminder of reminders) {
    summary.scanned += 1;
    const eligibleForReclassify =
      reclassifyBefore !== undefined && Date.parse(reminder.createdAt) < reclassifyBefore;
    const previous = reminder.origin;
    const verdict = classifyLegacyFollowUpOrigin(
      eligibleForReclassify ? { ...reminder, origin: undefined } : reminder,
      index
    );
    summary[verdict.reason] += 1;
    if (verdict.reason === "already-classified") continue;
    // On a reclassify pass an origin that no longer holds up is CLEARED, not
    // left behind — a stale verdict is exactly what this pass exists to undo.
    if (eligibleForReclassify ? verdict.origin === previous : !verdict.origin) continue;
    reminder.origin = verdict.origin;
    summary.updated += 1;
  }

  return summary;
}
