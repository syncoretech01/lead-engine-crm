import { describe, expect, it } from "vitest";
import { isProductionBuildPhase, requireSecret } from "@/lib/phase1/require-secret";

describe("requireSecret (P0.1/P0.3)", () => {
  it("returns the configured (trimmed) secret when present", () => {
    expect(requireSecret("MY_SECRET", "dev-default", { MY_SECRET: "  configured  " })).toBe("configured");
  });

  it("falls back to the dev default outside production", () => {
    expect(requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "development" })).toBe("dev-default");
    expect(requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "test" })).toBe("dev-default");
  });

  it("throws in production when the secret is missing", () => {
    expect(() => requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "production" })).toThrow(
      /MY_SECRET is required in production/
    );
    expect(() =>
      requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "production", MY_SECRET: "   " })
    ).toThrow(/MY_SECRET is required in production/);
  });

  it("uses the configured secret in production when it is set", () => {
    expect(
      requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "production", MY_SECRET: "live-secret" })
    ).toBe("live-secret");
  });

  it("allows the dev default during the production build phase", () => {
    expect(
      requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })
    ).toBe("dev-default");
    expect(
      requireSecret("MY_SECRET", "dev-default", { NODE_ENV: "production", npm_lifecycle_event: "build" })
    ).toBe("dev-default");
  });

  it("detects the production build phase", () => {
    expect(isProductionBuildPhase({ NEXT_PHASE: "phase-production-build" })).toBe(true);
    expect(isProductionBuildPhase({ npm_lifecycle_event: "build" })).toBe(true);
    expect(isProductionBuildPhase({ NODE_ENV: "production" })).toBe(false);
  });
});
