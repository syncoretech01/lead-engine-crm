# CRM-0 — Ground-truth baseline

**Recorded:** 2026-07-28 · **Phase:** CRM-0 (guardrails) · **Commit at capture:** `9e6b719`

This is the §1 "verify at session start" sweep from `GROWTH_OS_PLAN.lead-engine-crm.md`, run for
real and recorded with actual numbers. **Nothing here was fixed.** CRM-0 adds guardrails only;
every defect below is deliberately left in place and carried into a later phase.

Re-run this sweep at the start of any session that plans to touch persistence.

---

## Test suite baseline

```
npm run test          # vitest run
```

| Metric | Value |
|---|---|
| Test files | **91 passed / 91 total** |
| Tests | **423 passed / 423 total** |
| Failed | **0** |
| Skipped | **0** |
| Exit code | **0** |
| Duration | 44.26 s |

**There are no pre-existing failures.** The suite is fully green at baseline, so any red in CI
after this point is a regression introduced by new work, not inherited debt.

Not included in this number (separate CI lanes, separate configs):
`npm run test:integration` (real Postgres, `vitest.integration.config.ts`) and
`npm run test:e2e` (Playwright, currently `continue-on-error: true` in CI).

**After CRM-0** the suite is **92 files / 455 tests** — the 32 added tests are
`tests/unit/projection-invariant.test.ts` (the guardrail meta-test). 423 + 32 = 455.

## Lint & typecheck baseline

Both are **clean for all tracked code**, and both **fail locally** — entirely because of
untracked files:

| Command | Tracked code | Local working tree |
|---|---|---|
| `npm run lint` | clean | 4 errors + 2 warnings, all in `scratchpad/redesign-brief/**/support.js` |
| `npm run typecheck` | clean | 1 error: `scratchpad/reset-and-import-zack.ts:249` (TS2345) |

**Resolved at CRM-0 close.** `scratchpad/` was **neither tracked nor listed in `.gitignore`**, so a
fresh CI checkout did not contain it (CI green) while local `lint`/`typecheck` failed on files CI
would never see — two signals disagreeing for no reason, and one `git add .` away from breaking the
build for everyone. It is now in `.gitignore` as session workspace, not project state.

The numbers above are the *local working-tree* readings taken before that fix; tracked code was
clean throughout.

This is also exactly why the projection check is its own CI job: had it lived inside `validate`,
a lint failure like the one above would short-circuit the job and the invariant would never be
evaluated at all — and "not run" is indistinguishable from "passed" in a red build.

## Schema size

```
grep -cE '^(model|enum) ' prisma/schema.prisma
```

**77 models + 8 enums = 85 declarations.** (The plan estimated ~75 models; the real count is 77.)

## The blob landmine — confirmed

**`lib/phase1/persistence-projection.ts:1599`** — the destructive call, inside the
`projection.sync.deleteMany` block spanning lines 1586–1601:

```ts
await delegate.deleteMany({ where: { workspaceId, id: { notIn: ids } } });
```

It runs once per workspace, for every `workspaceScoped` entry in `upsertOrder`, on every
projection sync. **Any projected table loses every row whose id is not present in the blob.**
The plan cited ~line 1559; the actual line is **1599**.

`upsertOrder` is **70 entries**, `lib/phase1/persistence-projection.ts:186–257`, running
`workspaces` → `users` → … → `auditLogs`. Deletion iterates it in reverse.

This is the single reason the CRM-0 projection-invariant check exists. See
`scripts/check-projection-invariant.mjs`.

## Projection mode

**`lib/phase1/store.ts:803`** — defaults to `diff`:

```ts
return (process.env.SYNCORE_PROJECTION_MODE ?? "diff").trim().toLowerCase() !== "full";
```

`diff` is the fast path (upsert only changed rows) and has run in prod since the Neon-egress fix.
`SYNCORE_PROJECTION_MODE=full` falls back to the slower fully self-healing sync. Applies to
scoped (`normalizedTables`) writes only. **This is a mitigation, not a fix** — the `deleteMany`
above is still reached.

## The `workspaces[0]` migration blocker

**`lib/phase1/store.ts:828`**, inside `migrateState`:

```ts
const workspaceId = state.workspaces[0]?.id;
```

Single-workspace assumption baked into state migration. Per the plan's §5 anti-scope this **must
be fixed before any blob peel**, post-pilot. Do not touch it during the pilot. A second reference
to the same assumption appears in a comment at `store.ts:1181`.

## Registered live provider adapters

`lib/providers/register-live-adapters.ts` — **5 registered**, all behind the double gate
(`SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** connection `executionMode:"live"`):

| Adapter | Operations |
|---|---|
| `millionverifier` | `verify_email` |
| `hunter` | `find_email`, `verify_email` |
| `apollo` | `find_email` |
| `apify_maps` | `discover_companies` |
| `apify_harvest` | `discover_contacts` |

`ringcentral` is **written but not registered** — confirmed absent from this file.

`amazon_ses` was registered here for `send_transactional_email` and has been **deliberately
removed**. The registry is reachable from the generic provider-job path, which hands a job’s
`inputSummary` to the matched adapter verbatim, and from the waterfall executor where the
operation is operator-selectable — so the entry made it possible to send real mail with no
suppression check, no `List-Unsubscribe` header, no physical address (CAN-SPAM) and no golden-rule
8/13 cold-send check. All three real senders (`direct-email-send`, `outreach-send`,
`transactional-email-service`) import `amazonSesSendEmail` directly, so the registration bought
nothing. Both registry callers fail closed on a missing adapter.

> Note for CRM-3: `millionverifier` is registered here but per golden rule 7 the CRM must never
> execute it. It stays dormant; the Hub runs MV. Registration alone performs no network call.

## The inert outreach engine

`grep -n 'stepNumber === 1' lib/phase1/outreach.ts` → **two sites**, not the single ~339–368
range the plan cited:

- **`lib/phase1/outreach.ts:341`** — `firstStep` resolution
- **`lib/phase1/outreach.ts:824`** — step lookup in the seeding/simulation path

Send paths only ever resolve step 1. Delays, stop-on-reply and SMS are inert; there is no
scheduler, no open/click tracking, no reply inbox. This is why Mailshake owns sending in the plan
(anti-scope §5: do not build a native cold-sending engine).

## Read-model row caps

Unchanged and unaddressed: read models cap at `take: 500` / `take: 1500`. Every **new** read model
must paginate server-side (golden rule 11). Existing caps are not in CRM-0 scope.

---

## Repo-state notes

- **No root `CLAUDE.md` existed** before CRM-0. Added by this phase.
- **`.github/workflows/ci.yml` already existed** with four jobs (`validate`, `build`,
  `integration`, `e2e`). CRM-0 **adds** a `projection-invariant` job rather than creating the
  workflow from scratch.
- **No `GROWTH_OS_BUILD_PLAN.md` or other v7-era planning doc is present** anywhere in the repo
  (searched excluding `node_modules`). Nothing to flag for deletion.
- **The canonical Growth OS docs are not committed to this repo**:
  `GROWTH_OS_END_TO_END_PLAN_v9.1.md`, `GROWTH_OS_EXECUTION_ROADMAP.md`,
  `GROWTH_OS_PLAN.lead-engine-crm.md`, `GROWTH_OS_ERRATA.md`. `CLAUDE.md` cites them as canonical;
  they should be committed here (or a pointer added) so sessions can actually read them.
- **`@syncore/contracts` is not resolvable** from the configured npm registry (`npm view
  @syncore/contracts version` exits 1). CRM-0 step 6 could not install it. See `CLAUDE.md` →
  "Open items inherited from syncore-contracts".
