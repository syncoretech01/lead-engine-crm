# lead-engine-crm — Deep Codebase Review & Improvement Plan

_A full-codebase review covering architecture, performance, security/correctness, testing/CI, maintainability, product/feature gaps, ops/reliability, and UI/UX. Read-only: no application code was modified. Every claim is anchored to `file:line` evidence or explicitly labelled an estimate/speculation._

**Baseline health (verified):** `eslint .` → 0 · `tsc --noEmit` → 0 · `vitest run` → **329/329 pass across 71 unit files** (+1 gated integration file). The app builds and ships; this review is about making a *better* version, not fixing a broken one.

---

## How this review was run

Nine specialist agents fanned out over the repo in parallel, each read-only:

| Dimension | What it examined |
|---|---|
| Architecture & data layer | The dual-store (blob + Prisma projection), scalability ceilings, concurrency, migration path |
| Performance | Write-path cost per action, read models, Prisma/indexes, rendering/bundle, polling, caching |
| Security & correctness | (Prior review) tenant isolation, authN/Z, webhooks, PII/compliance, data consistency |
| Testing & CI | Coverage map, zero-coverage high-risk modules, e2e gaps, CI pipeline |
| Maintainability | God files, module structure, boilerplate, dead code, dead CSS, unused deps |
| Product — CRM | Route-by-route capability audit vs. modern CRM table stakes |
| Product — outreach/automation | Sequence/campaign execution, deliverability, SMS, reply handling |
| Product — lead-gen | Providers live-vs-simulated, waterfalls, import/export |
| Product — admin/platform | RBAC, reporting, integrations, notifications, API, i18n, multi-workspace |
| Ops & observability | Deploy pipeline, Terraform, backups/DR, alerting, worker reliability, security ops |

Findings below are de-duplicated and reconciled against ground truth (see **Corrections** at the end — several agents flagged things that are actually fine on closer inspection).

---

## Table of contents

