import { processLeadJobQueue, type LeadJobWorkerOptions, type LeadJobWorkerTickResult } from "@/lib/phase1/lead-job-worker";
import { leadJobWorkerWriteTables } from "@/lib/phase1/normalized-write-tables";
import { updateAuthState } from "@/lib/phase1/store";

export type LeadJobWorkerRunnerOptions = LeadJobWorkerOptions;

export async function runLeadJobWorkerTick(
  options: LeadJobWorkerRunnerOptions = {}
): Promise<LeadJobWorkerTickResult> {
  return updateAuthState(
    (state) => processLeadJobQueue(state, options),
    { normalizedTables: leadJobWorkerWriteTables }
  );
}
