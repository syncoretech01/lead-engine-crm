# Blob → Prisma-native migration plan (strangle the `AppStateSnapshot`)

_Status: **plan / not started.** Authored 2026-07-11 from the codebase review (`CODEBASE-REVIEW.md`). This is an executable, incremental plan to invert the source of truth off the whole-app JSON blob and onto the normalized Prisma tables — one domain at a time, with prod never taking a big-bang cutover._

> **The one-line goal:** move *writes* from the blob to the normalized tables, domain by domain, until the blob owns nothing, then delete it. Reads already come from the normalized tables. Auth already writes natively. This is a strangler-fig migration that's ~40% underway by accident — this doc makes the rest deliberate.

---

## 0. Current state (facts)

- **Source of truth** is one Postgres row: `AppStateSnapshot` (`prisma/schema.prisma`, id `"syncore-primary-state"`, `lib/phase1/store.ts:54`) holding ~70 top-level arrays (`lib/phase1/types.ts`, the `AppState` type).
- A **normalized ~71-table projection** is *derived* from the blob on every write via `syncNormalizedProjectionToPrisma` (`lib/phase1/persistence-projection.ts`).
- **Reads already escaped the blob:** page renders use the 15 fast read models (`lib/phase1/*-read-model.ts` / `*-read-path.ts`) that query the projection tables directly. The blob-read fallback only fires under the file-storage (dev) driver.
- **Auth already writes natively:** `lib/phase1/auth-fast-path.ts` writes `users/authAccounts/authSessions/userInvites/workspaceMembers` straight to Prisma; `mergePrismaIdentityRows` (`store.ts:524-712`) reconciles them *back* into the blob on read.
- **The debt is entirely on the write path:** every `updateState`/`updateAuthState`/`writeState` (`store.ts:107-183, 95-105`) reads the whole blob, mutates it, re-serializes the whole thing, and rebuilds the projection. No concurrency control → last-write-wins. O(state) cost per action. This is the lineage of the Neon egress cap and the 2 GB OOM.

> Line numbers drift — always re-read the function before editing. The `file:function` anchors are stable; the `:NN` are as of 2026-07-11.

## 1. End state (target)

- Each domain owns a set of normalized tables and writes them through a **repository** (`prisma.X.create/update/delete` inside a `$transaction`), the way `auth-fast-path.ts` already does.
- `AppStateSnapshot` is gone. `updateState` becomes a thin transaction helper (or is deleted). `migrateState` becomes ordinary Prisma migrations. `syncNormalizedProjectionToPrisma` is deleted.
- Writes are O(rows-changed), transactional, concurrency-safe. Blob size is no longer a concept.

---

## 2. THE INVARIANT that makes this safe

> **A table is blob-projected XOR Prisma-native — never both.**

The projection sync does, per workspace-scoped table (`persistence-projection.ts:1607`):

```ts
await delegate.deleteMany({ where: { workspaceId, id: { notIn: ids } } });
```

So the instant a table is written natively **while still listed in the projection**, the next blob write **deletes every native row that isn't in the blob**. Silent, cross-tenant data loss.

Therefore every peel must, in **one atomic change**, remove the table from all four places at once:
1. `AppState` (the array in `lib/phase1/types.ts`)
2. `projectionTables` (`persistence-projection.ts:113`)
3. `upsertOrder` (`persistence-projection.ts:187`)
4. every write-set that lists it in `lib/phase1/normalized-write-tables.ts`

If a table appears in a `normalizedTables` write-set but not in `AppState`, the projection tries to mirror an array that no longer exists → build error (a good, loud failure). That's the tripwire that keeps the invariant enforced.

---

## 3. The per-domain peel recipe (do this every time)

For a domain **X** (e.g. `auditLogs`, or `contacts`):

