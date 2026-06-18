# M1 — Live Provider Execution Framework

Created: 2026-06-17

Goal: let the typed provider adapter layer perform real network calls — gated, observable, and out of the request path — so M2 can drop in real adapters (ZeroBounce, Apollo, RingCentral, …) one at a time.

## Key constraint that shapes the design

`updateState` runs its mutator **synchronously inside a Prisma `$transaction`** (20s cap). A real provider call is async network I/O and must **never** run inside that transaction. So live execution is a **3-phase, out-of-band flow**:

1. **Plan (sync, inside `updateState`)** — `planLiveProviderRun`: claim the run, apply budget stop rules, and return an execution plan (provider, operation, input, context). No network.
2. **Invoke (async, no state)** — `invokeLiveProviderAdapter`: call the registered live adapter. The only step doing network I/O; runs between transactions.
3. **Apply (sync, inside `updateState`)** — `applyLiveProviderRunOutcome`: record the result on the run/job and the usage ledger (`completeProviderJobRun` → Actual cost), or fail (with retry scheduling).

The async service glue is `executeLiveProviderExecutionRun(runId)` in `lib/phase1/provider-job-service.ts`, which orchestrates plan → invoke → apply.

## What shipped

- **Live-adapter registry + flag** (`lib/providers/live-adapters.ts`): `registerLiveProviderAdapter`, `getLiveProviderOperation`, and `resolveProviderExecutionMode`. Live execution is **disabled by default** — gated by env `SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** a connection's `executionMode === "live"`. The registry is empty until M2; an unregistered live op fails with a clear "no adapter" error instead of silently mocking.
- **Live execution phases** (`lib/phase1/provider-live-execution.ts`): the plan/invoke/apply functions above, unit-testable without `updateState`.
- **Credential delivery** (`lib/phase1/provider-live-execution.ts` → `resolveLiveProviderCredential`): in the sync plan phase the run's provider connection is resolved and its credential decrypted — from the encrypted vault (`provider-secret-vault`) for `Encrypted database` storage, or from the configured env vars for `Environment` storage — and attached to `ProviderRequestContext.credential`. The secret rides the in-memory plan into the stateless invoke phase and **never touches persisted state**. A missing/undecryptable credential is a **terminal failure** (no retry) so misconfiguration surfaces immediately rather than failing opaquely at the network call. Multi-field providers receive a JSON-encoded `secret` by convention.
- **Worker enforcement** (`lib/phase1/provider-worker.ts`):
  - `rateLimitPerMinute` is enforced — runs exceeding the per-minute call count are **deferred** (released back to Queued; `tick.deferred`).
  - Live-mode runs are **deferred** by the mock tick (executed out-of-band by the live runner), so flipping a connection to live never silently mock-runs it.
  - `dailyBudgetCents` / lead-job budget caps are enforced (`evaluateBudgetStopRules`) for live too (checked in the plan phase before any call).
- **Out-of-band worker runner** (`lib/phase1/provider-worker-runner.ts` + `scripts/run-provider-worker.ts`, `npm run worker:provider`): a **session-less** tick (via `updateAuthState`, since a background process has no user session) that (1) runs the mock queue, (2) claims + plans due live runs (`collectDueLiveProviderPlans` — live-only, within the per-minute rate limit, budget + credential resolved), then (3) invokes each adapter out-of-band and applies the outcome. Three store transactions bracket the async network calls so a DB transaction is never held open across provider I/O. One tick per invocation (cron-friendly); `--loop <ms>` self-drives for local testing.

## What remains in M1 (operational)

- **Schedule the runner**: point a hosted cron/scheduler at `npm run worker:provider` on an interval (e.g. every 15–30s), or run it as a long-lived `--loop` process. This is the only remaining deploy step — the runner code itself is done.

## Picked up in M2 (per adapter)

- **Contract fixtures per adapter** before enabling each live adapter (see `docs/PROVIDER_INTEGRATION_PLAN.md`).

## How M2 adds a real adapter

```ts
registerLiveProviderAdapter({
  id: "zerobounce",
  operations: {
    verify_email: async (input, context) => {
      // real fetch() to ZeroBounce, map response → ProviderResult<VerifiedEmail>
    }
  }
});
```

Then set the workspace's ZeroBounce connection `executionMode` to `live`, set `SYNCORE_ENABLE_LIVE_PROVIDERS=true`, and the worker routes its runs through the live path with budget + rate-limit enforcement and usage-ledger accounting.
