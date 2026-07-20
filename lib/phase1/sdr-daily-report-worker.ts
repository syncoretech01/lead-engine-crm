import { sdrDailyReportWriteTables } from "@/lib/phase1/normalized-write-tables";
import { countMissingSdrDailyReports, generateDueSdrDailyReports } from "@/lib/phase1/sdr-daily-report";
import { readState, updateAuthState } from "@/lib/phase1/store";

export type SdrDailyReportWorkerTick = { created: number; reportDates: string[] };

/** Runs every background-worker tick. The read-only preflight makes the common
 * path cheap; the write is entered only when a 4 AM PKT report is missing. */
export async function runSdrDailyReportWorkerTick(
  options: { now?: string; workspaceId?: string; lookbackDays?: number } = {}
): Promise<SdrDailyReportWorkerTick> {
  const state = await readState();
  if (countMissingSdrDailyReports(state, options) === 0) return { created: 0, reportDates: [] };
  return updateAuthState(
    (draft) => generateDueSdrDailyReports(draft, options),
    { normalizedTables: sdrDailyReportWriteTables }
  );
}
