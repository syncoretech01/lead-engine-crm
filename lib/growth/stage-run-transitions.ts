import type { StageRunStatus } from "@prisma/client";

/**
 * The `CampaignStageRun` state machine — v9.1 §11.
 *
 * v9.1 draws the happy path:
 *
 *     PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → COMPLETED | FAILED | PARKED | CANCELLED
 *
 * It does not enumerate the rest of the matrix, so the edges below are this
 * repo's reading of §11, §19 and §26. Each non-obvious one carries its reason;
 * they are the kind of decision that is cheap to change now and expensive after
 * the dashboard is built on top of them.
 *
 * NOT in `@syncore/contracts` by design — `enums/stage-type.ts` says the status
 * machine "belongs with the `CampaignStageRun` record in C3". If contracts later
 * adopts it, this file becomes the thing that must match, not the other way round.
 *
 * Enforced in the repository, not the database: a CHECK constraint cannot
 * express "from state X" without reading the current row, and doing the check in
 * one place beside the write keeps the failure message useful.
 */

/**
 * Legal `from → to` edges. Everything absent is rejected.
 *
 * Reasoning for the edges v9.1 does not draw:
 *
 * · PENDING → RUNNING — a free stage (HUB_SEARCH, NORMALIZATION, DEDUPLICATION)
 *   spends nothing and has no gate, so forcing it through AWAITING_APPROVAL
 *   would invent an approval that v9.1 §16 does not ask for.
 *
 * · APPROVED → PARKED — the budget gate runs *before* every paid call (v9.1 §5.7),
 *   so a stage can be approved and then parked at pre-flight when ledgered spend
 *   plus this estimate crosses the cap, without ever starting.
 *
 * · PARKED → RUNNING — the resume path. A PARKED stage is waiting on a
 *   SPEND_EXCEPTION or RESUME_AFTER_BREAKER approval (§11); approving it resumes.
 *
 * · FAILED → RUNNING — §11 says retries are idempotent, which presumes a retry
 *   edge. `retryCount` increments here.
 *
 * · COMPLETED and CANCELLED are terminal. A completed stage that needs redoing
 *   is a new stage run, so the timeline keeps both attempts — the admin
 *   dashboard reconstructs history from these rows (§20) and rewriting one
 *   erases what happened.
 *
 * · Nothing returns to PENDING. Rewinding would make "progress = completed /
 *   planned" (§11) non-monotonic and the bot's checklist would go backwards.
 */
export const STAGE_RUN_TRANSITIONS: Readonly<Record<StageRunStatus, readonly StageRunStatus[]>> = {
  PENDING: ["AWAITING_APPROVAL", "RUNNING", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["RUNNING", "PARKED", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "PARKED", "CANCELLED"],
  PARKED: ["RUNNING", "CANCELLED"],
  FAILED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
} as const;

export const TERMINAL_STAGE_RUN_STATUSES: readonly StageRunStatus[] = ["COMPLETED", "CANCELLED"];

export function isTerminalStageRunStatus(status: StageRunStatus): boolean {
  return TERMINAL_STAGE_RUN_STATUSES.includes(status);
}

export function canTransitionStageRun(from: StageRunStatus, to: StageRunStatus): boolean {
  return STAGE_RUN_TRANSITIONS[from].includes(to);
}

/** Thrown by the repository so an illegal transition is never written. */
export class IllegalStageRunTransitionError extends Error {
  readonly from: StageRunStatus;
  readonly to: StageRunStatus;

  constructor(from: StageRunStatus, to: StageRunStatus) {
    const allowed = STAGE_RUN_TRANSITIONS[from];
    super(
      `Illegal stage run transition ${from} → ${to}. ` +
        (allowed.length === 0
          ? `${from} is terminal; create a new stage run instead of reopening this one.`
          : `From ${from} the legal targets are: ${allowed.join(", ")}.`)
    );
    this.name = "IllegalStageRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertStageRunTransition(from: StageRunStatus, to: StageRunStatus): void {
  if (!canTransitionStageRun(from, to)) throw new IllegalStageRunTransitionError(from, to);
}
