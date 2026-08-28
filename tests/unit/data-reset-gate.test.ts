import { afterEach, describe, expect, it } from "vitest";

import { dataResetAllowed } from "@/lib/phase1/data-reset-gate";

// Guards the guard: resetPhase1DataAction replaces the entire snapshot with demo
// seed data, so it must be unreachable in production unless deliberately enabled.

const original = { node: process.env.NODE_ENV, flag: process.env.SYNCORE_ALLOW_DATA_RESET };

function setEnv(nodeEnv: string | undefined, flag: string | undefined) {
  if (nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (flag === undefined) delete process.env.SYNCORE_ALLOW_DATA_RESET;
  else process.env.SYNCORE_ALLOW_DATA_RESET = flag;
}

afterEach(() => setEnv(original.node, original.flag));

describe("data reset gate", () => {
  it("blocks production by default", () => {
    setEnv("production", undefined);
    expect(dataResetAllowed()).toBe(false);
  });

  it("blocks production even when the flag is set to anything but the literal true", () => {
    setEnv("production", "1");
    expect(dataResetAllowed()).toBe(false);
    setEnv("production", "TRUE");
    expect(dataResetAllowed()).toBe(false);
  });

  it("allows production only with the explicit flag", () => {
    setEnv("production", "true");
    expect(dataResetAllowed()).toBe(true);
  });

  it("stays available in development", () => {
    setEnv("development", undefined);
    expect(dataResetAllowed()).toBe(true);
  });
});
