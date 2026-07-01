/**
 * Observability seam (P6).
 *
 * A tiny indirection so unexpected errors and notable events are captured
 * through one place instead of being swallowed or `console.error`'d ad hoc.
 * The default sink emits structured JSON to the process streams — no external
 * service required — and a Sentry / OpenTelemetry sink can be registered via
 * `setObservabilitySink()` once a DSN / collector is provisioned, without
 * touching any call site. The Sentry/OTel wiring and alerting themselves are
 * infra-dependent and deferred; this is the foundation they plug into.
 *
 * Only wire this into genuinely unexpected failures. Deliberate parse/verify
 * fallbacks (JSON.parse guards, signature/token verification returning
 * false/undefined) are control flow, not errors — do not capture those.
 */

export type ObservabilityContext = Record<string, unknown>;

export type ObservabilitySink = {
  captureError(error: unknown, context?: ObservabilityContext): void;
  recordEvent(name: string, data?: ObservabilityContext): void;
};

function errorToPayload(error: unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, name: error.name };
  }
  return { message: typeof error === "string" ? error : JSON.stringify(error) };
}

/** Structured-log sink: one JSON line per capture, safe to run anywhere. */
export const defaultObservabilitySink: ObservabilitySink = {
  captureError(error, context) {
    const payload = { level: "error", ...errorToPayload(error), ...(context ?? {}) };
    console.error(JSON.stringify(payload));
  },
  recordEvent(name, data) {
    const payload = { level: "event", event: name, ...(data ?? {}) };
    console.info(JSON.stringify(payload));
  }
};

let activeSink: ObservabilitySink = defaultObservabilitySink;

/** Register a sink (e.g. Sentry/OTel-backed) — call once at startup. */
export function setObservabilitySink(sink: ObservabilitySink): void {
  activeSink = sink;
}

/** Restore the default structured-log sink (used by tests). */
export function resetObservabilitySink(): void {
  activeSink = defaultObservabilitySink;
}

/** Capture an unexpected error with optional structured context. Never throws. */
export function captureError(error: unknown, context?: ObservabilityContext): void {
  try {
    activeSink.captureError(error, context);
  } catch {
    // An observability failure must never break the request it is observing.
  }
}

/** Record a notable non-error event (a failed send, a quarantined webhook, …). */
export function recordEvent(name: string, data?: ObservabilityContext): void {
  try {
    activeSink.recordEvent(name, data);
  } catch {
    // Never let observability break the caller.
  }
}
