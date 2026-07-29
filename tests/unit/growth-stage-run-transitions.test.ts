import { describe, expect, it } from "vitest";
import {
  IllegalStageRunTransitionError,
  STAGE_RUN_TRANSITIONS,
  assertStageRunTransition,
  canTransitionStageRun,
  isTerminalStageRunStatus
} from "@/lib/growth/stage-run-transitions";

type Status = keyof typeof STAGE_RUN_TRANSITIONS;

const ALL: Status[] = [
  "PENDING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "PARKED",
  "CANCELLED"
];

/**
 * The full 8×8 transition matrix — every ordered pair asserted, not just the
 * legal ones. A machine tested only on its happy path silently accepts whatever
 * the implementation happens to allow.
 */
const LEGAL = new Set([
  "PENDING→AWAITING_APPROVAL",
  "PENDING→RUNNING",
  "PENDING→CANCELLED",
  "AWAITING_APPROVAL→APPROVED",
  "AWAITING_APPROVAL→CANCELLED",
  "APPROVED→RUNNING",
  "APPROVED→PARKED",
  "APPROVED→CANCELLED",
  "RUNNING→COMPLETED",
  "RUNNING→FAILED",
  "RUNNING→PARKED",
  "RUNNING→CANCELLED",
  "PARKED→RUNNING",
  "PARKED→CANCELLED",
  "FAILED→RUNNING",
  "FAILED→CANCELLED"
]);

describe("stage run transition matrix", () => {
  const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

  it.each(pairs)("%s → %s", (from, to) => {
    expect(canTransitionStageRun(from, to)).toBe(LEGAL.has(`${from}→${to}`));
  });

  it("covers all 64 ordered pairs", () => {
    expect(pairs).toHaveLength(64);
  });

  it("has exactly the 16 legal edges", () => {
    const declared = ALL.flatMap((from) => STAGE_RUN_TRANSITIONS[from].map((to) => `${from}→${to}`));
    expect(declared.sort()).toEqual([...LEGAL].sort());
  });
});

describe("terminal states", () => {
  it.each(["COMPLETED", "CANCELLED"] as const)("%s is terminal and has no outgoing edges", (s) => {
    expect(isTerminalStageRunStatus(s)).toBe(true);
    expect(STAGE_RUN_TRANSITIONS[s]).toEqual([]);
  });

  it.each(["PENDING", "AWAITING_APPROVAL", "APPROVED", "RUNNING", "FAILED", "PARKED"] as const)(
    "%s is not terminal",
    (s) => {
      expect(isTerminalStageRunStatus(s)).toBe(false);
      expect(STAGE_RUN_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  );

  it("no state returns to PENDING", () => {
    // Progress is completed/planned stage runs (v9.1 §11). Rewinding would make
    // it non-monotonic and the bot's checklist would go backwards.
    for (const from of ALL) {
      expect(STAGE_RUN_TRANSITIONS[from]).not.toContain("PENDING");
    }
  });

  it("no state re-enters itself", () => {
    for (const from of ALL) {
      expect(STAGE_RUN_TRANSITIONS[from]).not.toContain(from);
    }
  });

  it("every non-terminal state can be cancelled", () => {
    // An operator must always be able to stop a stage that has not finished.
    for (const from of ALL.filter((s) => !isTerminalStageRunStatus(s))) {
      expect(STAGE_RUN_TRANSITIONS[from]).toContain("CANCELLED");
    }
  });

  it("every state is reachable except PENDING, which is the entry point", () => {
    const reachable = new Set(ALL.flatMap((from) => STAGE_RUN_TRANSITIONS[from]));
    for (const status of ALL.filter((s) => s !== "PENDING")) {
      expect(reachable.has(status)).toBe(true);
    }
    expect(reachable.has("PENDING")).toBe(false);
  });
});

describe("assertStageRunTransition", () => {
  it("passes a legal transition", () => {
    expect(() => assertStageRunTransition("RUNNING", "COMPLETED")).not.toThrow();
  });

  it("throws a typed error naming the legal targets", () => {
    try {
      assertStageRunTransition("PENDING", "COMPLETED");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalStageRunTransitionError);
      const typed = error as IllegalStageRunTransitionError;
      expect(typed.from).toBe("PENDING");
      expect(typed.to).toBe("COMPLETED");
      // The message has to be useful at 2am.
      expect(typed.message).toContain("AWAITING_APPROVAL, RUNNING, CANCELLED");
    }
  });

  it("explains that a terminal state is terminal rather than listing nothing", () => {
    try {
      assertStageRunTransition("COMPLETED", "RUNNING");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("terminal");
      expect((error as Error).message).toContain("create a new stage run");
    }
  });
});
