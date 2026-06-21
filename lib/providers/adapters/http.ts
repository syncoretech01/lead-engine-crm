import type { ProviderId, ProviderResult } from "@/lib/providers/types";

export type JsonResponse = { ok: boolean; status: number; json: Record<string, unknown> };

/**
 * Minimal JSON fetch with a timeout, used by live provider adapters. The only
 * place in the codebase that performs outbound network I/O — and only ever
 * reached when a connection is in live mode with SYNCORE_ENABLE_LIVE_PROVIDERS
 * on. Tests stub `fetch`, so no real calls happen under test.
 */
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export function providerError<T>(providerId: ProviderId, requestId: string | undefined, message: string): ProviderResult<T> {
  return { status: "error", data: [], meta: { providerId, requestId }, errorMessage: message };
}

export function providerEmpty<T>(providerId: ProviderId, requestId: string | undefined, warning?: string): ProviderResult<T> {
  return { status: "empty", data: [], meta: { providerId, requestId, warnings: warning ? [warning] : undefined } };
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
