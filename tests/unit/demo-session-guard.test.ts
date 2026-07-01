import { describe, expect, it } from "vitest";
import { allowLegacyDemoSession } from "@/lib/phase1/store";

describe("legacy demo session guard (P0.2)", () => {
  it("is force-disabled in production even when the flag is enabled", () => {
    expect(
      allowLegacyDemoSession({ NODE_ENV: "production", SYNCORE_ALLOW_DEMO_SESSION: "true" })
    ).toBe(false);
  });

  it("honors the flag outside production for local development", () => {
    expect(
      allowLegacyDemoSession({ NODE_ENV: "development", SYNCORE_ALLOW_DEMO_SESSION: "true" })
    ).toBe(true);
  });

  it("stays disabled outside production when the flag is unset", () => {
    expect(allowLegacyDemoSession({ NODE_ENV: "development" })).toBe(false);
    expect(allowLegacyDemoSession({ NODE_ENV: "test" })).toBe(false);
  });
});
