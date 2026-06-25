import { performance } from "node:perf_hooks";

export type PerformanceMetadata = Record<string, string | number | boolean | undefined>;

type PerformanceEnv = {
  [key: string]: string | undefined;
  SYNCORE_PERF_LOGS?: string;
  SYNCORE_PERF_SLOW_MS?: string;
};

type TimedStatus = "ok" | "error";

export function performanceLoggingEnabled(env: PerformanceEnv = process.env) {
  return env.SYNCORE_PERF_LOGS === "true";
}

export function slowPerformanceThresholdMs(env: PerformanceEnv = process.env) {
  const value = Number(env.SYNCORE_PERF_SLOW_MS);
  return Number.isFinite(value) && value >= 0 ? value : 2_500;
}

export async function timeAsync<T>(
  name: string,
  operation: () => Promise<T>,
  metadata: PerformanceMetadata = {},
  env: PerformanceEnv = process.env
): Promise<T> {
  const timer = startPerformanceTimer(name, metadata, env);
  try {
    const result = await operation();
    timer.end();
    return result;
  } catch (error) {
    timer.end({ status: "error" });
    throw error;
  }
}

export function timeSync<T>(
  name: string,
  operation: () => T,
  metadata: PerformanceMetadata = {},
  env: PerformanceEnv = process.env
): T {
  const timer = startPerformanceTimer(name, metadata, env);
  try {
    const result = operation();
    timer.end();
    return result;
  } catch (error) {
    timer.end({ status: "error" });
    throw error;
  }
}

export function startPerformanceTimer(
  name: string,
  metadata: PerformanceMetadata = {},
  env: PerformanceEnv = process.env
) {
  const startedAt = performance.now();
  let ended = false;

  return {
    end(extra: PerformanceMetadata & { status?: TimedStatus } = {}) {
      if (ended) {
        return;
      }
      ended = true;
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const status = extra.status ?? "ok";
      const thresholdMs = slowPerformanceThresholdMs(env);
      if (!performanceLoggingEnabled(env) && status === "ok" && durationMs < thresholdMs) {
        return;
      }

      const payload = stripUndefined({
        name,
        status,
        durationMs,
        thresholdMs,
        ...metadata,
        ...extra
      });
      console.info("[syncore:perf]", JSON.stringify(payload));
    }
  };
}

function stripUndefined(input: PerformanceMetadata & { name: string; status: TimedStatus; durationMs: number; thresholdMs: number }) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
