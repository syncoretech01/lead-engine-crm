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

1. **[`GROWTH_OS_ERRATA.md`](./GROWTH_OS_ERRATA.md)** — supersedes v9.1 on the points it names.
   A supersession that isn't in that file hasn't happened.
2. **[`GROWTH_OS_END_TO_END_PLAN_v9.1.md`](./GROWTH_OS_END_TO_END_PLAN_v9.1.md)** — the single
   source of truth otherwise. Read §3.1, §5.1, §5, §6, §9, §10, §11, §26.
3. **[`GROWTH_OS_EXECUTION_ROADMAP.md`](./GROWTH_OS_EXECUTION_ROADMAP.md)** — build order and
   where new pieces live.
4. **[`GROWTH_OS_PLAN.lead-engine-crm.md`](./GROWTH_OS_PLAN.lead-engine-crm.md)** — this repo's
   phases (CRM-0 … CRM-8).

Also authoritative, narrower: **`@syncore/contracts`** wins over v9.1 §6 prose wherever they
differ on wire shapes (errata #4, #5).

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

Numbered to match [`GROWTH_OS_ERRATA.md`](./GROWTH_OS_ERRATA.md), which is authoritative — read it
for the full reasoning before acting on any of these.

| # | Supersedes | Resolution |
|---|---|---|
| 1 | v9.1 §13, §31 | **Personalization runs *inside* `lead-engine-crm`** as an inline stage between "list ready" and "launch". The Console's writing logic and QA rules are **ported**, never called remotely — it runs on a local Windows box that may be off, which is fine for research but not for a stage that blocks campaigns. Data gravity is here too: audit findings, tiers, brief angles, and the cost ledger its Tier-A calls must write to. |
| 2 | v9.1 §1, §5.3 | **Seven repos, not five** — the five originals plus `syncore-contracts` and `syncore-growth-bot`. The Console Agent stays **inside `syncore-research-console` at `/agent`** (not its own repo). |
| 3 | v9.1 §15, §18, §22 G0 + the Roadmap repo table | **Slack is the pilot chat surface, not Telegram** — Telegram does not open in Pakistan without a VPN, and a remote control that needs a VPN is not a remote control. The `ChatPlatform` interface is unchanged, the Telegram adapter stays implemented and selectable via `SYNCORE_BOT_PLATFORM=telegram`, and **all platform enums keep `telegram \| slack \| dashboard` members** — including `NicheRequest.sourceChannel`. Deferred cost: Slack voice is weaker; decision point at B2, do not pre-empt it. |
| 4 | v9.1 §3.4 | **`@syncore/contracts` ≥ 0.1.0 is authoritative for every verifier wire shape.** v9.1's verifier summary is directionally right but wrong in most details. Notably: the verifier signs the **raw body alone** (no timestamp/nonce); `BATCH_MAX_EMAILS` is 10,000 with a 65,536-byte body cap that binds first; results paging is offset/limit; batch states are `queued \| running \| done`. |
| 5 | v9.1 §6 field lists | **Decision and identity fields are not approved content.** The hashed `ApprovalPayload` is **content only**: `approvalId` and `payloadSha256` live on a separate `ApprovalRecord`, because hashing the id would make identical content hash differently across revisions — destroying the one question a revision chain exists to answer. `ProviderRunProposal` carries **no `decision` field** in the approved payload: a decision is an outcome, and embedding it means the hashed content mutates when someone decides, which is exactly the mutation §10 forbids. Decisions go on the `ApprovalRecord` / decide payload. |

**Not an errata entry, but settled and relevant here:** `FindingCatalog` is split — finding *codes*
and evidence *schemas* live in `syncore-contracts`; the *phrase templates* that turn codes into
sentences live in **this repo** (they are copy, they change often, they are campaign-tunable).
Source: Execution Roadmap §1.

---

## Open items

### (E2E) A green `e2e` job does not mean the e2e tests passed

The `e2e` job's **Smoke tests** step carries `continue-on-error: true`
(`.github/workflows/ci.yml`). The step's failures are logged and then ignored, so the job reports
✓ while Playwright is red. This is pre-existing and deliberate — the legacy suite is unstable in
CI (mobile responsive-overflow + SDR-scoped routing) — and **stabilising it is not in scope for
CRM-1**.

The consequence to actually internalise: **never read "e2e ✓" as evidence.** If you need to know
whether the smoke suite passed, open the step log. As of CRM-0's close it was failing
(`Process completed with exit code 1`) inside a green job.

**Rule for new UI.** Any surface built from CRM-1 onward — the Approval Inbox, the revision flow,
the IA changes — gets its Playwright coverage in a step **outside** the `continue-on-error` one,
so new work is genuinely enforced while the legacy smoke stays advisory. Do not add new specs to
the existing smoke step; a test that cannot fail the build is documentation, not a test.

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
| **`lib/phase1/persistence-projection.ts:210`** | **`{ table: "verificationResults", delegate: "verificationResult", workspaceScoped: true }` — the `upsertOrder` entry that makes all of the above projection-adjacent. Read rule 1 before touching any of them: `VerificationResult` is blob-projected, so it must NOT gain a transactional repository or be written natively. The CRM-3 fix changes the *vocabulary*, not the storage path.** |

### Why the `VerificationStatus` import is still not done

`@syncore/contracts@0.2.1` **is now installed** (see below) and exports `VerificationStatus`. The
import is deliberately **not** made, on the CRM-0 brief's own terms: `VerificationResult` is a
projected table (`persistence-projection.ts:210`), so every local copy of the vocabulary is
projection-adjacent, and `verification.ts` *is* the fallthrough logic. CRM-0 excludes both and
requires zero runtime behaviour change. **Do it in CRM-3, all six locations together.**

## `@syncore/contracts` — how it is wired

Installed as **`file:../syncore-contracts`** — a sibling checkout, not a registry package (it is a
private repo and is not published to npmjs.org).

- **Local dev:** clone `syncoretech01/syncore-contracts` next to this repo and build it
  (`npm ci && npm run build`). A `file:` dependency is **linked, not packed**, so npm does *not*
  run the linked package's `prepare` — without an explicit build its `dist/` is missing and every
  import resolves to a dead entry point.
- **CI:** `.github/actions/setup-with-contracts` recreates the sibling layout, pinned to a tag.
  **Bump the ref there in the same commit that bumps the dependency** — it is deliberately in one
  place because five jobs consume it.
- **Auth:** the `CONTRACTS_READ_TOKEN` secret (fine-grained PAT, read-only Contents on that one
  repo). A workflow's default `GITHUB_TOKEN` cannot read another private repo, and GitHub reports
  that as **"Repository not found"** rather than a permission error. Fine-grained PATs expire — if
  CI starts failing here for no apparent reason, check the expiry first.
- **Pinning:** currently `v0.2.1`. Pin exact versions and upgrade deliberately; never track a branch.

---

## Phase status

### CRM-0 — complete

- `npm run check:projection-invariant` — 21 guarded models, own unmaskable CI job, proven to fail
  when violated, meta-test proves it stays armed.
- CI runs lint + typecheck + vitest + the projection check on **every push and every PR**.
- `@syncore/contracts@0.2.1` wired via the sibling-checkout pattern (above). Installed and consumed by CRM-1.
- `docs/CRM-0-BASELINE.md` — verified ground truth with real numbers.
- The canonical docs committed to the repo root, and this file.

**Baseline at CRM-0:** 92 test files / 455 tests / 0 failed / 0 skipped · 77 models + 8 enums ·
`upsertOrder` 70 entries · 6 live adapters registered (`ringcentral` absent).

### CRM-1 — the spine (next)

Prisma-native, none in the blob: `NicheRequest` · `ResearchRun` · `NicheBrief` · `Campaign` ·
`CampaignStageRun` · `Approval`. Transactional repositories, paginated read models, `CostEntry`
extended with `stageRunId`, the stage state machine
(`PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → COMPLETED | FAILED | PARKED | CANCELLED`),
Approval Inbox UI + revision flow, the chat APIs, IA change.

**CRM-1 takes its `Approval` shapes from `@syncore/contracts@0.2.1`, not from v9.1 §6 prose**
(errata #5 — the contracts package wins). Concretely, and this changes the schema:

- The hashed **`ApprovalPayload` is content only.** `approvalId` and `payloadSha256` belong on a
  separate **`ApprovalRecord`**. Do not hash the id — identical content would then hash differently
  across revisions, which destroys the only question a revision chain exists to answer.
- **`ProviderRunProposal` has no `decision` field in the approved payload.** A decision is an
  outcome; embedding it means the hashed content mutates when someone decides — the exact mutation
  rule 5 forbids. Record decisions on the `ApprovalRecord` / decide payload.
- The payload must round-trip byte-identically between the CRM and the bot or the hash check on
  `/decide` and `/revise` breaks. Pin the version; do not float it.
- `NicheRequest.sourceChannel` keeps all three members `telegram | slack | dashboard` (errata #3),
  even though Slack is the pilot surface.

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