1. [The one thing to understand: the blob is the root cause](#1-the-root-cause)
2. [Top priorities across all dimensions](#2-top-priorities)
3. [Architecture & data layer](#3-architecture)
4. [Performance](#4-performance)
5. [Security & correctness](#5-security)
6. [Testing & CI](#6-testing)
7. [Maintainability & tech debt](#7-maintainability)
8. [Product & feature gaps](#8-product)
9. [Ops, reliability & observability](#9-ops)
10. [UI / UX](#10-ui)
11. [Consolidated roadmap](#11-roadmap)
12. [Corrections & reconciliations](#12-corrections)
13. [Provenance & limitations](#13-provenance)

---

<a name="1-the-root-cause"></a>
## 1. The one thing to understand: the blob is the root cause

The application's source of truth is a **single Postgres row** (`AppStateSnapshot`, `prisma/schema.prisma:10-16`, id `"syncore-primary-state"`) holding the entire multi-tenant application state as one JSON object with **~70 top-level arrays** (`lib/phase1/types.ts:1612-1685`). A normalized ~71-table Prisma projection is *derived* from it. Reads increasingly use fast, well-indexed read models against the projection; **every write still funnels through a whole-blob read-modify-write**.

This single design choice is the direct or indirect cause of the most serious findings in *four* separate dimensions:

- **Data-loss risk** (architecture) — no concurrency control on the blob upsert → last-write-wins.
- **The Neon egress-cap breach and the 2 GB OOM outage** (performance/ops) — every action serializes ~3 MB twice; the dialer poll reads the whole blob every 2 s.
- **The 30 s transaction-timeout trap** (architecture/ops) — bulk work must dodge onto the non-transactional `writeState`.
- **Testability** (testing) — the write path is monolithic and hard to unit-test, so it has ~zero coverage.

The good news, repeatedly confirmed: **the read side already has an exit ramp** (15 fast read models, tight `select`s, workspace-scoped composite indexes), and an opt-in `diff` projection mode already exists and is live on AWS prod. The debt is almost entirely on the write path, and it can be paid down **incrementally** — one AppState array at a time — without a big-bang rewrite.

---

<a name="2-top-priorities"></a>
## 2. Top priorities across all dimensions

Ranked by (blast radius × likelihood) ÷ effort. The first six are hours-to-days of work each.

| # | Action | Why it's urgent | Effort | Source |
|---|---|---|---|---|
| 1 | **Commit the systemd `MemoryMax` guards into `deploy/ec2/*.service`** | The fix that currently prevents a repeat of the 30-min OOM outage exists **only** as an on-box drop-in (`scratchpad/apply-guard.sh`). Any rebuild from the repo silently loses it. | 10 min, $0 | Ops |
| 2 | **Verify & rotate the seeded superadmin in prod** (`Syncore!2026`, `nora@syncore.tech`) | Source-committed password on a live-reachable superadmin account. In git + docs + 10+ e2e specs. | 1 hr | Security |
| 3 | **Add optimistic locking (write-seq CAS) to the snapshot upsert** | Eliminates whole-action last-write-wins data loss for the entire remaining life of the blob. ~30 lines. | ~1 day | Architecture |
| 4 | **Point-read `/api/calls/[id]`** instead of `readState()` | The dialer polls it every 2 s → ~90 MB DB egress per call; the biggest single Neon-cap contributor. Replace with `trackedCall.findUnique` (8 fields). | <1 hr | Performance |
| 5 | **Harden the SES webhook**: default `SYNCORE_SES_QUARANTINE_UNSCOPED=true` + TopicARN allow-list; stop auto-confirming unknown SNS topics | An unauthenticated attacker with a throwaway AWS account can suppress *any* contact in *any* tenant. | 2-3 hrs | Security |
| 6 | **Add a `/api/health` route + external uptime check** (free) | The OOM outage was detected by a human. This would have paged. | 1 hr, $0 | Ops |
| 7 | **Make `SYNCORE_PROJECTION_MODE=diff` the code default** (already on AWS prod; `.env.example` still says `full`) | 10-100× write-latency and egress reduction; fixes the 30 s-timeout rollbacks. | ~0 + soak | Perf/Arch |
| 8 | **Add `match.workspaceId` check to dedupe merge + trusted-hop fix for `X-Forwarded-For`** | Two more cross-tenant / brute-force-enabling breaks; small localized diffs. | 2-3 hrs | Security |

---

<a name="3-architecture"></a>
## 3. Architecture & data layer

### Current shape (facts)
- **Source of truth:** one JSON blob row; `version` is a *schema* constant (16), **not** a write counter (`store.ts:781-784`).
- **Read path** (`readStateFromPrisma`, `store.ts:497-522`): `findUnique` the whole blob → `migrateState` (400 lines of guards + domain backfills) runs on *every read* → `mergePrismaIdentityRows` reconciles 6 auth tables back into the blob → **if anything changed, the read performs a write**.
- **Write path** (`updateState`/`updateAuthState`, `store.ts:107-183`): `$transaction({maxWait:10_000, timeout:30_000})` → read whole blob → mutate in memory → **upsert the whole blob unconditionally** (`store.ts:719-730`, no version predicate) → sync projection. `writeState` (`store.ts:95-105`) does the same **outside any transaction**.
- **Projection sync** (`persistence-projection.ts:1565-1663`): builds the full 71-table projection from whole state on every non-skip write, even when 2 tables are scoped (`:1582`); `deleteMany({ id: { notIn: [all ids] } })` per table (`:1607`); row-by-row sequential `upsert` (`:1617-1648`). Diff mode skips byte-identical rows but is **off by default**.

### Scalability ceilings (estimates scaled from the stated ~3 MB prod blob)
| Scale | Behavior |
|---|---|
| **~10k contacts** (~10-20 MB blob) | 20-40 MB moved per write; ~0.5-2 s CPU/action; bulk work already forced onto non-transactional `writeState`. **This is roughly where prod is now** — it already OOM'd a 2 GB box and blew Neon's 5 GB/mo egress. |
| **~100k contacts** (~100-200 MB) | Single-action latency in tens of seconds → **every action exceeds the 30 s transaction timeout**. Quadratic projection passes reach ~10¹⁰ ops. **Hard ceiling.** |
| **~1M contacts** (~1-2 GB) | Exceeds Postgres's 1 GB per-field limit — hard failure. |

Quadratic hot spots in the projection build: `contacts × companies` (`persistence-projection.ts:682`), `companies × contacts` (`:851-852`), `activities × (contacts+companies)` (`:906-918`), `leadJobs records × contacts` (`:1735-1750`). **Global write throughput ≈ 1 ÷ transaction duration across *all* tenants** — adding web replicas adds contention, not capacity.

### Concurrency — last-write-wins data loss is real (traced)
Two users in one workspace submit actions A and B concurrently:
1. Both enter `$transaction` with **no `isolationLevel`** → READ COMMITTED (grep for `isolationLevel|Serializable|FOR UPDATE|pg_advisory` in `lib/`+`app/` = **zero hits**).
2. Both `findUnique` the blob with no row lock → both read pre-A state.
3. Both mutate private copies; both `upsert` with `where:{id}`, **no compare-and-set**.
4. B blocks on A's lock, then overwrites the blob computed from the pre-A snapshot. **Everything A changed is erased** — note, activity, audit rows, all of it.
5. Worse: the next full-scope sync's `deleteMany(notIn blobIds)` deletes A's orphaned projection rows too. Only the 6 identity tables self-heal; CRM/lead data has **no recovery path**.

Why it hasn't burned yet: single web instance, one worker, small team, sub-second transactions. The window widens linearly with data volume.

**Latent multi-tenant bug:** `migrateState` runs defaults/backfills **only for `state.workspaces[0]`** (`store.ts:779`). In prod, `workspaces[0]` is the stale demo workspace — so the live "Acme Outbound" workspace systematically gets different treatment. A bug class born directly from the blob shape.

### Incremental migration path (strangler around the blob)
The invariant to protect at every step: **a table is blob-projected XOR Prisma-native, never both** — the `deleteMany(notIn blobIds)` will silently destroy natively-written rows in any table still listed in `upsertOrder`.

- **Phase 0 — stop the bleeding (days):** write-seq CAS on the snapshot; default diff mode; make worker ticks read-first (JSONB slice check before blob RMW — kills ~2,880 idle rewrites/day).
- **Phase 1 — finish the auth peel (80% done):** identity already writes natively via `auth-fast-path.ts`; make the 6 identity tables Prisma-authoritative, delete `mergePrismaIdentityRows` (`store.ts:524-712`) and the write-on-read self-heal. **Reads stop writing.**
- **Phase 2 — peel append-only streams** (`auditLogs`, `activities`, `emailEvents`, `smsEvents`, `jobLogs`, `callLogs`, `notes`, `trackedCalls`): unshift-only, never edited, already have native read models. This is what makes blob size proportional to *entity* count instead of *event* count — the biggest size lever.
- **Phase 3 — real job queue:** `SELECT … FOR UPDATE SKIP LOCKED` on the existing run tables (lease fields + indexes already present). Enables multiple workers and inline processing.
- **Phase 4 — CRM entities** (`contacts`/`companies`/`opportunities`/`tasks`/`sdrAssignments`): read side already native; write side needs per-domain repositories. Sequence around the `migrateState` backfills, whole-state dedupe/enrichment, and the `contacts→crmContacts`+`accounts` derived projections.
- **Phase 5 — delete the blob.**

### Module structure
- **`lib/phase1/` is a god-module** — 100+ files named after a project phase, not a domain. `store.ts` imports domain logic *back* (crm, sdr, outreach, compliance, ai…) because `migrateState` runs domain backfills — an inverted dependency; it's why any domain change risks the read path.
- **`app/actions.ts`** is a second god-module: 3,222 lines, 89 actions, one file gluing every context.
- **Entity duplication as data, not boundary:** `contacts` vs `crmContacts`, `companies` vs `accounts` are derived projections with drift rules baked into sync — a context boundary (lead-engine vs CRM) implemented as duplication.
- Target: `modules/{identity, lead-engine, crm, engagement, compliance, reporting, shared}` each with `domain/ application/ infrastructure/ read-models/`.

---

<a name="4-performance"></a>
## 4. Performance

### Write path — the core problem
Every action (`updateState`, `store.ts:107-144`) does, inside one transaction: full blob read (~3 MB down) → `migrateState` sweep → `mergePrismaIdentityRows` (6 unbounded cross-workspace `findMany`s with per-row `JSON.stringify` equality) → mutate → **full blob write-back (~3 MB up regardless of change size)** → full 71-table projection build → per-table `deleteMany(notIn all ids)` → per-row sequential `upsert`.

For a ~100-byte note (`createNoteAction`, `actions.ts:1004-1044`) that's **byte amplification on the order of 10⁴-10⁵×**, plus every action appends an activity + audit row, so append-only growth makes each *later* action strictly slower (cumulative O(n²)).

Specific offenders:
- **`saveUserTileLayout`** (`tile-layouts.ts:94-123`): full ~3 MB blob RMW **to move a dashboard tile**, on a 250 ms debounce during drag → tens of MB through Neon per editing session.
- **Double blob reads:** `placeCallAction`, `sendCampaignAction`, `sendDirectEmailAction`, `sendAssignedBulkEmailAction`, `sendDirectSmsAction` each call `readState()` then re-read inside `updateState` (`actions.ts:1533/1683/1769/1834/1988`).

### Read path — largely healthy
Page renders use Prisma-backed fast read models (request-deduped via `cache()`, `domain-read-cache.ts:5-9`); the full-blob fallback only fires in file/dev mode. **Still on the full blob in prod:** `/api/calls/[id]` (on a 2 s poll — see below), `/api/exports/[id]`, `/api/rc/*`, `/api/recordings/[id]`, and several service layers.

**Silent truncation past caps:** contacts cap at 500 (`crm-contacts-read-model.ts:57`), calls 200, etc. Pagination is *client-side inside the capped set* — rows beyond the cap are invisible with no affordance. At 692 prod contacts, **>180 contacts are already unreachable** on `/crm/contacts` for an all-records viewer, and the total-count tile disagrees with the list.

### Polling — the egress killer
The dialer polls `/api/calls/{id}` every **2 s up to 30 tries** (`call-button.tsx:89-108`). The handler does `readState()` (`route.ts:9`) = full blob read + 6 identity scans per tick → **~90 MB DB egress per fully-polled call** (estimate at ~3 MB blob). The equivalent point-read is ~1 KB. **This is the single largest per-interaction egress contributor.**

### Missing indexes (vs. queries actually issued)
1. `Activity(workspaceId, occurredAt)` — only prefixed composites exist (`schema.prisma:1135-1137`); `/crm` + `/crm/contacts` do `where{workspaceId} orderBy occurredAt take 1500/2000` → full scan+sort of the fastest-growing table on every render.
2. `TrackedCall(workspaceId, createdAt)` — `calls-read-model.ts:46-48`.
3. `Contact(workspaceId, owner)` — SDR scoping on every SDR page + palette search (`crm-contacts-read-model.ts:150-153`); also fragile (matches by display *name*).
4. `Task(workspaceId, status)` and `Contact(workspaceId, score)` — sort/filter keys with no serving index.

**Heaviest query in the app:** `outreach-dashboard-read-model.ts:145-197` fetches 1500 email + 1000 SMS + 1000 call events with 4-5-way nested `include` (no `select`) and orders across seven nullable timestamps no index can serve.

### Invalidation & rendering
- `updateContactDetailsAction` fires **both** CRM and lead-engine revalidation fans → **~15+ paths for one inline field edit** (`actions.ts:873-874`). Since every page is force-dynamic, the effect is purging the client Router Cache so the next visit to *any* of them is a cold force-dynamic render re-running heavy read models. Scope to the touched detail + its list instead.
- **Softphone on every page:** `CallProvider` statically imports the 1,233-line `softphone-button.tsx` into the shared bundle for all roles, including those who can never call. Wrap `SoftphoneEngine` in `next/dynamic`.
- `/login`, `/reset-password`, `/unsubscribe`, `/invite` are force-dynamic form shells that could be static.

### Top 10 performance wins (impact ÷ effort)
1. **Default `diff` mode** (config-only; 10-100× write reduction).
2. **Point-read `/api/calls/[id]`** (~99.9% egress cut on the hottest endpoint).
3. **`jsonb_set` for tile saves** instead of full blob RMW.
4. **Batch the projection writer** (chunked `createMany … ON CONFLICT`; diff-based deletes).
5. **Dedupe blob reads** in the 5 send/call actions; pass the resolved session into `updateState`.
6. **Add the 4-5 missing indexes.**
7. **Slim the outreach-events read model** (`select` + batched name lookups).
8. **Move `mergePrismaIdentityRows` off the hot read path** (run only after auth mutations, or gate behind a watermark).
9. **Scope the revalidation fan-out** to the touched routes.
10. **Server-side pagination past the caps** (wire the already-parsed `page` param to `skip/take`; drop `notes` from list rows).

---

<a name="5-security"></a>
## 5. Security & correctness

_From the prior dedicated security review (`scratchpad/review/REVIEW-REPORT.md`), which used adversarial skeptics that reproduced the top findings. Summarized here; full evidence in that report._

### Confirmed Critical
1. **Unauthenticated cross-tenant contact suppression via forged SES/SNS webhook.** `app/api/webhooks/ses/route.ts:47-56` auto-confirms any SNS subscription; `verifySnsMessage` (`sns-message.ts:70-91`) validates signature but **never checks `TopicArn`/account** (no allow-list). Attacker → throwaway AWS account → forged Bounce → untagged fallback does a global `contacts.find(email===)` → suppresses any contact in any tenant. **Fix:** TopicARN allow-list; don't auto-fetch unknown SubscribeURLs; default `SYNCORE_SES_QUARANTINE_UNSCOPED=true`.
2. **Seeded superadmin with source-committed password** (`auth-service.ts:24`, `Syncore!2026`). `createSeedState()` is an implicit fallback when no snapshot row exists. **Fix (owner):** verify against live DB, rotate/disable, gate seed behind a dev flag.
3. **Lost updates — no concurrency control** (same as Architecture §3). **Fix:** `isolationLevel:"Serializable"`+retry, or version CAS.
4. **`writeState()` non-transactional → permanent blob↔normalized divergence on crash** (the bulk-import path). **Fix:** wrap both steps in one transaction, or detect+repair drift on read.
5. **Full-blob rewrite + `full` projection default + unbounded op-log growth** — the Neon-egress/OOM lineage (write side still open). **Fix:** default diff; rotate op-log tables.
6. **The only real webhook auth (`verifySnsMessage`) has zero test coverage.**

### Confirmed High (condensed)
- **Cross-tenant dedupe merge** (`dedupe.ts:47-73`, `actions.ts:405-439`) — reproduced with a passing test. **Fix:** require `match.workspaceId === session.workspace.id`.
- **SES untagged bounce = cross-tenant first-match suppression** by default.
- **Suppression bypassed on send after a contact-email edit** (CAN-SPAM/TCPA) — `contact-details.ts:32-98` doesn't re-check suppression; the export path was fixed, sends never were.
- **Rate-limit bypass via spoofable `X-Forwarded-For`** (`rate-limit.ts:58-68`) — defeats login/reset/webhook caps.
- **CSV parser corrupts rows on a stray `"`** (`csv.ts:17-18`); **`estimateLeadJobCost` turns a real `0` into `100`** (`lead-cost.ts:69`); **personal-email dedupe merges distinct people**.
- **Unbounded event-history queries** on hot pages; **command-palette `ILIKE '%term%'` per keystroke, no index**.
- **CSV/formula (DDE) injection in exports** (`csv.ts:70-77` doesn't escape leading `= + - @`).
- **~80 server actions + tenant-isolation guards + manual-send suppression have zero tests.**

### Verified strengths (not findings)
scrypt+salt+timingSafeEqual passwords; HMAC-signed session cookie fail-closed; every nav-gated page enforces server-side RBAC (no client-only gating) incl. SDR row-scoping; read models put `workspaceId` in the `where`; provider creds AES-256-GCM AAD-bound; audit entries derive actor/workspace from the session; webhook idempotency backstopped by a DB unique constraint.

---

<a name="6-testing"></a>
## 6. Testing & CI

### Coverage today
**72 vitest files (71 unit + 1 integration) + 11 Playwright specs.** Dominant unit pattern: `createSeedState()` → call a `lib/phase1/` function → assert on mutated in-memory state (no DB). Genuinely good regression hygiene — several tests encode named production incidents (P0.2, P2.1, the 2026-07-09 OOM idempotency).

### Zero-coverage high-risk modules
| Module | Verdict |
|---|---|
| **`store.ts` write paths** (`updateState`/`updateAuthState`) | **Effectively untested** — no rollback-on-throw, no concurrency, no diff-vs-full equivalence test. The single riskiest untested surface. |
| **`auth-fast-path.ts`** (575 lines) | **Effectively zero** — the test only asserts it defers on the file driver. A parallel auth implementation that can silently drift from `auth-service.ts`. |
| **`verifySnsMessage` + the SES route** | Parsers covered; the signature verify + route handler have **no tests, no signed fixtures**. |
| **`app/actions.ts`** (89 actions) | **Zero tests of any kind.** A wrong `normalizedTables` list silently corrupts the diff projection. |
| **`tenant-isolation.ts` guards, `lead-cost.ts`, all API route handlers (13 files)** | Untested. |

### E2E & CI
- E2E covers render smoke + role nav, palette search, peek, bulk status, datatable, dark mode, inline edit, kanban drag. **Not covered:** login failure/lockout/logout/reset/invite, **workspace switching**, CRM create/delete, **CSV import pipeline**, dialer, webhook ingestion, exports, enrichment.
- CI (`.github/workflows/ci.yml`): lint/typecheck/unit/build/**integration (real Postgres)** all gate — good. But **e2e has `continue-on-error: true`** (`:146`) → **no e2e merge gate**. No dependency audit, no coverage thresholds, no `concurrency` group, no Playwright browser cache.
- Leftover junk from the session-start snapshot (`_tmp-peek.spec.ts`, `playwright.verify.config.ts`) is **already cleaned up** — nothing to do.

### Top testing additions (riskiest first)
1. `tenant-isolation-roundtrip.test.ts` — two-workspace fixture on real Postgres; assert every read model returns zero cross-tenant rows.
2. `store-transactions.test.ts` — rollback-on-throw; `normalizedTables` scoping; **diff-vs-full byte-equivalence** (needed before making diff the default).
3. `ses-webhook-route.test.ts` + signed SNS fixtures — bad signature → no suppression written; wrong token → 401; workspace-tag scoping.
4. `auth-fast-path` integration — result-parity with the snapshot path.
5. Static/AST test asserting every `*Action` calls a permission gate before `updateState`.
6. Make e2e blocking + add auth-flow specs.
7. CI hardening: `concurrency` cancel-in-progress, Playwright cache, `dependabot.yml`, coverage floor on `lib/phase1/**`.

---

<a name="7-maintainability"></a>
## 7. Maintainability & tech debt

### God files
| File | Size | Split direction |
|---|---|---|
| `app/actions.ts` | **3,222 lines, 89 actions** | Split per bounded context (`crm-actions`, `outreach-actions`, `lead-actions`, `auth-actions`…); extract a `withAction(permission, mutator, {normalizedTables, revalidate})` wrapper to kill the repeated `assertPermission → readState → mutate → updateState → revalidate` boilerplate. |
| `app/globals.css` | **3,498 lines** (~3,113 legacy) | ~700-760 dead lines removable now (below); rest migrates page-by-page in the Phase C consistency pass. |
| `lib/phase1/store.ts` | ~1,190 lines | Break out `migrateState`, `mergePrismaIdentityRows`, projection sync into their own modules as the auth/identity peel proceeds. |
| `components/softphone-button.tsx` | **1,233 lines** | Extract a `useWebPhone` seam (already noted as deferred in the UI-elevation plan). |

### Dead code (confirmed by zero-importer grep over the `@/` alias)
- **20 dead components:** 19 shadcn primitives never wired in (`accordion, badge, breadcrumb, calendar, collapsible, hover-card, kbd, label, pagination, popover, progress, radio-group, scroll-area, select, switch, tabs, textarea, toggle-group`, + transitively `toggle`) and an orphaned `components/call-button.tsx` (twin of the live `softphone-button.tsx`).
- **4 removable npm deps:** `@dnd-kit/sortable`, `date-fns`, `next-themes` (theming is custom via `lib/theme.ts`), `@radix-ui/react-slot` (direct dep unused; pulled transitively). Plus `react-day-picker` if the dead `ui/calendar.tsx` goes.
- **`lib/data.ts`:** ~17 of 23 exports dead (seed-only mock data); dead `dashboardSnapshot`/`sdrQueues` chain in `lib/phase1/queries.ts`.
- **~700-760 dead CSS lines** in `globals.css`, headlined by a **289-line block (lines 460-748)** — the entire pre-shadcn shell/sidebar/topbar/nav system, fully superseded by `components/app-shell.tsx` + `components/ui/sidebar.tsx`. Then funnel (84), tier-badge (55), segment (54), toast (43), timeline (32) clusters. (Build-a-Lead-List and GridStack CSS are live — keep.)
- **`scratchpad/` at repo root: 189 untracked files** (deploy scripts, base64 blobs, recovered dumps, the review harness + screenshots), **not gitignored** → clutters `git status`. Delete or gitignore.

### Convention drift
Newer surfaces (shadcn era, `ActionResult`/`ActionForm`, `sonner` toasts, TanStack `DataTable`) coexist with legacy pages (hand-written CSS classes like `.panel`/`.stat-card`/`.button`, native `<form action>`). This is the scope of the planned Phase C consistency pass. Type quality is generally strong (TS strict, few `any`); the notable gap is **no schema validation on server-action `FormData`** — parsing is hand-rolled `stringValue(...)`, so a `zod`-per-action layer would catch bad input and double as documentation.

---

<a name="8-product"></a>
## 8. Product & feature gaps

The data model is genuinely broad (~50 Prisma models incl. a 7-table AI layer; 6 roles; real audit log; encrypted provider vault). Reporting/compliance are **real** — computed conversion funnels, an SDR leaderboard, campaign attribution, retention Preview/Apply runs, data-subject requests. The gaps are concentrated in three areas.

### 8a. The biggest product gap: outreach is UI-without-engine
- **No scheduler/cron/queue drives sends.** The background worker (`scripts/run-background-worker.ts`) runs provider/lead/recording ticks only — it **never touches campaigns or sequences**. Sends happen 100% manually, one batch per button click (`sendCampaignAction`).
- **Multi-step sequences are modeled and displayed but only email step 1 ever sends** (`outreach-send.ts:363` `firstEmailStep`). `delayDays`, `stopOnReply/Bounce/Unsubscribe`, and SMS/call/manual steps are stored but **inert** — no code reads them.
- **No open/click tracking** — the UI shows Opened/Clicked columns but there is **no tracking-pixel route and no click-redirect route**; the SES webhook parses only Bounce/Complaint.
- **Daily send caps, mailbox rotation, send windows, timezone, quiet hours** — shown as meters/fields, **not enforced** in the send path.
- **No A/B testing.** **No reply inbox** — replies land only via an external signed webhook (no mailbox poller) and appear as activity rows, not a conversation thread.
- **What *is* solid, end-to-end:** unsubscribe (link → landing → one-click API → suppression → enforced at send via `isSendEligible`), SES bounce/complaint suppression, the real SES v2 + RingCentral SMS adapters (flag-gated), and RFC-compliant `List-Unsubscribe` headers.

### 8b. Lead-gen: real pipeline, orphaned edges
- **Genuinely working (no live keys needed):** CSV import → normalize → local verify/grade → dedupe scan → local enrich/score/segment → staging → export-rule gating → **CSV download**. Plus LLM ICP drafting (with `OPENAI_API_KEY`) and the full waterfall template editor.
- **Provider-sourced lead jobs orphan forever:** `createLeadJobAction` creates runs for each source, but the lead worker only consumes **CSV** runs (`lead-job-worker.ts:241-244`) — a manual Apollo/Hunter job sits `Queued` indefinitely.
- **Default waterfall templates reference providers with no live adapter** (`zerobounce`/`lusha`/`twilio`) → silent no-ops in live mode; worked around by a hardcoded template in `enrichment/live-actions.ts:14-17`.
- **Search-profile "source health" is static mock data** (fake "12.4k credits", "Mock ready", `queries.ts:35`).
- **Default "enrichment" fabricates fields** via keyword inference and labels providers "Syncore … Local" — easy to mistake for real data. Verification is heuristic (hardcoded disposable-domain set, not MX/SMTP). Only email find/verify have live adapters; company/phone enrichment is mock-only.

### 8c. CRM workflow gaps
- **Accounts have no editing at all** — the snapshot (name, domain, industry, stage, owner) is display-only; **no `updateAccount*` action exists**.
- **Opportunities lose editability after creation** — only stage is mutable (drag/select persists via `updateOpportunityStageAction`); amount, close date, name, owner are read-only. **No win/loss reasons, no forecast category.** Stages are hardcoded (`crm.ts:16`), not configurable.
- **No saved views/filters** (single global text search + sort + URL sync, but not named views). **Column visibility isn't persisted** (resets on reload).
- **Bulk actions exist only on Contacts** (assign SDR / set status / export). Accounts and Opportunities have no selection. No bulk delete/tag/add-to-sequence.
- **CRM-side duplicate merge is absent** — dedupe lives only in the lead pipeline, not on `/crm/contacts` or `/crm/accounts`.
- **Notes are plain text** (no rich text/@mentions/attachments). **Meeting activity type exists but nothing creates it** (no calendar/scheduling). Tasks have due dates but no reminders/notifications.

### 8d. Platform gaps
- **2FA is scaffolded but dead** — `AuthAccount.mfaEnabled` is hard-coded `false` everywhere it's written (`auth-service.ts:47,295`, `auth-fast-path.ts:181`, `provisioning.ts:122`). No TOTP/enrollment. Login is single-factor; no SSO/SAML/OIDC.
- **No in-app workspace switcher** despite a multi-workspace, multi-membership model — switching requires a new session. (This is exactly the "wrong default workspace" footgun noted in project memory.)
- **No per-workspace branding** (`Workspace` has no logo/color/domain fields) — blocks white-label.
- **No in-app notifications** (no bell/inbox/`Notification` model), no digest emails — toasts + transactional email only.
- **No public API, no tenant API keys, no outbound webhooks** — inbound webhooks only.
- **No i18n, no PWA/offline** (responsive layout is good, though — sidebar → Sheet drawer on mobile).
- **Global search is CRM-only, substring (non-fuzzy), and gated to `manage_crm`** — excludes lead-gen entities and non-CRM roles.
- **Call coaching is AI-summary-only** — no manager comments, scorecards, or QA rubric.
- **Permission→role map is code-only** (`permissionsByRole`) — roles aren't customizable per workspace without a code change.

### Highest-value product improvements
1. **Ship a real sequence engine** — a scheduler tick that advances cadences, honors `delayDays`/`stopOnReply`, and sends steps 2+. This is the app's biggest "looks done but isn't" gap and the core value prop of an outbound tool.
2. **Open/click tracking** (pixel + click-redirect routes, or ingest SES open/click events) — currently the UI promises data it never collects.
3. **Wire provider-sourced lead jobs** (or hide the non-CSV sources until wired) so queued jobs don't orphan.
4. **Account + opportunity field editing** (add the missing update actions) — table-stakes CRM.
5. **Saved views + persisted column config.**
6. **Workspace switcher** — directly de-risks the known wrong-default-workspace incidents.
7. Enforce **daily send caps / send windows** (the meters already exist).
8. **Finish or remove 2FA** — a dead security control is worse than none.

---

<a name="9-ops"></a>
## 9. Ops, reliability & observability

_Lean all-AWS stack: one EC2 t4g.small (web + worker as systemd units), RDS t4g.micro, Caddy auto-TLS, Terraform in `deploy/aws/`._

### The urgent one
**The OOM memory guards live only in an on-box drop-in.** `scratchpad/apply-guard.sh` applied `MemoryMax=768M` (worker) / `1400M` (web) via `systemctl set-property`; the committed unit files `deploy/ec2/syncore-{web,worker}.service` have **no `Memory*` directives**. A rebuild from the repo silently loses the fix that prevents a repeat of the 30-min OOM outage. **Commit the guards into the unit files today.**

### Deploy pipeline
- The committed script (`deploy-app.sh`) is initial-install only; the real ongoing deploy is **untracked** (`scratchpad/deploy2.sh`) and **builds on the 2 GB box** (stops services first → ~5 min downtime, and re-creates the exact build+web memory co-peak that caused the OOM).
- **CI already runs a full `next build` and throws the artifact away.** Build in CI, ship the tarball to the existing S3 bucket (the instance role already has `s3:GetObject`), deploy = extract + `prisma migrate deploy` + restart → downtime ~5 min → ~15 s, and the build-OOM failure class disappears.
- **No rollback:** deploys `rm -rf` the release dir. Add versioned releases (`/opt/syncore/releases/<sha>` + `current` symlink, keep 3) → rollback = re-point symlink + restart (~15 s).
- SSM is the config source of truth, but there's **no env-refresh mechanism** — changing an SSM param does nothing until env files are hand-regenerated (drift is undetectable).

### Backups & DR
- RDS has 7-day PITR (the **only** point-in-time recovery for the blob). The S3 bucket exists and is described as "backups" but **nothing writes to it**. Blob dumps are ad-hoc and on the same root volume (die with the instance).
- **RTO is untested** — an RDS restore creates a new endpoint, so you'd also hand-edit the `DATABASE_URL` SSM param and regenerate env files (no script). Practical RPO for blob corruption is "whenever someone notices."
- **Fix (~$0.10/mo):** nightly `pg_dump` + `AppStateSnapshot` JSON export → S3 with a lifecycle rule; script and rehearse the PITR restore drill once.

### Observability — near-zero
- Logs → journald only. **No CloudWatch agent** (though the IAM role already grants `logs:*` on `/syncore/*` — provisioned, never used). **No metrics, no alarms, no `/api/health` route.** The OOM being human-detected is the direct consequence.
- **Minimal stack (~$0-3/mo):** `/api/health` (`SELECT 1` + snapshot age) + external uptime check (free); CloudWatch agent + 5 alarms (mem >85%, swap >50%, disk >80%, SES bounce rate >5%, EC2 status check); a worker heartbeat dead-man switch (healthchecks.io ping per tick — nothing else catches a silently-stopped worker).

### Worker reliability
- Restart policy is sound (`Restart=always`, clean SIGINT tick-finish); in-flight jobs are mostly safe (whole tick is one transaction; provider runs have leases + expiry recovery).
- **Risk — 30 s cap hot loop:** a large CSV tick that exceeds 30 s rolls back *including its attempt counter* → the run stays `Queued` and re-fails identically forever, no dead-letter escape. **Fix:** cap rows per tick / chunk via the existing checkpoint record.
- **Risk — no failure alerting:** `Failed` runs and quarantined webhooks are recorded in state but nobody is notified.

### Security ops
- Port 22 open to a `/32` **and** SSM Session Manager fully set up → SSH is redundant standing surface; go SSM-only.
- **Static AWS keys for SES in env files** despite the instance role granting `ses:SendEmail` — finish the role-based path to delete a long-lived credential.
- **Terraform state is local, on this laptop, and contains the RDS master password + full `DATABASE_URL`** (gitignored, but a disk failure loses state / a compromise leaks the DB). Move to an S3 backend (existing bucket, native lockfile, $0). Commit `.terraform.lock.hcl` (currently gitignored — anti-pattern).
- No `dependabot.yml`/renovate; no `dnf-automatic` for OS patches; Caddy binary never updated.

### Top ops wins
Commit the MemoryMax guards (1) → health route + uptime check (2) → CloudWatch agent + 5 alarms (3) → CI-built artifact (4) → versioned releases/rollback (5) → nightly S3 blob backup + PITR drill (6) → worker heartbeat (7) → commit the real deploy + env-refresh scripts (8) → SSM-only + SES instance role + `dnf-automatic` (9) → remote TF state + Dependabot (10). Items 1-3 are one afternoon and target the exact failure you already had.

---

<a name="10-ui"></a>
## 10. UI / UX

_From the prior design review (65 findings over 80+ screenshots at 1440/768/375; full evidence in `scratchpad/review/REVIEW-REPORT.md`)._

### Highest-priority UI fix
**Systemic `word-break: break-all`** shatters names, emails, currency, and policy labels mid-character — and it's visible at **desktop 1440**, not just responsive: `/compliance` ("Nor/a/Wes/t"), `/reports`, `/access`, and `/automation` (which becomes the tallest page in the app at 7,761 px). On the security/compliance/RBAC surface an admin can't reliably read who they're disabling. **Fix:** give identity/label columns `min-width:~140-160px` + `overflow-wrap:normal`, truncate emails with ellipsis+tooltip.

### Other confirmed high-severity
- **Data tables have no tablet (768px) strategy** — cells letter-wrap or columns silently drop (e.g. `/crm/accounts` drops 4 of 7 with no scroll cue). Fix once at the shared `<DataTable>`: horizontal-scroll wrapper below ~900px.
- **Numeric/currency columns are left-aligned** app-wide — defeats down-column magnitude scanning.
- **Off-brand generic login** — plain gray page, a different wordmark, native-browser validation tooltips; the first/last screen everyone sees. Also clears the email field on a failed attempt.
- **Duplicated KPI rows + dead-space card stretch** on 4 dashboards.
- **Record-peek close "×" overlaps the status badge**; `/crm/my-contacts` clips a per-row action icon at 1440.
- **Positive:** CLS ≈ 0 on all 24 routes; there's a real bespoke navy design system — the problem is utility pages (integrations, access, settings) drifting off it.

### Suspected (need a live pass)
WCAG AA contrast on status pills and muted captions; focus-visible rings / hover / disabled / loading states (unobservable in statics for a very interaction-heavy app); loading skeletons and multi-field server-error banners.

_Note: much of the UI-elevation plan in `.claude/plans/` (dark mode, primitives, DataTable, kanban, peek, inline edit, command palette v2) has already shipped — the design review confirms these exist and work; the findings above are what remains._

---

<a name="11-roadmap"></a>
## 11. Consolidated roadmap

### Do now — hours each, mostly $0 (safety & known incidents)
1. Commit `MemoryMax` guards into `deploy/ec2/*.service` (ops #1).
2. Verify & rotate the seeded superadmin in prod; gate `createSeedState` behind a dev flag.
3. Harden the SES webhook: default `SYNCORE_SES_QUARANTINE_UNSCOPED=true` + TopicARN allow-list.
4. Point-read `/api/calls/[id]` (perf/egress).
5. Add `/api/health` + a free external uptime check.
6. Add the `match.workspaceId` dedupe check + the `X-Forwarded-For` trusted-hop fix.

### Do next — days (data integrity & cost)
7. Write-seq CAS optimistic locking on the snapshot upsert (kills lost-update data loss).
8. Make `diff` projection mode the code default (after a byte-equivalence test).
9. Wrap `writeState` in one transaction; make worker ticks read-first (idle-skip).
10. Re-check suppression in the 3 send block-reason fns + on contact edit; fix the CSV quote-toggle and `lead-cost` 0-case.
11. Add the 4-5 missing Prisma indexes; scope the revalidation fan-out.
12. `jsonb_set` for tile-layout saves; dedupe the double blob reads.

### Do soon — 1-2 weeks (tests, ops maturity, cleanup)
13. Add the highest-value tests: tenant-isolation roundtrip, store-transaction rollback + diff-equivalence, SES-route contract, a permission-gate AST test. Make e2e blocking.
14. CI-built deploy artifact + versioned releases/rollback; nightly S3 blob backup + one PITR drill; CloudWatch agent + 5 alarms + worker heartbeat.
15. Delete dead code: 20 components, 4 deps, ~700 CSS lines (the 289-line legacy shell first), `lib/data.ts` dead exports; gitignore or remove `scratchpad/`.

### Strategic — weeks-to-months (the real ceiling)
16. **Peel append-only streams off the blob** (audit/activity/events/notes/calls) → blob size becomes proportional to entities, not events.
17. **Finish the auth/identity peel** → reads stop writing; delete `mergePrismaIdentityRows`.
18. **Native job queue** (`FOR UPDATE SKIP LOCKED`) → multi-worker safety + a real outreach scheduler.
19. **Ship the sequence engine + open/click tracking** (the biggest product gap).
20. **CRM entities native** (repositories per context) → ends the 30 s-timeout workaround and the quadratic projection build.
21. Split `lib/phase1/` + `actions.ts` into bounded-context modules (enables 16-20 to proceed per-context).
22. Product breadth: account/opportunity editing, saved views, workspace switcher, finish-or-remove 2FA, enforce send caps.
23. UI system pass: remove `word-break:break-all`, DataTable tablet strategy, right-align numerics, brand the auth screens, WCAG-AA + keyboard-focus pass.

---

<a name="12-corrections"></a>
## 12. Corrections & reconciliations

Several agents raised concerns that don't hold up on closer inspection — recorded here so they don't cause false alarms:

- **"Workers never run / aren't wired to the app"** (lead-gen + outreach agents) — true that no *cron/route* ticks the queue, but prod **does** run the background worker as a systemd service (`deploy/ec2/syncore-worker.service`, 5-min loop). So CSV lead jobs *do* process in prod. The genuinely unwired parts are **provider-sourced** lead jobs and **all outreach sequencing**.
- **"Turn on diff mode" as a novel win** (perf agent #1) — diff mode is **already live on AWS prod** via `deploy/aws/ssm.tf:10`. The real, smaller ask is making it the **code default** (`.env.example` still ships `full`) and fail-closed in prod.
- **"`proxy.ts` may be unwired middleware"** (admin/platform agent) — Next.js 16 **renamed** `middleware.ts` to `proxy.ts`; it auto-registers. The prior security review verified the edge auth gate is active. Not a bug.
- **The `migrateState` full-projection-on-read amplifier** — already fixed (PRs #106-#109 made it idempotent). What remains open is the **write-side** full-blob cost, which is what §3/§4 address.
- **Leftover test junk** (`_tmp-peek.spec.ts`, `playwright.verify.config.ts`) — already cleaned up; not present in the current tree.

---

<a name="13-provenance"></a>
## 13. Provenance & limitations

- **Read-only:** no `app/`, `lib/`, `components/`, `prisma/`, or `deploy/` files were modified during this review. All analysis was static reading plus the pre-existing baseline (lint/typecheck/329 tests).
- **The ~3 MB blob size** is the stated prod figure; local dev `store.json` is 252 KB. Per-operation byte figures are estimates scaled to the stated size and labelled as such in the source reports.
- **No local Postgres and one local workspace** → cross-tenant and concurrency findings are code-traced (the dedupe merge was reproduced with a passing in-memory test); they were not live-raced against a two-tenant prod-shaped DB.
- **Prod verification of the seeded superadmin was deliberately not performed** (the security review was scoped local-only) — flagged for the owner to check and rotate.
- **UI contrast/focus/hover/disabled** are SUSPECTED — not measurable from static screenshots; they need a live keyboard + contrast-checker pass.
- Full underlying evidence: the prior security/UI report and per-finding notes live in `scratchpad/review/` (`REVIEW-REPORT.md`, `trackA-findings.md`, `trackB-findings.md`, `DECISIONS.md`, `shots/`).

_Every finding above is anchored to `file:line` in its source dimension. Where a claim could not be verified from code alone, it is labelled estimate, suspected, or speculation._