- [ ] **Read model exists?** Confirm a `*-read-model.ts` / `*-read-path.ts` already serves X from the projection table. (Almost all do — see §9.) If not, write one first (tight `select`, `workspaceId` in `where`, server-side pagination).
- [ ] **Repository.** Write `lib/<domain>/<x>-repository.ts` with `prisma.X.create/update/delete`, taking a `tx` client so callers can compose in one `$transaction`. Mirror `auth-fast-path.ts`.
- [ ] **Redirect the mutators.** Find the blob mutators (`updateState((s) => s.X.push(...))`, or the `appendAudit`/`addActivity`-style helpers) and point them at the repository.
- [ ] **Remove X from the blob (same commit):** delete from `AppState` type, `projectionTables`, `upsertOrder`, and every `normalized-write-tables.ts` set. Delete X's `migrateState` backfill/`ensureXDefaults`.
- [ ] **Data reconciliation is usually a no-op.** The projection has been faithfully mirroring X all along, so the rows already exist in the table. You're only changing *ownership*. (Verify row counts match before/after in staging.)
- [ ] **Tests:** (1) X is absent from `upsertOrder` (guards the invariant); (2) a write hits the table inside a transaction and rolls back on throw; (3) two-workspace tenant-isolation roundtrip returns zero cross-tenant rows.
- [ ] **Deploy:** `prisma migrate deploy` for any schema change (NOT run by `deploy-app.sh` — it's a separate step), then the standard deploy.

---

## 4. Phases (easiest/safest → hardest)

### Phase 0 — Stop the bleeding (days) — makes the blob *survivable* during the migration
Does not peel anything; buys runway so the multi-month migration isn't racing a growing blob.
- [ ] **Write-seq CAS** on the snapshot upsert (`store.ts` `writeStateToPrisma`): add a monotonic `writeSeq` column; `updateMany({ where: { id, writeSeq: read }, data: { writeSeq: read+1, ... }})`; retry on 0-count. Kills last-write-wins for the blob's whole remaining life. _(This is the deferred item from the hardening pass — needs a Postgres loop to verify.)_
- [ ] **Default `SYNCORE_PROJECTION_MODE=diff`** in code (already on in prod via `ssm.tf`; make it the code default, fail-closed in prod).
- [ ] **Idle-skip worker ticks** — cheap JSONB-slice check before the blob read-modify-write when the queue is empty (pattern at `lead-dashboard-read-model.ts` JSONB reads).
- [ ] **Cap/rotate the op-log arrays** in the blob (`auditLogs`, `jobLogs`, `emailEvents`) — they grow forever via `unshift`. This alone dramatically slows blob growth before Phase 2 removes them entirely.

### Phase 1 — Finish the auth/identity peel (~1 week; 80% done)
The fast path already writes these natively; you're removing the reconcile-back-into-blob machinery.
- **Tables:** `users`, `authAccounts`, `authSessions`, `userInvites`, `workspaceMembers`, `passwordResetTokens` — the set already covered by `auth-fast-path.ts` + `mergePrismaIdentityRows` (`identityReconcileTables`, `store.ts:63-70`). **Handle `workspaces` last / separately** (it's referenced by `migrateState`'s `state.workspaces[0]` defaults and by session resolution — more coupling).
- [ ] Make `auth-fast-path.ts` authoritative; make the blob-based `auth-service.ts` path the file-driver-only fallback.
- [ ] **Delete `mergePrismaIdentityRows`** (`store.ts:524-712`) and the **write-on-read self-heal** it drives (`readStateFromPrisma`, `store.ts:511-519`). ← this is the change that makes **reads stop writing**.
- [ ] Remove the identity tables from `AppState`, `projectionTables`, `upsertOrder`, and `authWriteTables` (`normalized-write-tables.ts:7-15`).
- [ ] Convert `ensureAuthDefaults` from a read-path backfill to a one-shot migration/seed.
- **Payoff:** reads stop emitting writes; session `lastSeenAt` bumps stop rewriting the blob (**the egress driver is gone**); ~190 lines of reconciliation deleted.

### Phase 2 — Peel the append-only event streams (1–2 weeks; THE size lever)
Unshift-only, never edited, already have read models. This makes blob size proportional to **entity** count instead of **event** count — today it grows on *every action forever*.

| Stream | Write happens in | Peel to | Read model |
|---|---|---|---|
| `auditLogs` | `appendAudit` (`store.ts:190`) + `appendWorkspaceAudit` (`tenant-isolation.ts:54`) | `prisma.auditLog.create` | `compliance-read-path.ts`, `dev-dashboard-read-model.ts` |
| `activities` | `addActivity` (`crm.ts:79`) | `prisma.activity.create` | `crm-event-read-path.ts`, `crm-overview-read-model.ts` |
| `emailEvents` / `smsEvents` | `createEmailEvent` / `createSmsEvent` (`outreach.ts`) | `prisma.*.create` | `outreach-read-path.ts`, `outreach-dashboard-read-model.ts` |
| `callLogs` | `createCallLogAction` (`app/actions.ts`) | `prisma.callLog.create` | `calls-read-model.ts` |
| `trackedCalls` | `placeCallAction` + recording worker | `prisma.trackedCall.create/update` | `calls-read-model.ts` |
| `notes` | `createNoteAction` (`app/actions.ts`) | `prisma.note.create` | `crm-detail-read-model.ts` |
| `jobLogs` | job workers | `prisma.jobLog.create` | `lead-dashboard-read-model.ts` |

- **Start with `auditLogs`** — it's in **every** write-set (see §9), the highest-volume stream, and has exactly two write sites (`appendAudit`, `appendWorkspaceAudit`). Change those two helpers to insert via Prisma inside the current transaction, then strip `auditLogs` from all ~24 write-sets + `projectionTables` + `upsertOrder` + `AppState`. Biggest single win in the whole migration.
- Then `activities` (one write site: `addActivity`), then the rest.
- **Note:** these streams appear in *many* write-sets (e.g. `activities` in `crmWriteTables`, `sdrWriteTables`, `aiWriteTables`, `outreach*WriteTables`). The invariant's build-error tripwire makes it obvious if you miss one.

### Phase 3 — Native job queue (~1 week)
- **Tables:** `providerJobRuns`, `asyncJobRuns` (+ `jobLogs` from Phase 2). Lease fields (`lockedBy`/`lockExpiresAt`) and indexes already exist.
- [ ] Move claim from in-blob `status`/`lockedBy` mutation to `SELECT … FOR UPDATE SKIP LOCKED` (or an `updateMany` status-CAS) on the native run tables.
- **Payoff:** durable claims, multi-worker safety, and the real scheduler outreach/Growth OS needs (currently there is none — see `CODEBASE-REVIEW.md` §8a).

### Phase 4 — CRM + lead entities (weeks; the hard one)
- **Tables:** `contacts`, `companies`, `opportunities`, `tasks`, `sdrAssignments`, `sdrTeams`, `followUpReminders`, `rawLeads`, `normalizedRecords`, `verificationResults`, `dedupeMatches`, `enrichmentResults`, `leadScores`, `customFields`/`customFieldValues`, `suppressionRecords`, … (the bulk of `crmWriteTables`, `sdrWriteTables`, `leadGenerationWriteTables`, `enrichmentWriteTables`, `complianceWriteTables`).
- Read side is already native. Write side = per-domain repositories replacing the ~40 CRM/lead mutators in `app/actions.ts`.
- **Sequence around the three hard couplings:**
  1. **`migrateState` backfills that mutate domain data on read** — convert each `ensureXDefaults` to a one-shot migration *first*, so nothing re-seeds on read.
  2. **Whole-state algorithms** — `dedupe.ts`, `enrichment.ts`, `scoring.ts` operate on the entire in-memory state. Re-target them at per-workspace Prisma queries.
  3. **The derived-projection duplication** — `contacts`→`crmContacts` and `companies`→`accounts` are two models for the same records (lead-engine vs CRM context). Decide per pair: keep the CRM view as a real DB **view** over the lead-engine table, or collapse the duplication into one table with a context flag. Do this decision explicitly, not by accident.

### Phase 5 — Delete the blob
- **Remaining config-ish arrays** (segment rules, export rules, provider connections, waterfall templates, outreach setup) become ordinary tables with normal CRUD.
- [ ] Retire `AppStateSnapshot`; delete `syncNormalizedProjectionToPrisma`, `migrateState`, `writeStateToPrisma`, `readStateFromPrisma`. `updateState` becomes a thin `$transaction` wrapper or is removed.
- [ ] Archive a final snapshot to S3 before dropping the row (same pattern as the Neon decommission archive).

---

## 5. Growth OS is the accelerant, not a detour

Every Growth OS entity built native (`Campaign`, `NicheBrief`, `Approval`, `EngagementEvent`, `AuditRun`, `AuditAsset` — per `GROWTH_OS_PLAN.crm.v2.md`) is **Phase 4 done on greenfield**: no data to migrate, no invariant risk, and it forces the team to build the exact target pattern (repository + read model + `$transaction`). By the time you peel the *existing* CRM entities you'll have a proven template and muscle memory. `EngagementEvent` being native from day one is literally **Phase 2 done right**. Building Growth OS the way the v2 plan specifies *is* the first real installment of this migration.

## 6. Standing rules (effective now)

1. **No new feature writes to the blob.** Everything new is Prisma-native (Growth OS already follows this). Stops the hole getting deeper while you climb out. Enforce in review.
2. **Never run a table both projected and native.** Honor the §2 invariant; the build-error tripwire is your friend.
3. **After the pilot, Phase 2 (append-stream peel) is the #1 engineering investment** — biggest lever, easiest peel.
4. Peel one domain per PR. Each PR is independently shippable and reversible.

## 7. Verification / tripwires (how you know it's working)

- After **Phase 1**: `readState` emits **zero** writes (add a test that asserts a read issues no `appendState`/snapshot upsert; watch `state.read` perf logs — no `state.write` follows).
- Blob size **stops growing with daily usage** after Phase 2 (it grows only with new entities, not events).
- Transaction durations drop; Neon/RDS write I/O and egress drop.
- `stateCountMetadata` (`store.ts`) shows the peeled arrays at length 0 (they're gone from `AppState`).

## 8. What NOT to do

- **No big-bang** (dump the blob → rebuild everything native at once). That's the high-risk path that causes outages. Incremental, one domain per PR, always.
- **Don't** attempt Phase 4 (CRM entities) under a pilot deadline.
- **Don't** peel `workspaces` casually — it's load-bearing for session resolution and `migrateState` defaults; give it its own careful step at the end of Phase 1.
- **Don't** skip the `prisma migrate deploy` step on deploy — `deploy-app.sh` does not run it.

---

## 9. Appendix — write-set → domain map (`normalized-write-tables.ts`)

Reference for which write-sets touch a table you're peeling (miss one and the build fails loudly — by design):

- **`auditLogs`** — in **every** write-set (all ~24). Peel first; highest leverage.
- **`activities`** — `crmWriteTables`, `sdrWriteTables`, `aiWriteTables`, `outreachEmailWriteTables`, `outreachSmsWriteTables`, `outreachTrackedCallWriteTables`, `outreachCampaignSendWriteTables`.
- **`emailEvents`** — `aiWriteTables`, `outreachEmailWriteTables`, `outreachCampaignSendWriteTables`.
- **`smsEvents`** — `aiWriteTables`, `outreachSmsWriteTables`.
- **`trackedCalls`** — `aiWriteTables`, `outreachTrackedCallWriteTables`.
- **`callLogs` / `notes`** — `crmWriteTables`.
- **`contacts` / `companies`** — `leadGenerationWriteTables`, `enrichmentWriteTables`, `leadJobWorkerWriteTables`, `crmWriteTables`, `sdrWriteTables`, `aiWriteTables`, `complianceWriteTables`, `outreach*WriteTables`. (Phase 4 — widest coupling.)
- **`crmContacts` / `accounts`** — the derived CRM projections; `crmWriteTables`, `sdrWriteTables`, `complianceWriteTables`, `outreach*`. (Phase 4 — decide view-vs-collapse.)
- **Job tables** (`asyncJobRuns`, `jobLogs`, `providerJobRuns`, `jobIdempotencyRecords`) — `leadGenerationWriteTables`, `leadJobWorkerWriteTables`, `providerJobWriteTables`. (Phase 3.)

_Read the current `normalized-write-tables.ts` before a peel — sets change as domains land._
