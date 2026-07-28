# CLAUDE.md — `lead-engine-crm`

**This repo is the Growth OS campaign control plane.** It is also the one carrying real
architectural debt. Rule 1 below prevents silent production data loss. Read it before writing a
single line.

**Current phase: CRM-0 complete.** Next: CRM-1 (the spine). See "Phase status" at the bottom.

---

## 🔴 Rule 1 — Blob-projected XOR Prisma-native. Never both.

This is the rule that matters. Everything else is a preference by comparison.

App state is one JSON blob (`AppStateSnapshot`, ~70 top-level arrays) projected onto ~70 tables.
On **every** projection sync, for **every** `workspaceScoped` entry in `upsertOrder`, once per
workspace, `lib/phase1/persistence-projection.ts:1599` runs:

```ts
await delegate.deleteMany({ where: { workspaceId, id: { notIn: ids } } });
```

**Any table reachable from `upsertOrder` loses every row that is not in the blob.** Growth OS
models are Prisma-native — written by transactional repositories, never present in the blob — so
the moment one is added to the projection "for consistency", the next sync empties the entire
table. No error. No exception. No log line. Just an empty table, discovered later.

`SYNCORE_PROJECTION_MODE` defaulting to `diff` (`lib/phase1/store.ts:803`) and the `writeSeq` CAS
guard are **mitigations, not fixes**. The `deleteMany` is still reached.

**So, for every Growth OS model:**

- Its own table, its own migration.
- Its own **transactional repository** — follow the `lib/phase1/auth-fast-path.ts` precedent.
- Its own **server-side-paginated** read model.
- **Never** add it to `AppState`, `syncNormalizedProjectionToPrisma`, or `upsertOrder`.
- **Never** write it via `updateState`.
- Reference blob entities by ID only.

**CI enforces this.** `npm run check:projection-invariant` fails the build if any of the 21
guarded models appears in `persistence-projection.ts`. It runs as its own GitHub Actions job so a
lint or typecheck failure can never mask its verdict, and `tests/unit/projection-invariant.test.ts`
proves the checker is still armed (a no-op'd matcher reports success and exits 0 — that is the
failure mode being defended against).

Adding a future Growth OS model to the guard is **one line** in `GUARDED_MODELS` in
`scripts/check-projection-invariant.mjs`.

> If you need to warn future maintainers *inside* `persistence-projection.ts`, **do not name the
> guarded models** — the checker scans comments too, deliberately, and there is no escape hatch.
> Write "see `scripts/check-projection-invariant.mjs` for the guarded list". Adjust the comment,
> never the guard. **Never widen the check to make a violation pass.**

---

## The other 13 golden rules

2. **Every real stage is a `CampaignStageRun`.** No orphan work. `CostEntry` and `Approval`
   reference `stageRunId`.
3. **One cost ledger.** Extend `ProviderUsageLedger`. Never create a second.
4. **Every paid call passes the budget gate first**, and reconciles actual-vs-approved after
   (CRM-4). Overrun beyond `overrunTolerancePct` → auto-park + `SPEND_EXCEPTION`.
5. **Approvals are immutable.** Create + decide + **revise** only. An edit supersedes the original
   and creates a new row with a new SHA-256. No update path on the payload — enforce at the
   repository level.
6. **`NicheRequest` (Template A) ≠ `NicheBrief` (Template B).** No brief and no `NICHE_TEST`
   approval may exist before research completes.
7. **The CRM never calls the Email Verifier and never runs MillionVerifier itself.** It trusts the
   Hub's `emailStatus`; it *prices, approves, authorizes and ledgers* MV, which the Hub executes.
   (`millionverifier` is registered as a CRM adapter but must stay dormant.)
8. **No link in automated cold touch 1.** Enforce with a validator that blocks launch.
9. **Route on intent, not raw opens.** Opens are MPP-inflated; they adjust score only.
10. **Never enroll a warm campaign before its asset exists and passes QA.**
11. **Server-side pagination on every new read model.** No row caps. (Existing read models cap at
    `take: 500` / `take: 1500` — do not copy that pattern.)
