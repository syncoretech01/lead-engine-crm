# M1 — Live Provider Execution Framework

Created: 2026-06-17

Goal: let the typed provider adapter layer perform real network calls — gated, observable, and out of the request path — so M2 can drop in real adapters (ZeroBounce, Apollo, RingCentral, …) one at a time.

## Key constraint that shapes the design

`updateState` runs its mutator **synchronously inside a Prisma `$transaction`** (20s cap). A real provider call is async network I/O and must **never** run inside that transaction. So live execution is a **3-phase, out-of-band flow**:

1. **Plan (sync, inside `updateState`)** — `planLiveProviderRun`: claim the run, apply budget stop rules, and return an execution plan (provider, operation, input, context). No network.
2. **Invoke (async, no state)** — `invokeLiveProviderAdapter`: call the registered live adapter. The only step doing network I/O; runs between transactions.
3. **Apply (sync, inside `updateState`)** — `applyLiveProviderRunOutcome`: record the result on the run/job and the usage ledger (`completeProviderJobRun` → Actual cost), or fail (with retry scheduling).

The async service glue is `executeLiveProviderExecutionRun(runId)` in `lib/phase1/provider-job-service.ts`, which orchestrates plan → invoke → apply.

## What shipped in this slice (foundation)

- **Live-adapter registry + flag** (`lib/providers/live-adapters.ts`): `registerLiveProviderAdapter`, `getLiveProviderOperation`, and `resolveProviderExecutionMode`. Live execution is **disabled by default** — gated by env `SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** a connection's `executionMode === "live"`. The registry is empty until M2; an unregistered live op fails with a clear "no adapter" error instead of silently mocking.
- **Live execution phases** (`lib/phase1/provider-live-execution.ts`): the plan/invoke/apply functions above, unit-testable without `updateState`.
- **Worker enforcement** (`lib/phase1/provider-worker.ts`):
  - `rateLimitPerMinute` is now enforced — runs exceeding the per-minute call count are **deferred** (released back to Queued; `tick.deferred`).
  - Live-mode runs are **deferred** by the mock tick (executed out-of-band by the live executor), so flipping a connection to live never silently mock-runs it.
  - `dailyBudgetCents` / lead-job budget caps were already enforced (`evaluateBudgetStopRules`) and apply to live too (checked in the plan phase before any call).

## What remains in M1

- **Out-of-band worker runner**: a hosted cron/Redis worker that drives `processProviderExecutionQueue` (mock) and `executeLiveProviderExecutionRun` (live) on an interval — operational/deploy work.
- **Credential delivery to adapters**: pass the decrypted provider secret (from `provider-secret-vault`) into the adapter context during the plan phase. (Not needed by the mock/fixture adapters; required before real adapters.)
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
