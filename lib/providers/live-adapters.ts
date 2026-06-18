import type {
  ProviderCapability,
  ProviderId,
  ProviderRequestContext,
  ProviderResult
} from "@/lib/providers/types";

export type ProviderOperationHandler = (
  input: unknown,
  context: ProviderRequestContext
) => Promise<ProviderResult<unknown>>;

export type LiveProviderAdapter = {
  id: ProviderId;
  operations: Partial<Record<ProviderCapability, ProviderOperationHandler>>;
};

const liveProviderAdapters = new Map<ProviderId, LiveProviderAdapter>();

/**
 * Register a live provider adapter. Real adapters land in M2; until then the
 * registry is empty and live-mode runs fail with a clear "no adapter" error
 * rather than silently falling back to mock.
 */
export function registerLiveProviderAdapter(adapter: LiveProviderAdapter) {
  liveProviderAdapters.set(adapter.id, adapter);
}

export function getLiveProviderAdapter(providerId: ProviderId): LiveProviderAdapter | undefined {
  return liveProviderAdapters.get(providerId);
}

export function getLiveProviderOperation(
  providerId: ProviderId,
  operation: string
): ProviderOperationHandler | undefined {
  return liveProviderAdapters.get(providerId)?.operations[operation as ProviderCapability];
}

export function resetLiveProviderAdapters() {
  liveProviderAdapters.clear();
}

type LiveExecutionEnv = {
  SYNCORE_ENABLE_LIVE_PROVIDERS?: string;
};

/**
 * Live provider execution is disabled by default. Even when a provider
 * connection is set to executionMode "live", the worker performs real network
 * calls only when this flag is explicitly enabled in the environment.
 */
export function liveProviderExecutionEnabled(env: LiveExecutionEnv = process.env as LiveExecutionEnv) {
  return env.SYNCORE_ENABLE_LIVE_PROVIDERS === "true";
}

/**
 * A run executes live only when the global flag is on AND its provider
 * connection is set to executionMode "live". Otherwise it runs as mock.
 */
export function resolveProviderExecutionMode(
  connectionExecutionMode: string | undefined,
  env: LiveExecutionEnv = process.env as LiveExecutionEnv
): "mock" | "live" {
  return liveProviderExecutionEnabled(env) && connectionExecutionMode === "live" ? "live" : "mock";
}