12. **Providers stay mock by default.** Go live one connection at a time behind the double gate
    (`SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** connection `executionMode:"live"`).
13. **Never cold-send from `syncoretech.com`.** Lookalike domains only; SES is
    transactional/warm/system.
14. **`OutreachCampaign` and the raw lead-ingestion path are legacy.** Nothing new references them.

---

## What this repo is and is not

**IS:** the campaign control plane — campaigns, approvals, all spending decisions, the single cost
ledger, paid enrichment, lead tiering, audit orchestration, **personalization**, outreach
orchestration, SDR workflow, hosted audit pages, every dashboard.

**IS NOT:** the lead-data system of record. This repo **does not ingest, normalize, deduplicate or
verify raw leads** — the Hub does. The CRM consumes clean golden records and adds campaign context.

**The boundary in one sentence:** everything left of *"a golden contact becomes a campaign member"*
is the Hub; everything right of it is here.

### Do NOT build (anti-scope)

Raw lead ingestion/normalization/dedupe/verification · a verifier adapter · a native cold-sending
engine (Mailshake owns sequencing/sending/tracking; `docs/PHASE_B_OUTREACH_SPEC.md` is read-only
context) · a second cost ledger · BullMQ/Prometheus/Grafana/OTel/Temporal/Trigger.dev before a
proven blocker · the blob migration (out of pilot scope) · anything referencing `OutreachCampaign`.

---

## Canonical documents

Precedence, highest first. **Do not re-litigate a resolved conflict.**

1. **`GROWTH_OS_ERRATA.md`** — supersedes v9.1 on the points it names.
2. **`GROWTH_OS_END_TO_END_PLAN_v9.1.md`** — the single source of truth otherwise. Read §3.1,
   §5.1, §5, §6, §9, §10, §11, §26.
3. **`GROWTH_OS_EXECUTION_ROADMAP.md`** — build order and where new pieces live.
4. **`GROWTH_OS_PLAN.lead-engine-crm.md`** — this repo's phases (CRM-0 … CRM-8).

> ⚠️ **None of these four files is currently committed to this repo.** They were supplied
> out-of-band during CRM-0. Commit them here (or add a resolvable pointer) — otherwise every
> session starts without its constraints, which is the exact failure this file exists to prevent.

**Required in-repo reading before proposing architecture** (plan §6 session protocol):
`docs/CAMPAIGN_WATERFALLS.md` · `docs/PROVIDER_INTEGRATION_PLAN.md` ·
`docs/M1_PROVIDER_EXECUTION.md` · `docs/PHASE_B_OUTREACH_SPEC.md` ·
`docs/SECRETS_AND_CREDENTIALS_PLAN.md` · `docs/BACKGROUND_JOBS.md` · `docs/AWS_MIGRATION.md` ·
`BLOB-MIGRATION.md` · **`docs/CRM-0-BASELINE.md`** (verified ground truth — re-run the sweep before
touching persistence).

**No `GROWTH_OS_BUILD_PLAN.md` or other v7-era planning doc exists in this repo** (verified in
CRM-0). If one ever appears, it is stale by definition: delete it rather than reconcile it.

---

## Known resolved conflicts

Settled. Do not reopen, and do not "correct" code that follows these.

| # | Conflict | Resolution |
|---|---|---|
| 1 | v9.1 §13 says the Console's email writer becomes a remote personalization microservice | **Personalization runs *inside* `lead-engine-crm`** as an inline pipeline stage. The Console is on a local Windows box that may be off — tolerable for research, not for a stage that blocks campaigns. Personalization also has data gravity here (audit findings, tier, brief angles, cost ledger). **Port the Console's writing logic and QA rules; do not call it remotely.** |
| 2 | v9.1 header governs **five** repos | **Seven repos.** Plus `syncore-contracts` (shared schemas) and `syncore-growth-bot` (chat control surface). |
| 3 | `FindingCatalog` ownership | **Split.** Finding *codes* + evidence *schemas* live in `syncore-contracts` (the Audit Bot emits, the CRM consumes). The *phrase templates* that turn codes into sentences live **here** — they are copy, they change often, they are campaign-tunable. |
| 4 | Console Agent placement | Lives **inside `syncore-research-console`** (`/agent`), not its own repo. It deploys to the same machine and versions with the Console. |
| 5 | v9.1 says Telegram-first | **Slack, not Telegram.** Build behind the platform-neutral interface either way. |

> ⚠️ Entries 1–4 were reconstructed from `GROWTH_OS_EXECUTION_ROADMAP.md` §1 during CRM-0, because
> `GROWTH_OS_ERRATA.md` and the `syncore-growth-bot` `CLAUDE.md` were not available in this repo.
> **Reconcile this table against those two sources** when they land, and correct any drift.

---

## Open items inherited from `syncore-contracts`

### (C) `emailStatus` has no `Unknown` member and `emailStatusFor` falls through to `"Valid"`

**Severity: high. Fix in CRM-3, before `GOLDEN_SYNC`. Do not fix before then.**

The verification vocabulary is missing `Unknown`:

```ts
// lib/phase1/types.ts:676
emailStatus: "Valid" | "Risky" | "Invalid" | "Missing" | "Suppressed";
```

and the classifier's final branch is an unguarded fallthrough:

```ts
// lib/phase1/verification.ts:192-206  (fallthrough at :206)
function emailStatusFor({ grade, roleEmail, catchAll, suppressionReason }): VerificationResult["emailStatus"] {
  if (suppressionReason || grade === "S") return "Suppressed";
  if (grade === "D") return "Invalid";
  if (roleEmail || catchAll || grade === "C") return "Risky";
  return "Valid";                      // ← anything unclassified becomes Valid
}
```

**Why it matters at `GOLDEN_SYNC`:** the Hub's vocabulary is `valid|invalid|risky|unknown`, and the
verifier's honesty guarantee maps `smtp_timeout → unknown/retryable`. With no `Unknown` member,
every Hub `unknown` collapses to **`Valid`** on arrival. That inverts golden rule 7 (trust the
Hub's `emailStatus`), silently marks unverified addresses as verified, and defeats the entire
MV-on-unknown-only economics of CRM-3 — you would pay to verify nothing and send to unknowns.

**The fix (CRM-3):** consume `VerificationStatus` from `@syncore/contracts` instead of the local
union, add the `Unknown` member, and make the fallthrough explicit. **Never map `unknown → invalid`.**

**All local copies of the vocabulary** — every one needs updating together:

| Location | What it is |
|---|---|
| `lib/phase1/types.ts:676` | the canonical union on `VerificationResult` |
| `lib/phase1/verification.ts:205-206` | `emailStatusFor` — the fallthrough itself |
| `lib/phase1/lead-dashboard-read-model.ts:1316` | guard duplicating the full vocabulary |
| `lib/phase1/lead-dashboard-read-model.ts:1321` | grade → status mapping |
| `lib/phase1/reporting.ts:677` | `"Risky"` filter |

### Why CRM-0 did not do the `@syncore/contracts` import

Two independent blockers, either sufficient:

1. **The package is not installable.** `npm view @syncore/contracts version` →
   `E404 ... is not in this registry` against `https://registry.npmjs.org/`. No scoped registry is
   configured. The roadmap says it is published privately; that registry config does not exist here
   yet.
2. **Even if it were, the swap is out of CRM-0's remit.** `VerificationResult` is a **projected
   table** (`verificationResults`, `upsertOrder` entry at `persistence-projection.ts:210`), so
   `types.ts:676` is projection-adjacent, and `verification.ts` *is* the fallthrough logic. CRM-0's
   brief excludes both, and requires zero runtime behaviour change.

**Before CRM-1**, `@syncore/contracts` must be installable and **pinned** to an exact version.

---

## Phase status

### CRM-0 — complete

- `npm run check:projection-invariant` — 21 guarded models, own unmaskable CI job, proven to fail
  when violated, meta-test proves it stays armed.
- CI runs lint + typecheck + vitest + the projection check on every PR and every push to `main`.
- `docs/CRM-0-BASELINE.md` — verified ground truth with real numbers.
- This file.

**Baseline at CRM-0:** 92 test files / 455 tests / 0 failed / 0 skipped · 77 models + 8 enums ·
`upsertOrder` 70 entries · 6 live adapters registered (`ringcentral` absent).

**Flagged, not fixed:** `scratchpad/` is neither tracked nor gitignored — it breaks `lint` and
`typecheck` locally while CI stays green. One `git add .` makes that everyone's problem.

### CRM-1 — the spine (next)

Prisma-native, none in the blob: `NicheRequest` · `ResearchRun` · `NicheBrief` · `Campaign` ·
`CampaignStageRun` · `Approval`. Transactional repositories, paginated read models, `CostEntry`
extended with `stageRunId`, the stage state machine
(`PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → COMPLETED | FAILED | PARKED | CANCELLED`),
Approval Inbox UI + revision flow, the chat APIs, IA change.

**CRM-1 needs from `syncore-contracts` (C2): the `ApprovalPayload` shapes** — the payload that gets
SHA-256'd and must round-trip byte-identically between the CRM and the bot, or the hash check on
`/decide` and `/revise` breaks. **Pin the version**; do not float it.

**Before CRM-1 starts:** confirm RDS backups and **run a restore drill**. For persistence changes
`git revert` is not a rollback — forward-fix plus PITR is the story.

---

## Working rules

- Verify ground truth and run the suite at session start (`docs/CRM-0-BASELINE.md`).
- Propose a phase-scoped plan and get approval before implementing.
- Small commits; `npm run lint`, `npm run typecheck`, `npm run test` after each.
- **Contracts change in `syncore-contracts` first**, then in consumers. Never edit a payload shape
  in two repos independently.
- Extend, don't rebuild. The failure mode in this repo is rebuilding what already works — see the
  "already exists" inventory in the repo plan §1.
- `/clear` between phases. This repo is too large to hold in one context.
