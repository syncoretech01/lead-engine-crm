import { describe, expect, it } from "vitest";

import { stateSeedingAllowed } from "@/lib/phase1/store";

describe("stateSeedingAllowed", () => {
  it("allows auto-seeding an empty store outside production", () => {
    expect(stateSeedingAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(stateSeedingAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(stateSeedingAllowed({})).toBe(true);
  });

  it("refuses to auto-seed in production by default", () => {
    expect(stateSeedingAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows production auto-seeding only with an explicit opt-in flag", () => {
    expect(stateSeedingAllowed({ NODE_ENV: "production", SYNCORE_SEED_SNAPSHOT: "true" })).toBe(true);
    expect(stateSeedingAllowed({ NODE_ENV: "production", SYNCORE_SEED_SNAPSHOT: "TRUE" })).toBe(true);
    expect(stateSeedingAllowed({ NODE_ENV: "production", SYNCORE_SEED_SNAPSHOT: "false" })).toBe(false);
  });
});
