import { afterEach, describe, expect, it, vi } from "vitest";
import {
  performanceLoggingEnabled,
  slowPerformanceThresholdMs,
  timeAsync,
  timeSync
} from "@/lib/phase1/performance";

describe("performance instrumentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses logging and slow threshold env flags", () => {
    expect(performanceLoggingEnabled({ SYNCORE_PERF_LOGS: "true" })).toBe(true);
    expect(performanceLoggingEnabled({ SYNCORE_PERF_LOGS: "false" })).toBe(false);
    expect(slowPerformanceThresholdMs({ SYNCORE_PERF_SLOW_MS: "125" })).toBe(125);
    expect(slowPerformanceThresholdMs({ SYNCORE_PERF_SLOW_MS: "nope" })).toBe(2500);
  });

  it("logs timed async operations when explicitly enabled", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(timeAsync("test.async", async () => 42, { tableCount: 3 }, { SYNCORE_PERF_LOGS: "true" })).resolves.toBe(42);

    expect(info).toHaveBeenCalledTimes(1);
    const [prefix, payload] = info.mock.calls[0];
    expect(prefix).toBe("[syncore:perf]");
    expect(JSON.parse(String(payload))).toMatchObject({
      name: "test.async",
      status: "ok",
      tableCount: 3
    });
  });

  it("does not log fast operations when disabled and below threshold", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(timeSync("test.sync", () => "ok", {}, { SYNCORE_PERF_LOGS: "false", SYNCORE_PERF_SLOW_MS: "999999" })).toBe("ok");

    expect(info).not.toHaveBeenCalled();
  });

  it("logs failed operations even when normal logging is disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(() =>
      timeSync("test.failure", () => {
        throw new Error("boom");
      }, {}, { SYNCORE_PERF_LOGS: "false", SYNCORE_PERF_SLOW_MS: "999999" })
    ).toThrow("boom");

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0][1]));
    expect(payload).toMatchObject({ name: "test.failure", status: "error" });
  });
});
