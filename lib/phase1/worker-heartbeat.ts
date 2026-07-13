/**
 * Dead-man-switch heartbeat for the background worker. After each successful tick the
 * worker pings `SYNCORE_WORKER_HEARTBEAT_URL` (a healthchecks.io-style check URL); if
 * the worker crashes, wedges, or crash-loops, the pings stop and the external monitor
 * alerts after its grace period. On a tick failure we ping `<url>/fail` so the monitor
 * alerts immediately, with the error message as the body.
 *
 * Opt-in: unset URL = no-op (single-tick / CI / local runs are unaffected). Best-effort:
 * a monitoring outage must never crash or stall the worker loop.
 */
export async function pingWorkerHeartbeat(
  ok: boolean,
  detail?: string,
  env: { SYNCORE_WORKER_HEARTBEAT_URL?: string } = process.env as { SYNCORE_WORKER_HEARTBEAT_URL?: string }
): Promise<void> {
  const base = env.SYNCORE_WORKER_HEARTBEAT_URL?.trim();
  if (!base) return;

  const url = ok ? base : `${base.replace(/\/$/, "")}/fail`;
  try {
    await fetch(url, {
      method: "POST",
      body: detail ?? "",
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    // best-effort — never let a monitoring ping crash or block the worker loop
  }
}
