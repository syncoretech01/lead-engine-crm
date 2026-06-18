import { providerJobWriteTables } from "@/lib/phase1/normalized-write-tables";
import {
  applyLiveProviderRunOutcome,
  invokeLiveProviderAdapter,
  planLiveProviderRun,
  type LiveProviderRunPlan
} from "@/lib/phase1/provider-live-execution";
import {
  processProviderJobQueue,
  providerCallsInWindow,
  providerConnectionForRun,
  type ProviderWorkerExecutionResult,
  type ProviderWorkerTickResult
} from "@/lib/phase1/provider-worker";
import { updateAuthState } from "@/lib/phase1/store";
import { resolveProviderExecutionMode } from "@/lib/providers/live-adapters";
import type { AppState } from "@/lib/phase1/types";

export type ProviderWorkerRunnerOptions = {
  workerId?: string;
  workspaceId?: string;
  maxLiveRuns?: number;
  now?: string;
};

export type LiveDrainSelection = {
  plans: LiveProviderRunPlan[];
  skipped: ProviderWorkerExecutionResult[];
};

export type ProviderWorkerTick = {
  mock: ProviderWorkerTickResult;
  live: { executed: number; results: ProviderWorkerExecutionResult[] };
};

const defaultWorkerId = "syncore-provider-worker";

/**
 * Pure (sync, state-bound) selection of live runs that are due to execute this
 * tick: live-mode, queued, within the per-minute rate limit. Each selected run
 * is claimed and planned (which also applies budget rules and resolves the
 * credential), so the returned plans are ready to invoke out-of-band. Kept
 * separate from the store glue below so the selection logic is unit-testable.
 */
export function collectDueLiveProviderPlans(
  state: AppState,
  options: { workerId: string; workspaceId?: string; maxLiveRuns?: number; now?: string }
): LiveDrainSelection {
  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const plans: LiveProviderRunPlan[] = [];
  const skipped: ProviderWorkerExecutionResult[] = [];

  for (const run of state.providerJobRuns) {
    if (run.status !== "Queued") continue;
    if (options.workspaceId && run.workspaceId !== options.workspaceId) continue;

    const connection = providerConnectionForRun(state, run);
    if (resolveProviderExecutionMode(connection?.executionMode) !== "live") continue;

    const limitPerMinute = connection?.rateLimitPerMinute ?? 0;
    if (limitPerMinute > 0 && providerCallsInWindow(state, run, nowMs) >= limitPerMinute) {
      continue; // leave queued; a later tick (inside the window) will pick it up
    }

    const planResult = planLiveProviderRun(state, run.id, {
      workerId: options.workerId,
      workspaceId: run.workspaceId,
      now
    });
    if (planResult.ok) plans.push(planResult.plan);
    else skipped.push(planResult.result);

    if (options.maxLiveRuns && plans.length >= options.maxLiveRuns) break;
  }

  return { plans, skipped };
}

/**
 * One worker tick, intended to be driven by a hosted cron/interval. Runs
 * session-less via `updateAuthState` (a background process has no user
 * session). Three store transactions bracket the async network calls so a DB
 * transaction is never held open across provider I/O:
 *   1. mock queue (handles mock runs, defers live + rate-limited runs)
 *   2. claim + plan due live runs (decrypts credentials into the plans)
 *   3. for each plan: invoke the adapter (async, no state), then apply the outcome
 */
export async function runProviderWorkerTick(
  options: ProviderWorkerRunnerOptions = {}
): Promise<ProviderWorkerTick> {
  const workerId = options.workerId ?? defaultWorkerId;

  const mock = await updateAuthState(
    (state) => processProviderJobQueue(state, { workerId, workspaceId: options.workspaceId, now: options.now }),
    { normalizedTables: providerJobWriteTables }
  );

  const { plans, skipped } = await updateAuthState(
    (state) =>
      collectDueLiveProviderPlans(state, {
        workerId,
        workspaceId: options.workspaceId,
        maxLiveRuns: options.maxLiveRuns,
        now: options.now
      }),
    { normalizedTables: providerJobWriteTables }
  );

  const results: ProviderWorkerExecutionResult[] = [...skipped];
  for (const plan of plans) {
    const outcome = await invokeLiveProviderAdapter(plan);
    const result = await updateAuthState(
      (state) => applyLiveProviderRunOutcome(state, plan.runId, outcome, { workspaceId: plan.workspaceId, now: options.now }),
      { normalizedTables: providerJobWriteTables }
    );
    results.push(result);
  }

  return { mock, live: { executed: plans.length, results } };
}
