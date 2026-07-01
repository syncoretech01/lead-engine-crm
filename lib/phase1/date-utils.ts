/**
 * Day-equality helpers standardized on UTC.
 *
 * "Due today" style metrics were computed inconsistently — the SDR queue used
 * UTC while the CRM overview and lead/SDR snapshot queries used the server's
 * local timezone, so the same reminder could count as "today" on one surface
 * and not another. These helpers give every surface one timezone-stable basis
 * (UTC), independent of where the server runs. See P2.6.
 *
 * UTC is a deliberate default; per-workspace timezone support can layer on
 * later by adding Workspace.timezone and threading it through here.
 */

export function isSameUtcDay(left: string | Date, right: string | Date): boolean {
  const a = left instanceof Date ? left : new Date(left);
  const b = right instanceof Date ? right : new Date(right);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isUtcToday(value: string | Date, now: Date = new Date()): boolean {
  return isSameUtcDay(value, now);
}
