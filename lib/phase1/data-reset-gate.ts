/**
 * Gate for resetPhase1DataAction — the button that replaces the entire
 * AppStateSnapshot with demo seed data. In development that is a convenience; in
 * production it is a one-click wipe of every contact, call log, note and user,
 * followed by the projection sync deleting the real rows from all ~70 tables.
 * Recovery is RDS point-in-time restore plus downtime — git revert cannot help.
 *
 * So: never available in production unless the operator sets
 * SYNCORE_ALLOW_DATA_RESET=true for the occasion. The /compliance page uses the
 * same predicate to not render the form at all, but the server-side check in the
 * action is the one that counts.
 */
export function dataResetAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.SYNCORE_ALLOW_DATA_RESET === "true";
}
