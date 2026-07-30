# Growth OS implementation tracker — `lead-engine-crm`

This is the authoritative living implementation tracker for Growth OS work in this repository.
It records what the repository actually does, what has been verified, what remains disconnected,
and the exact next implementation slice. It is not a replacement for the product plan.

**Last repository review:** 2026-07-30

**Implementation baseline:** GitHub `main` at `4713b9c40f2ad5d5e9a99885e5447a32f879244e`
(merged PR #175, accepted ADR-001 cost-ledger architecture)

**Review branch before this tracker commit:** `growth-os/w1-cost-ledger-foundation` at
`4713b9c40f2ad5d5e9a99885e5447a32f879244e`

**Current Growth phase:** **CRM-1 — IN PROGRESS**

**Current contracts dependency:** **`@syncore/contracts` 0.2.1**, locally resolved from
`file:../syncore-contracts` and pinned to tag `v0.2.1` in CI and the EC2 build procedure

## How to use and maintain this tracker

Implementation status in this file is determined in this order:

1. Executable product code and Prisma migrations.
2. Tests that exercise the relevant behavior, with real PostgreSQL evidence preferred over stubs.
3. The current GitHub Actions workflow and recorded run results.
4. Deployment code and observable deployment evidence.
5. Canonical plans and errata, which define intended behavior but do not prove implementation.
6. Historical README and phase documents, which may be stale.

When code and a plan disagree, this tracker records both the implemented reality and the unresolved
plan conflict. Update this file in the same pull request that changes a Growth phase, model,
integration, status, or deployment claim.

Only these implementation statuses are used:

| Status | Meaning |
|---|---|
| COMPLETE | The scoped behavior exists and has direct automated or operational verification appropriate to its risk. |
| IMPLEMENTED — NOT VERIFIED | The implementation exists, but the required runtime, cross-service, staging, or production evidence is absent. |
| IN PROGRESS | A meaningful part exists, but required behavior or acceptance evidence is still missing. |
| BLOCKED | Completion depends on an unresolved external repository, credential, environment, or owner decision. |
| NOT STARTED | No phase-level implementation exists in this repository. Pre-existing legacy capability does not count. |

## Wave implementation history

### Wave 1, Step 1.2 — Contracts v0.2.1 and CRM notification worker — 2026-07-29

**Status: COMPLETE**

Contracts consumption moved from v0.2.0 to the released `v0.2.1` tag at contracts commit
`579a12853641b75b453325f6f08af7bb6521af9b`. The dependency remains
`file:../syncore-contracts`, which is the repository's deliberate sibling-checkout strategy.
`.github/actions/setup-with-contracts/action.yml` now pins `v0.2.1`, the active npm lockfile records
package version `0.2.1`, and `deploy/aws/deploy-app.sh` both documents the tag and refuses an
on-host build if the sibling package version is not exactly `0.2.1`. No Contracts schema was copied
into this repository. The corrected v0.2.1 approval fixture hash is now consumed directly.

The production delivery path remains PostgreSQL/Prisma-native. Migration
`20260729200000_growth_os_notify_delivery_leases` adds `deadLetteredAt`, `claimedBy`, `claimToken`,
and `claimExpiresAt` plus a claimability index. `drainNotifyOutbox` atomically claims one due row at
a time with `FOR UPDATE SKIP LOCKED`, a unique claim token, worker ownership, and a bounded lease.
It holds no transaction during HTTP. Expired leases are reclaimable after process termination.
Settlement checks the owner and token so a worker cannot settle a claim another worker recovered.

The canonical `NotifyEnvelope` body is still serialized once and stored verbatim. Each delivery
attempt refreshes only `X-Syncore-Timestamp` and its HMAC over the exact unchanged body bytes; the
event ID, delivery ID, and nonce remain stable for Bot deduplication. The current configured Bot
URL is the send target/allow-list, production requires HTTPS, the request has a bounded timeout,
and only the Growth Bot's documented `202 {status:"accepted",deduped:boolean}` and
`200 {status:"duplicate"}` acknowledgements settle a row. Malformed success bodies, non-2xx
responses, timeouts, and connection failures are explicit retryable errors.

Retries preserve the attempt count, enforce `nextAttemptAt`, start at the configured base delay,
double exponentially, and cap at the configured maximum. Exhausting the configured maximum sets
`deadLetteredAt` and stops further claims. Structured delivery events contain notification ID,
delivery ID, workspace ID, event type, kind, attempt count, correlation ID, worker ID, recovery
flag, result, and safe error code; they contain no URL, headers, secret, token, or payload. The
existing `/api/health` route exposes safe pending, active-claim, repeatedly-failing, dead-letter,
and oldest-pending-age aggregates.

`scripts/run-background-worker.ts`, the real systemd entry point, now calls the shared
`runBackgroundWorkerTick`, which preserves the provider, lead, recording, and daily-report lanes
and adds NotifyOutbox delivery. It handles both SIGINT and SIGTERM, wakes immediately from its idle
interval, finishes the one in-flight bounded request, claims no further row, and then disconnects
Prisma. A hard termination remains recoverable through lease expiry.

Environment and deployment settings added/documented:

- `SYNCORE_BOT_NOTIFY_URL` and `SYNCORE_BOT_NOTIFY_SECRET`;
- `SYNCORE_BOT_NOTIFY_TIMEOUT_MS` and `SYNCORE_BOT_NOTIFY_LEASE_MS`;
- `SYNCORE_BOT_NOTIFY_MAX_ATTEMPTS`;
- `SYNCORE_BOT_NOTIFY_RETRY_BASE_MS` and `SYNCORE_BOT_NOTIFY_RETRY_MAX_MS`;
- `SYNCORE_BOT_NOTIFY_BATCH_SIZE`;
- the previously undocumented `SYNCORE_CHAT_API_TOKEN` and `SYNCORE_HUB_URL` were also added to
  the shared example/deployment configuration.

Files changed in Step 1.2:

- dependency/CI: `package-lock.json`, `.github/actions/setup-with-contracts/action.yml`;
- schema/runtime: `prisma/schema.prisma`, the new migration, `lib/growth/notify.ts`,
  `lib/growth/notify-outbox.ts`, `lib/phase1/background-worker-runner.ts`,
  `scripts/run-background-worker.ts`, and `app/api/health/route.ts`;
- consumer alignment: `lib/growth/approval-hash.ts`, `tests/unit/growth-approval-hash.test.ts`,
  `tests/unit/growth-notify.test.ts`, `tests/unit/growth-contracts-version.test.ts`,
  `tests/unit/growth-notify-worker.test.ts`, and
  `tests/integration/growth-notify-outbox.test.ts`;
- configuration/deployment: `.env.example`, `deploy/ec2/worker.env.example`,
  `deploy/ec2/web.env.example`, `deploy/ec2/syncore-worker.service`,
  `deploy/aws/deploy-app.sh`, `deploy/aws/README.md`, and `docs/EC2_WORKER_SETUP.md`;
- guidance/history: `CLAUDE.md`, `docs/CRM-1-CONTRACTS-FEEDBACK.md`, and this tracker.

Verification evidence:

- `npm ls @syncore/contracts --depth=0`: `@syncore/contracts@0.2.1`;
- contracts consumer/focused unit tests: 5 files, 46 tests, all passed;
- full unit lane: 100 files, 612 tests, all passed;
- PostgreSQL 16 migration run: all 17 migrations applied to isolated local database
  `lead_engine_crm` on port 55432;
- focused real-PostgreSQL outbox lane: 1 file, 9 tests, all passed;
- full real-PostgreSQL integration lane: 8 files, 39 tests, all passed;
- projection invariant, Prisma generation/validation, lint, TypeScript, and Next.js production build:
  all passed. Playwright was not required or rerun for this worker-only step.

Delivery semantics remain **at least once**. The unavoidable duplicate edge is a crash after the
Bot accepts the request but before CRM settlement, or a pathological pause longer than the lease.
The stable event/delivery ID lets the current Bot return its idempotent `duplicate` acknowledgement,
which the CRM treats as success. Exactly-once delivery is not claimed. Live credentials, a deployed
migration, an external heartbeat/alert rule, and a joint CRM-to-real-Bot run remain deployment
evidence gaps; local PostgreSQL and fake-Bot coverage do not prove production rollout.

Deferred deliberately: transactional approval-event creation, chat-route notification creation,
initial `APPROVAL_REQUESTED`, NICHE_TEST business side effects, joint Bot testing, and all CRM-2
work. The next exact step is **Wave 1, Step 1.3 — NICHE_TEST approval side effects**.

### Wave 1, Step 1.3 — NICHE_TEST approval side effects — 2026-07-29

**Status: COMPLETE**

Requested: turn a final approved `NICHE_TEST` into the authoritative approved `NicheBrief`, exactly
one native Growth OS `Campaign`, the safe initial campaign timeline, and one durable final-decision
notification. Repeated requests, Slack callbacks, concurrent decisions, transaction retries, and
process replay had to remain exactly-once at the database state level. Declined, revised, pending,
expired, superseded, malformed, cross-workspace, missing-chain, and non-`NICHE_TEST` approvals had
to create no campaign. No provider, Hub, verifier, Mailshake, Audit Bot, paid work, CRM-2, or
CostEntry/ProviderUsageLedger architecture change was permitted.

Implemented sequence:

1. Dashboard actions and the bearer-authenticated chat decision route call the single
   `decideApprovalWithSideEffects` application service.
2. A serializable PostgreSQL transaction locks the authoritative Approval row with `FOR UPDATE`.
   Serialization conflicts retry as new transactions up to the bounded attempt limit.
3. A pending approval is checked for optional CRM-policy expiry. A `NICHE_TEST` payload is parsed
   with Contracts v0.2.1, its type is compared with the stored column, and its SHA-256 is recomputed
   from the Contracts-canonical payload before any decision write.
4. The service resolves the payload's NicheRequest and NicheBrief plus the brief's completed
   ResearchRun. It verifies one workspace, the current brief-to-approval pointer, request/run/brief
   pointers, completed research, `briefed` request state, and exact stored-document equality with
   the approved payload.
5. The existing T2 decision behavior runs inside that same locked transaction. The first actor
   leaves the Approval pending; the same actor cannot occupy the second slot; only a second distinct
   actor reaches final approval.
6. A final approved `NICHE_TEST` calls `markNicheBriefApproved`, creates or reuses the one Campaign
   whose `originApprovalId` is that Approval, links the Approval back to the Campaign, records
   `sideEffectsAppliedAt`, and creates the two canonical initial stage rows.
7. `RESEARCH` is recorded as `COMPLETED`, using the authoritative ResearchRun completion time;
   `HUB_SEARCH` is created `PENDING`. No stage is `RUNNING` or spend-approved. Later paid/external
   stages are not pre-created because their estimates and approvals do not exist yet.
8. One deterministic `APPROVAL_DECIDED` event is upserted into NotifyOutbox inside the transaction.
   It references the authoritative Approval and Campaign and includes safe request/run/brief/hash
   audit identifiers. The HTTP request performs no Bot delivery; the Step 1.2 worker delivers later.
9. Commit makes the decision, brief, campaign, stages, links, and outbox visible together. Any
   validation, injected, or database failure rolls all of them back.

Revision remains immutable: the old Approval becomes `superseded`, a successor gets a fresh
canonical hash, and a `NICHE_TEST` revision advances the still-pending NicheBrief pointer/document
to that successor without creating a Campaign. A later final decision on the successor uses the
same application sequence while the original Approval payload/hash remain unchanged.

Database and idempotency changes are in migration
`20260729214000_growth_os_niche_approval_side_effects`:

- `NicheBrief.approvalId` is now a unique foreign key to the current Approval;
- `Campaign.originApprovalId` is a nullable unique foreign key for rolling compatibility and is
  the one-Campaign-per-final-approval authority;
- `CampaignStageRun.orchestrationKey` is nullable and unique. Only the two initialization rows use
  it, so later legitimate retry/history rows of the same stage type remain possible;
- `Approval.expiresAt` is optional CRM policy metadata outside the Contracts payload/hash;
- `Approval.sideEffectsAppliedAt` records application audit time; and
- `NotifyOutbox.eventId` remains the unique authority for one final notification.

The migration is additive and compatible with the native-versus-projection guard. The previous
application can run while the nullable columns are present. Rollback requires deploying the old
application first, then dropping the two new foreign keys, four indexes, and four columns; doing so
loses origin, orchestration, expiry, and application audit metadata but not the immutable Approval
payload/history. Real PostgreSQL also proves a full legacy projection cleanup leaves Approval,
NicheBrief, Campaign, CampaignStageRun, and NotifyOutbox rows intact.

Files changed in Step 1.3:

- orchestration/routes: `lib/growth/approval-orchestration.ts`,
  `lib/growth/repositories/approval-repository.ts`,
  `lib/growth/repositories/campaign-repository.ts`, `lib/growth/notify-outbox.ts`,
  `app/approvals/actions.ts`, `app/api/approvals/[id]/decide/route.ts`;
- M2M boundary: `lib/phase1/auth-routes.ts`, `proxy.ts`;
- schema/migration: `prisma/schema.prisma` and
  `prisma/migrations/20260729214000_growth_os_niche_approval_side_effects/migration.sql`;
- tests/CI: `tests/unit/growth-approval-orchestration.test.ts`,
  `tests/unit/growth-chat-auth-routes.test.ts`,
  `tests/integration/growth-approval-side-effects.test.ts`,
  `tests/e2e/growth-approval-side-effects.spec.ts`, `playwright.config.ts`, and
  `.github/workflows/ci.yml`;
- documentation: `CLAUDE.md`, `docs/CRM-1-BRIEF.md`, and this tracker.

Verification evidence at Step 1.3 close:

- full unit lane: 102 files, 624 tests, all passed;
- focused real-PostgreSQL orchestration lane: 1 file, 13 tests, all passed;
- full real-PostgreSQL integration lane: 9 files, 52 tests, all passed;
- blocking Growth OS Playwright lane: 5 tests passed against Next.js plus PostgreSQL;
- Prisma format/generation/validation, migration from an empty PostgreSQL 16 database, projection
  invariant, lint, TypeScript, and production build: all passed.

Known limitations and deferred evidence: initial `APPROVAL_REQUESTED` is still not enqueued with
brief/approval creation; chat revision notification is not yet transactional; the Bot actor header
is trusted after shared-bearer authentication; delivery remains at least once; the real Growth Bot,
staging, and production have not run this migration/flow. The exact next implementation step is
**Wave 1, Step 1.4 — resolve the CostEntry versus ProviderUsageLedger architecture**. No Step 1.4
code or ADR was begun here.

### Wave 1, Step 1.3A — transactional approval-notification lifecycle — 2026-07-30

**Status: COMPLETE**

This inserted closure step was required because Step 1.3 made final decisions atomic but deliberately
left two CRM-side P1 gaps: initial actionable approvals had no `APPROVAL_REQUESTED` row, and revision
notifications were either post-commit on the dashboard or absent on the machine route. It also found
that the machine bearer authenticated the Bot but did not prove the reported actor belonged to the
reported workspace. Step 1.3A closes those CRM-side gaps without changing Contracts, delivering to
the Bot inline, rebuilding Campaign orchestration, starting Growth Bot work, or touching the cost
ledger.

The implemented lifecycle is:

1. `createApproval` requires a stable business idempotency key, validates the Contracts v0.2.1
   payload, and creates or replays the authoritative pending Approval in a serializable transaction.
2. Before that transaction commits, `enqueueApprovalRequestedNotification` upserts one signed
   `APPROVAL_REQUESTED` envelope. The envelope carries the authoritative Approval ID, workspace
   route, type, status, required approver count, expiry, requester, hash, and display payload.
3. `createNicheBriefWithApproval` locks the completed ResearchRun. The stable key
   `niche-test:{researchRunId}` plus unique `NicheBrief.researchRunId` means retries, concurrent
   workers, lost HTTP acknowledgements, and process replay return the same brief and Approval.
4. An already-expired or Contracts-invalid initial approval is rejected before creation; replay of
   a now-non-actionable row cannot mint a new requested event. An injected failure after Approval
   and outbox writes rolls back both and the NicheBrief/pointer updates.
5. `reviseApproval` now row-locks the original inside the same bounded serializable-retry boundary.
   It persists the Contracts revision reason on the replacement, leaves the original payload/hash
   immutable, links the replacement with `supersedesApprovalId`, and advances the pending brief.
6. The revision transaction upserts one `APPROVAL_REVISED` event for the immutable original and one
   `APPROVAL_REQUESTED` event for the actionable replacement. A replay returns the existing
   successor. Unique successor/creation keys and unique outbox event IDs prevent duplicate chains
   or notifications under concurrent requests or transaction retries.
7. Dashboard and machine revision surfaces now call that same transaction-owning repository verb;
   neither performs a post-commit enqueue. Decision surfaces continue using Step 1.3's single
   locked service. Approved/declined final events remain `APPROVAL_DECIDED`; the first T2 approver
   emits no final event, and a second distinct approver emits one.
8. The proxy still forwards only the exact self-authenticating machine paths without a browser
   cookie. Each route first validates the fail-closed constant-time bearer and required headers,
   then verifies the reported actor is an `ADMIN` or `MANAGER` member of the stated workspace before
   parsing or mutating the approval. Missing/invalid bearers and cross-workspace actors return
   `401`/`403` and produce no Approval, decision, revision, Campaign, or outbox side effect.

Contracts v0.2.1 has no typed user/channel recipient field in `NotifyPayload`; its canonical routing
authority is the envelope `workspaceId`, while `payload` is the open Contracts `Meta` render object.
The CRM therefore includes workspace routing and the available approval display/audit fields, and
the Growth Bot remains responsible for selecting the configured approval channel/recipients within
that workspace. No local Contracts event or schema was invented.

Deterministic database event identities are SHA-256-derived from the immutable Approval ID and
event meaning:

- `approval-requested:{approvalId}` for initial and replacement actionable approvals;
- `approval-revised:{originalApprovalId}` for supersession;
- `approval-awaiting-second:{approvalId}` for the distinct T2 continuation prompt; and
- `approval-decided:{approvalId}` for final approval or decline, preserving Step 1.3 identity.

Migration `20260730120000_growth_os_approval_notification_lifecycle` is additive:

- nullable unique `Approval.creationKey` supports legacy rows while requiring stable identity for
  every new repository-created approval;
- nullable unique `Approval.supersedesApprovalId` makes one successor per original a database rule;
- nullable `Approval.revisionReason` persists the v0.2.1 revision request reason; and
- unique `NicheBrief.researchRunId` makes one canonical brief/initial approval per completed run.

Rollout must preflight legacy data for duplicate `NicheBrief.researchRunId` and
`Approval.supersedesApprovalId` values because the unique indexes intentionally fail closed rather
than choose a survivor. The old application tolerates the nullable Approval columns but should not
write concurrently during index rollout. Rollback deploys the old application first, drops the
three unique indexes and two new columns, and recreates the prior non-unique supersession index;
doing so removes replay guarantees and revision reasons but does not alter immutable payloads.
All affected tables remain native and the projection invariant remains armed.

Files changed in Step 1.3A:

- lifecycle: `lib/growth/approval-notifications.ts`, `lib/growth/transaction.ts`,
  `lib/growth/approval-orchestration.ts`, `lib/growth/repositories/approval-repository.ts`,
  `lib/growth/repositories/niche-brief-repository.ts`, and `app/approvals/actions.ts`;
- machine security/routes: `lib/growth/chat-auth.ts`,
  `app/api/approvals/[id]/decide/route.ts`, and `app/api/approvals/[id]/revise/route.ts`;
- schema: `prisma/schema.prisma` and
  `prisma/migrations/20260730120000_growth_os_approval_notification_lifecycle/migration.sql`;
- tests: `tests/unit/growth-approval-notifications.test.ts`,
  `tests/unit/growth-approval-repository.test.ts`, `tests/unit/growth-chat-auth.test.ts`,
  `tests/unit/growth-schema-invariants.test.ts`,
  `tests/integration/growth-approval-notification-lifecycle.test.ts`,
  `tests/integration/growth-approval-side-effects.test.ts`, `tests/integration/growth-spine.test.ts`,
  and `tests/e2e/growth-approval-side-effects.spec.ts`;
- documentation: `CLAUDE.md`, `docs/CRM-1-BRIEF.md`, and this tracker.

Verification evidence at Step 1.3A close:

- `npm test -- --run`: 103 unit files, 633 tests, all passed;
- `npx vitest run tests/unit/growth-approval-notifications.test.ts tests/unit/growth-approval-repository.test.ts tests/unit/growth-chat-auth.test.ts tests/unit/growth-chat-auth-routes.test.ts tests/unit/growth-approval-orchestration.test.ts tests/unit/growth-notify-worker.test.ts tests/unit/growth-schema-invariants.test.ts`:
  7 focused approval/notification/auth/worker files, 67 tests, all passed;
- with `DATABASE_URL` set to the isolated PostgreSQL 16 database and
  `SYNCORE_RUN_DB_INTEGRATION=1`,
  `npm run test:integration -- tests/integration/growth-approval-notification-lifecycle.test.ts`:
  1 lifecycle file, 10 tests, all passed;
- with the same environment,
  `npm run test:integration -- tests/integration/growth-approval-side-effects.test.ts tests/integration/growth-spine.test.ts`:
  2 existing approval/Campaign spine files, 21 tests, all passed;
- with the same environment, `npm run test:integration`: 10 files, 62 tests, all passed,
  including Step 1.2 outbox delivery;
- `npx playwright test --grep "Growth OS"`: 6 blocking tests passed against Next.js plus the
  isolated PostgreSQL database;
- `npx prisma migrate deploy` applied all 19 migrations from an empty PostgreSQL 16 database;
- `npx prisma format --check`, `npx prisma generate`, `npx prisma validate`,
  `npm run check:projection-invariant`, `npm run lint`, `npm run typecheck`, and `npm run build` all
  exited zero; the build used Next.js 16.2.7.

Outcome summary:

- full unit lane: 103 files, 633 tests, all passed;
- focused approval/notification/auth/worker unit lane: 7 files, 67 tests, all passed;
- focused real-PostgreSQL lifecycle lane: 1 file, 10 tests, all passed;
- existing PostgreSQL approval/campaign spine regression: 2 files, 21 tests, all passed;
- full real-PostgreSQL integration lane, including Step 1.2 outbox delivery: 10 files, 62 tests,
  all passed;
- blocking Growth OS Playwright lane: 6 tests passed against Next.js plus PostgreSQL;
- all 19 migrations applied from empty PostgreSQL 16; Prisma format/generation/validation,
  projection invariant, lint, TypeScript, and the Next.js 16.2.7 production build passed.

Remaining evidence is external: no real Growth Bot consumed these new envelopes, and staging and
production have not applied this migration/commit. Delivery remains at least once and depends on
Bot deduplication by stable event ID. The shared bearer still trusts the Bot's actor assertion after
CRM membership/role authorization; per-human signed identity is a future cross-repository security
decision, not local schema drift. Remaining CRM-1 work is the same-record live Bot acceptance and
deployment evidence. The exact next step remains **Wave 1, Step 1.4 — CostEntry versus
ProviderUsageLedger ADR and decision**. Step 1.4 was not begun.

### Wave 1, Step 1.4A — Growth OS cost-ledger architecture decision — 2026-07-30

**Implementation status: COMPLETE**

**Decision status: ACCEPTED**

**Accepted option: Option C — separate operational provider usage from financial cost events**

Decision metadata:

- **Decision date:** 2026-07-30
- **Approver:** Syncore Tech project owner
- **ADR:** `docs/adr/ADR-001-growth-os-cost-ledger.md`
- **Binding erratum:** `GROWTH_OS_ERRATA.md`, entry 6

This documentation-only step was required because the canonical plans simultaneously require one
existing `ProviderUsageLedger`, forbid native Growth data from entering blob-projected tables, and
refer to paid actions as `CostEntry` writes. CRM-1 chose a safe physical seam—legacy
`ProviderUsageLedger` plus native `CostEntry` and a combined read—but did not establish the durable
ownership, financial semantics, or migration decision. No Prisma, migration, repository, runtime,
API, dependency, test-code, or cost-writing behavior was changed in Step 1.4A.

Evidence reviewed:

- this tracker, `CLAUDE.md`, `docs/CRM-1-BRIEF.md`, the Lead Engine CRM repository plan, v9.1,
  the execution roadmap, errata, campaign-waterfall/provider-execution plans, and blob-migration
  rules;
- all Prisma definitions and migrations for `ProviderUsageLedger`, `CostEntry`, `Campaign`, and
  `CampaignStageRun`;
- all application writes and reads of both cost models, including `recordProviderUsage()`, provider
  jobs, live/mock execution, enrichment, waterfall execution, default/seed repair, budget and money
  calculations, and Growth cost reads;
- the complete AppState projection lifecycle: mapping, table/write-list membership,
  workspace-scoped cleanup, upsert, and projection invariants;
- Contracts v0.2.1 approval, provider, stage, cap, estimate, and spend-exception shapes;
- current unit/integration/projection coverage and future CRM-3 through CRM-8 requirements for
  research, paid data, MillionVerifier, Audit Bot scan/full/video, personalization models,
  Mailshake/outreach, reconciliation, and unit economics.

The evidence establishes:

1. `ProviderUsageLedger` is a legacy, AppState-owned operational provider-usage table. It is in the
   projection table list, workspace `upsertOrder`, and four normalized write-table sets.
2. Projection sync deletes workspace rows whose IDs are absent from the blob and then upserts blob
   values. A native financial row inserted directly into this table can therefore be deleted or
   overwritten silently. The Growth projection guard cannot protect such a row because this legacy
   table is intentionally projected.
3. `CostEntry` is native and protected from the projection, but its current schema is only a CRM-1
   seam. It has campaign/stage attribution and aggregate helpers, but no writer, approval/
   authorization/idempotency/source-event fields, complete currency semantics, or direct tests.
4. The combined `listCostEntries()` read model merges both tables by time. Campaign/stage totals use
   `CostEntry` only. The union is unverified, exposes too little reconciliation context, and its
   timestamp-only cursor can skip equal-timestamp rows.
5. No trustworthy migration can infer campaign, stage, approval, or authorization identity for
   historical legacy provider rows.

Options analyzed fairly in `docs/adr/ADR-001-growth-os-cost-ledger.md`:

- **Option A:** use `CostEntry` for all native Growth costs, retain legacy
  `ProviderUsageLedger`, and present one combined logical ledger;
- **Option B:** peel and extend `ProviderUsageLedger`, move all Growth writes into it, and retire or
  migrate `CostEntry`; and
- **Option C:** keep `ProviderUsageLedger` as operational provider evidence, make `CostEntry` the
  native financial control ledger, link/reconcile provider-backed actuals, and expose one
  authoritative financial reporting view.

Sol recommended Option C because it gives each physical table one owner and one semantic role,
prevents projection-driven financial data loss, supports non-provider costs, preserves immutable
authorization/reconciliation history, avoids guessing legacy attribution, and defers the broad blob
peel. On 2026-07-30, the Syncore Tech project owner reviewed and formally accepted that
recommendation. "One ledger" now binds the repository to one authoritative public Growth financial
model, not one physical table that mixes mutable provider telemetry with financial control events.

Binding ownership rules:

- `CostEntry` is the authoritative Prisma-native Growth financial control ledger.
- `ProviderUsageLedger` is legacy, `AppState`-projected operational provider evidence.
- Native Growth financial writes to the projected `ProviderUsageLedger` are prohibited.
- Only authoritative `CostEntry` financial events contribute to Growth OS spend, campaign spend,
  stage spend, budget consumption, authorization reconciliation, overrun calculations, and unit
  economics.
- A linked provider-usage row is supporting evidence, not an additional financial charge; the
  evidence and financial event must never be counted twice.
- Growth financial events are append-only. Corrections require explicit adjustment or reversal
  events rather than destructive updates or deletion.
- Historical campaign, stage, approval, authorization, and financial-action attribution must not be
  guessed without authoritative evidence.
- Existing legacy and native rows remain preserved.
- The legacy blob ownership peel remains separately deferred and is not required before the pilot.
- The current timestamp-only combined read is a compatibility seam, not the final authoritative
  public financial model.

Implementation status after human acceptance:

| Item | Status | Current fact |
|---|---|---|
| Architecture decision | COMPLETE | ADR-001 Option C defines the binding ownership and reporting model. |
| Human acceptance | COMPLETE | Syncore Tech project owner accepted Option C on 2026-07-30. |
| Binding erratum | COMPLETE | `GROWTH_OS_ERRATA.md` entry 6 supersedes direct-write and one-physical-table instructions. |
| Product implementation | NOT STARTED | Acceptance changes documentation only and authorizes no runtime work. |
| Prisma schema changes | NOT STARTED | The exact additive schema is not approved or implemented. |
| Cost writers | NOT STARTED | No native Growth financial writer exists. |
| Budget gates | NOT STARTED | No Growth campaign/stage budget gate consumes financial events. |
| Reconciliation | NOT STARTED | Actual-versus-authorization and overrun behavior are not implemented. |
| Public financial read model | NOT STARTED | The existing timestamp union remains a temporary, unverified compatibility seam. |
| Environment row inventory | NOT STARTED | Staging and production tables have not been inventoried. |

Remaining requirements before implementation:

1. Inventory staging and production rows in both tables.
2. Identify currencies and invalid or missing currency values.
3. Identify duplicate candidates.
4. Identify orphaned campaign, stage, approval, provider-job, and provider-run references.
5. Determine whether any `CostEntry` rows exist outside known application writers.
6. Define the exact additive schema.
7. Define immutable financial event kinds.
8. Decide whether authorization is a financial event or a linked immutable authorization record.
9. Define reservation and release behavior.
10. Define partial charges, refunds, credits, tax, and overrun behavior.
11. Define typed service identities for non-provider costs.
12. Define stable composite pagination.
13. Define no-double-counting and evidence-link constraints.
14. Define database tenant-consistency constraints.
15. Define rollout and rollback preflight queries.

Acceptance does not approve a final schema or paid execution. The exact next step is **Wave 1,
Step 1.4B — implement the additive `CostEntry` financial-ledger foundation**. Step 1.4B was not
started in this branch; do not begin CRM-2 or Growth Bot work as part of this acceptance.

### Wave 1, Step 1.4B — additive CostEntry financial-ledger foundation — 2026-07-30

**Implementation status: COMPLETE**

ADR-001 Option C and `GROWTH_OS_ERRATA.md` entry 6 remain binding. This step establishes the safe
repository foundation only: it does not dispatch providers, authorize paid work, implement the full
campaign budget gate, update `CampaignStageRun` cost caches, or create spend exceptions.

Environment inventory actually performed:

- **Local/integration:** PostgreSQL 16.14 (`postgres:16`, isolated port 55434), inventory tool
  version 1, read-only `REPEATABLE READ` transaction. After the normal seed, `CostEntry` contained
  0 rows and `ProviderUsageLedger` contained 12 USD operational rows in `workspace-syncore`: three
  `syncore_local_demo/seeded_lead_job_cost`, four local company-enrichment, and five local
  contact-enrichment rows. Nine enrichment rows had no provider job/run reference, matching the
  legacy operational shape. No duplicate, orphan, cross-workspace, metadata-size, or structural
  hazard was reported; `safeToProceed` was `true`.
- **Pre-migration fixture:** one representative historical `CostEntry` and one
  `ProviderUsageLedger` row were inventoried read-only before the foundation migration and again
  afterward. Both remained; the historical financial kind, currency, and command identity remained
  null rather than being guessed.
- **Staging:** NOT STARTED — no staging credential or environment was available.
- **Production:** NOT STARTED — no production credential was available. Read-only inventory is a
  deployment gate; no production data was queried or changed.

Schema and migration:

- Migration: `prisma/migrations/20260730190000_growth_os_cost_entry_foundation/migration.sql`.
- Enums: `FinancialEventKind` = `ESTIMATE`, `AUTHORIZATION`, `ACTUAL`, `ADJUSTMENT`, `REVERSAL`;
  `FinancialReconciliationStatus` = `NOT_APPLICABLE`, `PENDING`, `RECONCILED`, `DISPUTED`.
- Existing provider and unit columns were safely relaxed to nullable so non-provider or non-unit
  costs do not require fictional values. No existing column or row was dropped, renamed, copied,
  reclassified, or backfilled.
- Nullable historical-compatible fields add Approval, ResearchRun, provider job/run/evidence,
  adjustment/reversal, service, cost-action, command, source event/line, content hash, occurrence,
  currency, amount, reconciliation, and authorization identities. The repository requires every
  mandatory field for all new events.
- Workspace command identity is unique. Source system/event/kind is unique both with and without a
  partial-actual source line. Provider evidence may link to one financial event. One target may be
  reversed once. Indexes cover workspace/Campaign/stage occurrence order, cost action, source,
  Approval, ResearchRun, provider job/run, and evidence lookup.
- Additive `NOT VALID` checks enforce complete new-event identity, normalized currency, amount
  semantics, safe metadata size, stage/Campaign pairing, provider-run/job pairing, evidence only on
  actuals, correction targets, and authorization identity without scanning or rewriting history.
- Native Campaign, stage, Approval, and Research tenant relationships have database-enforced
  composite constraints for new writes. Provider job, run, and evidence IDs intentionally are not
  foreign keys: all three remain projection-owned, so an FK would mutate immutable financial facts
  or block legacy cleanup. The repository validates their existence, workspace, provider, parent
  job, and evidence chain inside the serializable append transaction.
- `ProviderUsageLedger` received no column, ownership, writer, AppState mapping, cleanup, or
  lifecycle change. Projection cleanup was proven able to remove evidence while leaving native
  `CostEntry` facts intact.

Append-only repository:

- `lib/growth/repositories/financial-ledger-repository.ts` exposes `recordEstimate()`,
  `recordAuthorization()`, `recordActual()`, `recordAdjustment()`, `recordReversal()`, retrieval by
  event/action, and authoritative action/Campaign/stage totals. It exposes no generic update or
  delete operation.
- New event IDs are stable hashes of workspace command identity. A canonical safe-content hash
  excludes transport command identity so an identical source retry under a new transport key still
  returns the original event. Reusing either command or source identity with conflicting financial
  content throws `FinancialReplayConflictError`.
- Writes run in serializable bounded transactions with existing `P2034`/`40001` retry behavior or
  enlist in a caller's Prisma transaction. Database uniqueness resolves concurrent winners. Injected
  inner and outer failures leave no partial event.
- Metadata is scalar, size-bounded audit/correlation data; secret, token, credential, payload/body,
  and personal-contact keys are rejected. Exactly one real provider or explicit non-provider
  service is required; no Contracts provider enum was invented.
- Normal estimate, authorization, actual, and reversal amounts are non-negative integer minor
  units. Adjustments are explicit signed deltas; reversals point to and negate one immutable target.
  Estimates and authorizations never overwrite actuals.

Provider evidence and financial reads:

- An `ACTUAL` may carry the stable ID of same-workspace projected operational evidence. The
  repository never creates, updates, or deletes that evidence. A unique evidence identity prevents
  a second financial actual from claiming it. Evidence disappearance under legacy projection does
  not delete or mutate the financial event.
- `lib/growth/read-models/cost-ledger.ts` now labels rows `growth_financial` or
  `legacy_operational_evidence`. Evidence has `isAuthoritativeFinancial=false`, no financial effect,
  and remains visible only as operational history—even when linked.
- Cost-action, Campaign, and stage totals use `CostEntry` financial events only. Actuals and signed
  adjustments affect spend; a reversal negates its target's exact effect. Mixed currency raises
  `MixedFinancialCurrencyError`. A scope containing pre-foundation rows raises
  `HistoricalFinancialEventError` until inventory/reconciliation gives them authoritative semantics.
- Workspace compatibility pagination uses opaque `(createdAt, sourceGeneration, id)` ordering.
  Equal-timestamp forward pages were proven to contain no skip or duplicate. Old raw ISO timestamp
  cursors are intentionally rejected; no public versioned cursor contract previously existed.
- `CampaignStageRun.estimatedCostCents`, `approvedCostCents`, and `actualCostCents` remain
  reconstructible/materialized control caches and were not updated in this foundation. `CostEntry`
  is authoritative.

Rollout and rollback:

- `docs/GROWTH_COST_LEDGER_RUNBOOK.md` documents repeatable local/staging/production inventory,
  non-zero hazard behavior, backup, migration/application order, post-deployment reconciliation,
  paid-execution gates, and rollback.
- Application rollback deploys the prior release but leaves additive schema and financial facts in
  place. Recovery uses a forward fix, adjustment/reversal, or an explicitly reconciled point-in-time
  restore—never a copy into `ProviderUsageLedger`, destructive rewrite, or guessed attribution.

Files changed for Step 1.4B:

- schema/migration: `prisma/schema.prisma`,
  `prisma/migrations/20260730190000_growth_os_cost_entry_foundation/migration.sql`;
- runtime: `lib/growth/repositories/financial-ledger-repository.ts`,
  `lib/growth/read-models/cost-ledger.ts`;
- tooling/config: `scripts/inventory-growth-cost-ledger.ts`,
  `scripts/test-growth-cost-ledger-migration.ts`, `package.json`, `.github/workflows/ci.yml`;
- tests: `tests/integration/growth-financial-ledger.test.ts`,
  `tests/unit/growth-financial-ledger-foundation.test.ts`;
- documentation: this tracker, `docs/GROWTH_COST_LEDGER_RUNBOOK.md`, ADR-001, `CLAUDE.md`, and
  `docs/CRM-1-BRIEF.md`.

Validation evidence:

- Exact local commands: `npm run prisma:validate`, `npm run prisma:generate`,
  `npm run test:ledger:migration`, `npm run test`, `npm run test:integration`,
  `npm run check:projection-invariant`, `npm run lint`, `npm run typecheck`, `npm run build`, and
  `npx playwright test --grep "Growth OS"` with the documented isolated database and deterministic
  non-production auth/chat/notify environment.
- Prisma format/validate/generate: passed against Prisma 6.19.3.
- Migration: all 20 migrations passed on an empty PostgreSQL 16 database; the foundation migration
  also passed after the first 19 migrations with representative rows, preserving both rows and
  null historical compatibility.
- Unit: 104 files / 638 tests passed.
- PostgreSQL integration: 11 files / 74 tests passed, including 12 financial-foundation tests for
  event semantics, partial actuals, replay/conflict, concurrency, serializable retry, inner/outer
  rollback, tenant links, evidence, projection cleanup, currencies, and pagination.
- Projection invariant: passed for all 22 guarded native models; the real cleanup test also passed.
- Lint and TypeScript: passed.
- Production build: passed under Next.js 16.2.7.
- Blocking Growth OS Playwright: 6/6 passed against the isolated PostgreSQL database and seeded
  Prisma application. One intermediate local invocation omitted a fixed test auth secret and all
  six requests redirected to login; no code changed, and the clean invocation with the same
  deterministic non-production auth environment now pinned in CI passed 6/6.
- Staging/production migration, inventory, reconciliation, and deployment: NOT STARTED.

Known limitations and deferred work:

- No staging/production row evidence exists yet; unknown historical rows are why fields remain
  nullable and tenant constraints are initially `NOT VALID`.
- Direct use of the generated Prisma delegate could still issue an update/delete; production Growth
  code exposes only the append-only repository, and static/integration tests enforce that boundary.
- Reservation/release, refund/credit/tax semantics, authorization-to-dispatch wiring, cache replay,
  full budget gates, overrun parking/`SPEND_EXCEPTION`, and paid provider integrations are deferred.
- Live provider evidence/callback reconciliation and live deployment remain unverified.

**Next exact step: Growth Bot Wave 1, B0.1 — correctness and contract hardening.** Do not begin
Growth Bot work, CRM-2, paid execution, or the deferred budget gate automatically from this branch.

## Current executive snapshot

| Area | Status | Current fact |
|---|---|---|
| CRM-0 guardrails | COMPLETE | Projection invariant, CI isolation, contracts checkout, and the baseline are present and verified. |
| CRM-1 spine | IN PROGRESS | Wave 1 Steps 1.2, 1.3, 1.3A, and 1.4B now cover leased delivery, atomic approval/Campaign/outbox orchestration, and the append-only Option C financial foundation. Real-Bot acceptance and staging/production deployment evidence remain. |
| CRM-2 through CRM-8 | NOT STARTED | Some CRM-2 domain primitives landed as CRM-1 prerequisites, but none of the later phase acceptance paths is connected. |
| Contracts consumption | COMPLETE | Version 0.2.1 is installed, locked, pinned in CI/on-host deployment, and directly consumer-tested. |
| Cost-ledger foundation | COMPLETE | ADR-001 Option C is accepted; additive immutable events, idempotent repository, tenant checks, evidence boundary, CostEntry-only totals, stable pagination, read-only inventory, PostgreSQL migration/concurrency/rollback tests, and rollout documentation are implemented. Staging/production inventory and deployment remain NOT STARTED. |
| GitHub `main` CI at the implementation baseline | COMPLETE | Run `30565339971` passed for exact baseline SHA `e0080ce`; another duplicate run was still in progress when reviewed. |
| Latest CRM-1 production deployment | IMPLEMENTED — NOT VERIFIED | Deployment scripts exist and AWS production is documented, but no evidence shows the Wave 1 Steps 1.2 through 1.3A commits and migrations are live. |

## 1. Repository responsibility and boundaries

### Target responsibility

`lead-engine-crm` is the Growth OS **campaign control plane**. It is intended to own:

- the operator-facing campaign workspace and dashboards;
- `NicheRequest`, research coordination, `NicheBrief`, and approval records;
- the universal `Campaign` and every `CampaignStageRun`;
- spending decisions, budget gates, approved-versus-actual reconciliation, and the logical cost ledger;
- paid enrichment orchestration after Hub deduplication;
- campaign-scoped lead tiering, audit orchestration, personalization, and copy QA;
- cold and warm outreach orchestration through external sending systems;
- engagement ingestion, intent routing, SDR execution, hosted audit pages, and reporting;
- human approvals for money, reputation, strategy, exceptions, scale, and circuit-breaker resume.

The system boundary is: **the Lead Hub owns lead data through a deduplicated, verified golden
contact; this repository owns execution after that golden contact becomes a campaign member.**

### Responsibilities outside this repository

| System | Responsibility outside `lead-engine-crm` |
|---|---|
| `syncore-lead-hub` | Raw vault, ingestion, normalization, entity resolution, deduplication, all email verification, permanent golden records, and golden export. |
| `syncore-email-verifier` | Free L1 verification. It is called by the Hub, not by CRM. |
| MillionVerifier | Paid fallback verification. The Hub executes it; CRM is intended to price, approve, authorize, and ledger it. |
| `syncore-research-console` | Niche/ICP research and the Console Agent at `/agent`. The agent is intended to poll CRM's durable research queue. |
| `syncore-audit-bot` | Website evidence, factual scan findings, full audit assets, PDF, and video. |
| `syncore-growth-bot` | Slack-first remote control, identity mapping, buttons, notifications, and its own delivery/deduplication store. It is not a campaign system of record. |
| `syncore-contracts` | Cross-repository Zod schemas, enums, fixture shapes, and protocol constants. It contains types and schemas, not shared executable business logic. |
| Mailshake | Planned cold and warm sequence sending and engagement tracking. |
| Amazon SES | Transactional, system, and approved direct/warm email; not planned as the Growth OS cold-sequence engine. |

### Current physical reality

This repository predates the Hub-first boundary and still contains a large operational Lead Engine,
CRM, SDR, provider, direct-email, SMS, calling, reporting, compliance, and legacy outreach product.
It can still import CSVs, normalize and deduplicate leads, run local verification/enrichment,
create CRM records, and export data. Those paths remain available for legacy/non-Growth use while
the Growth boundary is introduced.

New Growth work must not extend those legacy ownership paths. In particular:

- do not add new raw acquisition, normalization, deduplication, or verification ownership here;
- do not execute MillionVerifier from CRM even though a dormant adapter is still registered;
- do not build new work on the legacy `OutreachCampaign`/sequence engine;
- do not build a new native cold-sequence engine; the Growth plan assigns that role to Mailshake;
- do not turn the Lead Hub launch page into a second lead-data UI;
- do not create work that lacks a `Campaign` and, when it is a real pipeline stage, a
  `CampaignStageRun`.

There are two different campaign concepts in the codebase. `Campaign` is the new Growth OS
universal parent. The old outreach models and `lib/phase1/outreach.ts` campaign functions are
legacy sequences; their navigation is deliberately labeled **Outreach (legacy sequences)**.

## 2. CRM phase status

| Phase | Status | Implemented evidence | Required before phase completion |
|---|---|---|---|
| CRM-0 — guardrails | COMPLETE | Root Growth rules; measured baseline; contracts sibling checkout; projection checker in its own CI job; meta-test proving the checker fails when violated; CI on every push and PR. | Keep the guarded-model list and tracker current as models are added. |
| CRM-1 — Growth spine | IN PROGRESS | Eight native Growth models, nine enums, five migrations, immutable/T2 approvals, transactional initial/revision/final notification enqueue, one locked and retryable decision service shared by dashboard/chat, exactly-once NICHE_TEST brief/Campaign/initial-stage application, leased delivery worker, PostgreSQL concurrency/rollback/projection tests, and blocking seeded-approval Playwright coverage. | Run the joint same-record real-Bot round trip and record staging/production migration evidence. |
| CRM-2 — research loop | NOT STARTED | CRM-1 created `ResearchRun`, its repository, and the guarded `NicheBrief` constructor as prerequisites. | Add authenticated claim-next and heartbeat APIs, signed research progress/completion webhook, automatic brief/approval creation, approval-to-campaign orchestration, and the voice/text-to-approved-campaign cross-repository test. |
| CRM-3 — Hub integration and verification control | NOT STARTED | Lead Hub launch placeholder only. | Add `HubSync`, golden intake, Hub identifiers, Hub search/golden contracts, Hub-executed MV authorization/results, `VerificationStatus` vocabulary correction, suppression reconciliation, and stage/cost integration. |
| CRM-4 — acquisition and enrichment waterfall | NOT STARTED | Legacy provider adapters and workers exist, but they are not Growth campaign stages. | Add `ProviderRunProposal`, Hub overlap preflight, approval options, shared budget gate, stage-bound provider execution, provider-result push to Hub, actual-cost reconciliation, and overrun parking. |
| CRM-5 — scan and tiering | NOT STARTED | Legacy audit/compliance concepts do not implement this Growth phase. | Add `AuditRun`, `AuditFinding`, `AuditAsset` stub, signed Audit Bot callback, factual finding catalog consumption, scan caching, typed failures, cost entries, and A/B/C/X tiering with reasons. |
| CRM-6 — personalization and cold send | NOT STARTED | Existing `Ai*` features are primarily deterministic heuristics; legacy/direct outreach does not satisfy the Growth phase. | Add personalization models and worker, finding phrase library, LLM cost tracking, copy QA, sample approval, Mailshake adapter, touch-one no-link gate, launch approval, engagement ingestion, suppression reconciliation, and circuit breakers. |
| CRM-7 — intent, full audit, warm outreach, and SDR handoff | NOT STARTED | Existing SDR and call tooling may be reused but is not wired to Growth campaigns. | Add meaningful-click filtering, intent rules, full/video audit orchestration, asset-before-enrollment state, hosted audit pages, engagement signals, reply classification, and the Hot Lead Workspace. |
| CRM-8 — dashboard, eligibility, and learning loop | NOT STARTED | `CampaignStageRun` and cost read models are foundations only; the current Campaigns page lists IDs. | Add stage timeline/dashboard, true unit economics, kill-rule evaluator, scale approval, `CampaignEligibilityPolicy`, existing-Hub entry point, Niche Board, post-mortem loop, and Growth health endpoint. |

The current phase is therefore **CRM-1 — IN PROGRESS**. CRM-2 must not be declared active merely
because its data primitives were created as part of the CRM-1 spine.

## 3. Native-versus-projection boundary

### Legacy snapshot/projection generation

The legacy write model remains `AppStateSnapshot`, a version-16 JSON document with approximately
70 top-level arrays. `updateState` reads and rewrites that document and mirrors selected arrays into
70 normalized-table entries in `lib/phase1/persistence-projection.ts`.

For each workspace-scoped projected table, projection synchronization can execute:

```ts
deleteMany({ where: { workspaceId, id: { notIn: ids } } })
```

Any row written directly to a table that is still projection-owned can therefore disappear during
the next snapshot synchronization if its ID is absent from the blob. `SYNCORE_PROJECTION_MODE=diff`
and the `writeSeq` compare-and-set guard reduce cost and lost updates; neither changes ownership or
removes the destructive delete behavior.

PostgreSQL/Prisma is now the only storage driver. `SYNCORE_STORAGE_DRIVER=file` throws. Statements
that file storage remains a functioning local fallback are stale.

### Growth generation

Every Growth model is Prisma-native and must obey all of these rules:

- its own table and migration;
- writes through a workspace-scoped repository or application service using Prisma transactions;
- server-side cursor pagination for new list read models;
- no property or array in `AppState`;
- no entry in normalized write-table lists;
- no reference in `syncNormalizedProjectionToPrisma` or `upsertOrder`;
- no write through `updateState`;
- references to legacy records by ID only.

The static checker currently protects 22 existing and planned model names:

`NicheRequest`, `ResearchRun`, `NicheBrief`, `Campaign`, `CampaignStageRun`, `CostEntry`,
`Approval`, `ProviderRunProposal`, `AuditRun`, `AuditFinding`, `AuditAsset`,
`PersonalizationProfile`, `PersonalizationRun`, `MessageTemplate`, `MessageTemplateVersion`,
`GeneratedMessage`, `CopyQaResult`, `PersonalizationSampleSet`, `EngagementEvent`,
`CampaignEligibilityPolicy`, `HubSync`, and `NotifyOutbox`.

The current schema contains 85 models and 17 enums. Eight of those models are the currently
implemented Growth generation. The schema, `AppState` keys, normalized write lists, and projection
file are independently checked by tests.

| Boundary control | Status | Evidence |
|---|---|---|
| Static projection-name checker | COMPLETE | `npm run check:projection-invariant` passed locally for all 22 guarded names and runs as an isolated CI job. |
| Checker meta-test | COMPLETE | `tests/unit/projection-invariant.test.ts` proves the checker detects injected violations. |
| Growth absence from `AppState` and normalized write sets | COMPLETE | `tests/unit/growth-schema-invariants.test.ts`. |
| Growth enum parity with contracts | COMPLETE | Schema tests compare seven contract-owned enums member-for-member. |
| Full legacy blob retirement | NOT STARTED | `BLOB-MIGRATION.md` is a post-pilot strangler plan; `workspaces[0]` remains a migration blocker. |

## 4. Existing Growth OS Prisma models

The Growth spine was added by migrations
`20260728120000_growth_os_crm1_spine`,
`20260728180000_growth_os_notify_outbox`, and
`20260729200000_growth_os_notify_delivery_leases`, then extended by
`20260729214000_growth_os_niche_approval_side_effects` and
`20260730120000_growth_os_approval_notification_lifecycle`, followed by
`20260730190000_growth_os_cost_entry_foundation`.

| Model or schema change | Status | Current responsibility and implementation |
|---|---|---|
| `Workspace.approvalThresholdT1Cents` | IMPLEMENTED — NOT VERIFIED | Stored with default zero, but no decision or budget path reads T1. |
| `Workspace.approvalThresholdT2Cents` | COMPLETE | Read by approval decisions and the inbox; at/above T2, two distinct approvers are enforced server-side. |
| `NicheRequest` | COMPLETE | Template A; stores source channel/message, optional voice/transcript, validated structured request, creator, status, and research pointer. Create, confirm, and cursor-paged list functions exist. |
| `ResearchRun` | COMPLETE | Durable global FIFO research queue record with claim, progress, completion, retry/failure, warnings, assets, agent, and timestamps. Repository behavior is covered by real PostgreSQL integration, but no public Console Agent API exists. |
| `NicheBrief` | COMPLETE | Template B; requires a unique completed `researchRunId`. Creation atomically creates its `NICHE_TEST` plus requested event; replay/concurrency returns the same chain. A final valid decision approves it exactly once, and revision advances it to the immutable successor. |
| `Campaign` | IN PROGRESS | Universal parent with approved-brief guard, Hub/policy pointers, budget configuration, kill config, automation level, and status. Repository creation and paged listing exist; user creation and lifecycle orchestration do not. |
| `CampaignStageRun` | IN PROGRESS | The NICHE_TEST orchestrator creates historical `RESEARCH/COMPLETED` and next-step `HUB_SEARCH/PENDING` rows with unique orchestration keys. Later phase execution/lifecycle orchestration remains absent. |
| `Approval` | IN PROGRESS | Immutable payload/hash plus T2 and revision history. Stable creation/successor keys, requested/revised/final events, revision reason, NICHE_TEST application, locking, retry, replay, and machine workspace authorization are verified; later approval-type side effects and the live Bot round trip remain incomplete. |
| `CostEntry` | COMPLETE | Additive immutable financial-event foundation with command/source replay, currency, native tenant attribution, provider/service identity, adjustments/reversals, operational-evidence identity, append-only repository, authoritative totals, inventory, and real PostgreSQL coverage. No paid producer is connected. |
| `NotifyOutbox` | COMPLETE | Durable exact-body delivery with event identity, target references, attempts, scheduled retry, owner/token/expiry lease, terminal dead-letter time, structured attempt logs, health aggregates, and production background-worker drain. Real PostgreSQL proves concurrency and recovery. |

The eleven Growth-related enums added by CRM-1 are:

- `NicheRequestSourceChannel`: `telegram`, `slack`, `dashboard`;
- `NicheRequestStatus`: `draft`, `confirmed`, `researching`, `briefed`, `cancelled`;
- `ResearchRunStatus`: `queued`, `running`, `completed`, `failed`, `cancelled`;
- `NicheBriefStatus`: `pending_approval`, `approved`, `edited`, `declined`, `superseded`;
- `ApprovalType`: the 11 approval gates;
- `ApprovalStatus`: `pending`, `approved`, `declined`, `superseded`;
- `StageType`: the 18 Growth pipeline stages;
- `StageRunStatus`: `PENDING`, `AWAITING_APPROVAL`, `APPROVED`, `RUNNING`, `COMPLETED`,
  `FAILED`, `PARKED`, `CANCELLED`;
- `CampaignStatus`: `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`;
- `FinancialEventKind`: `ESTIMATE`, `AUTHORIZATION`, `ACTUAL`, `ADJUSTMENT`, `REVERSAL`;
- `FinancialReconciliationStatus`: `NOT_APPLICABLE`, `PENDING`, `RECONCILED`, `DISPUTED`.

## 5. Approval creation, decision, revision, and side effects

### Content integrity

`ApprovalPayload.parse()` runs before canonicalization. The parsed object is serialized as
two-space-indented JSON with one trailing LF, encoded as UTF-8, and hashed with lowercase SHA-256.
Identity (`approvalId`) and outcome are not part of the hashed content. This matches contracts
errata entry 5.

The approval repository deliberately exports only three mutators:

- `createApproval`;
- `decideApproval`;
- `reviseApproval`.

There is no payload update or patch function. Revision supersedes the pending original and creates
a new pending row with unique `supersedesApprovalId`, the persisted revision reason, and a fresh
hash in one transaction. It also creates the revision and replacement-requested outbox rows before
commit. Final approvals cannot be revised. Decision/revision replay returns the authoritative final
state or successor without changing it.

### Creation reality

- The generic `createApproval` validates and hashes any of the 11 contract payload types, requires
  a stable creation key, and transactionally enqueues its one actionable requested event.
- The only real business producer is `createNicheBriefWithApproval`, which creates
  `NICHE_TEST` after completed research.
- `SUPPRESS_BULK` is exercised in integration tests but has no product producer in CRM-1.
- The other nine later-phase approval types are rendered and typechecked but not produced by real
  workflows.
- Initial NICHE_TEST creation uses `niche-test:{researchRunId}` and a unique brief/run constraint;
  retries and concurrent creation return the same Approval and requested event.

### Decision reality

- Dashboard decisions obtain the actor from the authenticated CRM session.
- Chat API decisions authenticate the bot with `SYNCORE_CHAT_API_TOKEN`, obtain the acting actor
  from `X-Syncore-Actor-Id`, and require `X-Syncore-Workspace-Id`.
- Before mutation the CRM verifies that actor is an ADMIN or MANAGER member of that workspace.
  The bearer proves the caller is the bot; the CRM still trusts the Bot's actor assertion and does
  not independently prove the human identity cryptographically.
- Declines require one actor.
- Approvals below T2 require one actor.
- At or above T2, the first approval records `firstApprovedBy` while status remains `pending`; a
  second distinct actor produces `approved`; the same actor twice is rejected.
- T1 is not used.

### Side-effect matrix

| Behavior | Status | Current implementation |
|---|---|---|
| Validate, canonicalize, hash, and create approval | COMPLETE | Repository and hash tests cover invalid payloads, key-order stability, exact bytes, and stored hash. |
| Decide or decline from dashboard | COMPLETE | Uses the shared locked application service and authenticated session actor. |
| Decide or decline through chat API | COMPLETE | Exact proxy allow-list reaches the fail-closed bearer route; blocking Playwright and PostgreSQL tests prove decision/replay through HTTP. Real-Bot acceptance remains separate. |
| Revise from dashboard | COMPLETE | Full JSON replacement is validated; original is superseded and successor created. |
| Revise through chat API | COMPLETE | Bearer/workspace-authorized route and replay are proven through real-PostgreSQL HTTP invocation; joint real-Bot acceptance remains separate. |
| T2 two-person rule | COMPLETE | Unit and PostgreSQL concurrency coverage prove first-actor pending, same-actor rejection, second-distinct finalization, replay, and decline. |
| T1 policy | NOT STARTED | Field exists but no code consumes it. |
| Enqueue initial approval request | COMPLETE | Approval/brief and one deterministic `APPROVAL_REQUESTED` row commit together; PostgreSQL proves replay, concurrency, retry, rollback, and no orphans. |
| Notify after dashboard decision/revision | COMPLETE | Final decisions and revision/replacement notifications enqueue once inside their authoritative transactions. |
| Notify after chat API decision/revision | COMPLETE | The same transactional services back machine decisions and revisions; authentication failures and replay have PostgreSQL and blocking Playwright coverage. |
| Apply approved `NICHE_TEST` to `NicheBrief` | COMPLETE | Contracts/hash/chain validation precedes the decision; final approval marks the current workspace-scoped brief once in the same transaction. |
| Create campaign after approved niche test | COMPLETE | Unique origin Approval plus row lock/serializable retry create one DRAFT Campaign, `RESEARCH/COMPLETED`, `HUB_SEARCH/PENDING`, and one final outbox event. |
| Other approval-specific side effects | NOT STARTED | No provider, budget, launch, scale, suppression, reply, or breaker application service exists. |
| Joint dashboard/bot final-state round trip | IMPLEMENTED — NOT VERIFIED | Contracts feedback is resolved in v0.2.1 and CRM delivery is implemented; the real Bot and same-record final-state round trip have not been run. |

NICHE_TEST decision side effects now execute through one idempotent application service used by
both dashboard actions and chat routes. Later approval types must extend that boundary rather than
adding surface-specific application logic.

## 6. NotifyOutbox creation and delivery

### Implemented behavior

`buildSignedNotify` validates a contracts v0.2.1 `NotifyEnvelope`, serializes it once, and signs
`timestamp + "." + rawBody` with HMAC-SHA256. It emits the contracts signature, timestamp, nonce,
and delivery-ID headers. On each attempt the worker re-signs the same exact stored body bytes with
a fresh timestamp while retaining event ID and nonce. Unit tests cover valid delivery, tampering,
timestamp changes, expiry, nonce replay in a fake receiver, wrong secrets, missing headers, and
exact-body retry signing.

`enqueueNotify` stores the exact body and headers and enforces a unique event ID.
`drainNotifyOutbox` atomically claims one due row at a time with Postgres
`FOR UPDATE SKIP LOCKED`, worker/token ownership, and an expiring lease. It performs a bounded HTTP
POST outside the transaction, validates the Bot acknowledgement, settles only its own claim,
schedules exponential retry from one minute up to one hour by default, and marks exhausted rows
dead-lettered. Expired claims are recoverable after termination. The configured current Bot URL is
the only send target, and production requires HTTPS.

### Delivery reality

| Outbox capability | Status | Evidence or gap |
|---|---|---|
| Schema and migration | COMPLETE | Base outbox and additive lease/dead-letter migrations applied cleanly in local PostgreSQL 16. |
| Notify envelope and HMAC generation | COMPLETE | Direct unit coverage against contracts constants and a fake receiver. |
| Durable enqueue helper | COMPLETE | Deterministic event upsert is verified inside the real-PostgreSQL decision transaction under replay, concurrency, retry, restart, and rollback. |
| Drain implementation | COMPLETE | Nine direct PostgreSQL integration tests cover success, timeout/connection failure, retry timing, non-2xx/malformed responses, terminal failure, concurrency, stale recovery, duplicate acknowledgement, and graceful stop. |
| Background-worker wiring | COMPLETE | The production `worker:background`/systemd path preserves all existing lanes and drains NotifyOutbox each tick; unit regression coverage proves each call. |
| Claim and crash recovery | COMPLETE | Atomic one-row claim, owner/token settlement, active-lease exclusion, stale-lease recovery, and process-restart simulation pass against PostgreSQL. |
| Terminal visibility | COMPLETE | Dead-letter timestamps, safe structured attempt events, tick summary, and `/api/health` aggregates exist and are tested. |
| Live CRM-to-bot delivery | IMPLEMENTED — NOT VERIFIED | Production code/config exists, but no deployment record or joint real-Bot request is evidence yet. |

Known delivery risks:

- Initial approval, revision/replacement, and final decision outbox insertion are transactional on
  dashboard and machine paths. PostgreSQL constraints and deterministic IDs provide deduplication.
- Contracts v0.2.1 routes by workspace but defines no typed user/channel recipient target; the Bot
  must resolve the intended approval channel/recipients inside that workspace.
- External delivery is at least once, not exactly once. A process crash after Bot acceptance but
  before database settlement can retry; the Bot must continue deduplicating the stable event ID.
- A pathological process pause beyond the lease can permit a second worker to retry the same row.
  The default 60-second lease exceeds the 15-second request timeout, but no finite lease removes
  this distributed-systems edge case.
- Terminal failures are visible in logs and health, but no external alert rule or admin retry UI is
  configured in this repository.
- Production configuration and a real CRM-to-Bot delivery have not been observed.

## 7. Campaign and CampaignStageRun status

### Campaign

`createCampaign` checks that the referenced `NicheBrief` belongs to the workspace and is already
`approved`, then creates a `DRAFT` campaign. It stores budget cap, warning threshold, overrun
tolerance, kill configuration, automation level, Hub segment, eligibility-policy pointer, creator,
and timestamps.

The NICHE_TEST application path additionally requires a unique `originApprovalId`, validates the
complete request/run/brief/approval chain, and creates the Campaign with its initial stages in the
same transaction as approval and outbox state.

The current `/campaigns` UI is a cursor-paged, read-only list that renders campaign IDs. There is no
campaign creation form, detail page, status transition service, stage timeline, budget display, or
operator dashboard.

### Stage runs

`createStageRun` creates a `PENDING` row. `transitionStageRun` reads the current row inside a
transaction and enforces this matrix:

| From | Legal targets |
|---|---|
| `PENDING` | `AWAITING_APPROVAL`, `RUNNING`, `CANCELLED` |
| `AWAITING_APPROVAL` | `APPROVED`, `CANCELLED` |
| `APPROVED` | `RUNNING`, `PARKED`, `CANCELLED` |
| `RUNNING` | `COMPLETED`, `FAILED`, `PARKED`, `CANCELLED` |
| `PARKED` | `RUNNING`, `CANCELLED` |
| `FAILED` | `RUNNING`, `CANCELLED` |
| `COMPLETED` | none |
| `CANCELLED` | none |

Retrying `FAILED` to `RUNNING` increments `retryCount` and clears the stale failure code. Completed
and cancelled runs are terminal. Timeline reads are workspace- and campaign-scoped and cursor
paged.

| Campaign/stage capability | Status | Current fact |
|---|---|---|
| Approved-brief campaign guard | COMPLETE | Covered by real-PostgreSQL integration. |
| Campaign create repository | COMPLETE | Creates `DRAFT` only. |
| Campaign list UI | COMPLETE | Read-only cursor-paged list; intentionally minimal. |
| Campaign detail and lifecycle UI | NOT STARTED | No route or action exists. |
| Stage-run transition matrix | COMPLETE | Exhaustive unit matrix and PostgreSQL illegal-transition test. |
| Stage timeline read model | COMPLETE | Cursor-paged repository read exists. |
| Initial stage orchestration | COMPLETE | Final NICHE_TEST creates `RESEARCH/COMPLETED` plus `HUB_SEARCH/PENDING` once; it starts no work. |
| Later automatic stage orchestration | NOT STARTED | No scheduler advances HUB_SEARCH or creates later paid/external stage runs. |
| Approval-to-stage transition | IN PROGRESS | NICHE_TEST initializes the safe timeline; later approval types do not yet advance stage runs. |
| Provider job-to-stage integration | NOT STARTED | Legacy provider runs are not attached to Growth stage runs. |
| Budget preflight and actual reconciliation | NOT STARTED | Authoritative tested CostEntry totals exist, but no dispatch gate, reservation/release, or overrun orchestration consumes them. |
| Campaign kill rules and circuit breakers | NOT STARTED | Configuration is stored only. |

`createStageRun` accepts a workspace and campaign ID but does not first verify that the campaign
belongs to that workspace. The database has independent workspace and campaign foreign keys, not a
composite tenant-consistency constraint. Callers must currently be trusted not to create a
cross-workspace mismatch. This needs a repository guard before stage creation becomes externally
reachable.

## 8. CostEntry versus ProviderUsageLedger

The canonical plan says to extend `ProviderUsageLedger` and never create a second ledger. That
instruction cannot be followed literally while `ProviderUsageLedger` remains blob-projected:
native Growth rows inserted into it would not exist in `AppStateSnapshot` and could be deleted by
the next projection sync.

Step 1.4A documented the evidence and recommended Option C in
`docs/adr/ADR-001-growth-os-cost-ledger.md`: treat `ProviderUsageLedger` as legacy operational
provider evidence and `CostEntry` as the native financial control ledger behind one authoritative
public spend view. The Syncore Tech project owner accepted that recommendation on 2026-07-30.
ADR-001 is **ACCEPTED**, and `GROWTH_OS_ERRATA.md` entry 6 makes the ownership and
no-double-counting rules binding. Step 1.4B now implements the additive repository foundation;
paid execution and the full budget/reconciliation workflow remain not started.

CRM-1 therefore implements an explicit ownership seam:

- `ProviderUsageLedger` remains the legacy, blob-projected generation.
- `CostEntry` is the authoritative native financial event store with immutable action identity,
  currency, attribution, corrections, and idempotent append behavior.
- `listCostEntries` presents native finance and legacy evidence with distinct source/authority labels.
- Campaign/stage filters exclude legacy rows because those rows have no campaign or stage IDs.
- Action/Campaign/stage totals calculate actuals, signed adjustments, and target-aware reversals from
  native `CostEntry` only and reject mixed currency.

| Ledger behavior | Status | Current fact |
|---|---|---|
| Workspace history read model | COMPLETE | Native finance and legacy operational evidence are distinctly labelled; a stable composite cursor is proven across equal timestamps. |
| Action, Campaign, and stage financial totals | COMPLETE | Real PostgreSQL proves actual, adjustment, reversal, no-double-counting, cache independence, and mixed-currency rejection. |
| Append-only Growth financial repository | COMPLETE | Estimate, authorization, actual, adjustment, and reversal operations use stable IDs, serializable replay, conflict detection, tenant validation, and no update/delete API. |
| Budget-gate consumption | NOT STARTED | Aggregate helpers have no callers. |
| Legacy campaign attribution | NOT STARTED | Historical rows lack campaign/stage identity; guessing attribution is intentionally rejected. |
| Architecture decision and acceptance | COMPLETE | ADR-001 Option C is accepted and binding erratum entry 6 is recorded. |
| Foundation schema/read/repository implementation | COMPLETE | Migration, inventory, append-only repository, evidence boundary, authoritative totals, pagination, rollback runbook, and PostgreSQL proof exist. |
| Staging/production inventory and deployment | NOT STARTED | No credentials or environment evidence was available; read-only inventory is a deployment gate. |
| Legacy ledger ownership peel | NOT STARTED | Separately deferred; accepted Option C does not require it before the pilot. |

This is physically two stores with distinct semantics: one authoritative financial ledger plus one
operational-evidence store. The public financial model is CostEntry-only. Native writes must never
target `ProviderUsageLedger` while that table remains in projection ownership.

## 9. Test, build, and CI evidence

### Local evidence from this review

| Check | Status | Result on 2026-07-30 |
|---|---|---|
| Projection invariant | COMPLETE | Passed; projection file free of all 22 guarded Growth model names. |
| Unit tests | COMPLETE | 103 test files, 633 tests, zero failures. |
| Lint | COMPLETE | `npm run lint` exited zero. |
| TypeScript | COMPLETE | `npm run typecheck` exited zero. |
| Production build | COMPLETE | `npm run build` exited zero with Next.js 16.2.7 and emitted all current routes. |
| Local real-PostgreSQL integration | COMPLETE | PostgreSQL 16 on isolated port 55433 applied all 19 migrations; 10 files and 62 tests passed, including 10 notification-lifecycle, 13 approval-orchestration, and 9 direct delivery tests. |
| Local Playwright | COMPLETE | All 6 blocking Growth OS tests passed against Next.js and PostgreSQL on isolated port 3012, including machine authentication isolation and seeded NICHE_TEST decision replay. |

Current test inventory is 103 unit files, 10 integration files, and 14 Playwright files.

### GitHub evidence

PR #174 merged the proposed ADR-001 documentation into `main` as `e0080ce` on 2026-07-30.
Post-merge push CI run `30565339971` completed successfully for that exact SHA. A duplicate push run
`30565570626` was still in progress when the acceptance evidence was recorded; the completed
exact-SHA run is the baseline used by this tracker.

Earlier, PR #173 merged Step 1.3A into `main` as `6d5830f` on 2026-07-30. Post-merge push CI run
`30560105195` completed successfully for that exact SHA. A duplicate push run `30560226803` was
still in progress when Step 1.4A proposal evidence was recorded.

Earlier, PR #170 merged `crm-1-spine` into `main` as `bb603d3` on 2026-07-29. Post-merge push CI run
`30478238419` completed successfully for that exact SHA and included:

- projection invariant and armed meta-test;
- Prisma validation/generation, lint, typecheck, and unit tests;
- Next.js production build;
- PostgreSQL 16 service, all migrations, and integration tests;
- PostgreSQL-backed seed and Playwright;
- legacy Playwright smoke step;
- blocking Growth OS Playwright step.

The workflow policy still marks the legacy Playwright step `continue-on-error`. It happened to pass
in run `30478238419`, but future green e2e jobs do not guarantee that step passed. The Growth OS
step is separate and blocking.

### What the current tests do and do not prove

Verified:

- Growth models stay outside the blob/projection/write lists.
- Contract-owned enums match the contracts package.
- `NicheBrief.researchRunId` is required.
- Approval hashing, immutable revision, locked/idempotent decision, tenant scoping, and T2 behavior.
- Transactional initial requested events, stable creation keys, one brief per completed run,
  immutable revision reason/history, one successor, replacement requested events, creation/revision
  concurrency and rollback, and machine actor membership/role authorization.
- Full repository spine against PostgreSQL:
  request → confirm → research queue/claim/complete → brief + approval → manual decision → manual
  brief approval → campaign → stage run.
- Illegal stage transitions and paginated stage reads.
- Contracts v0.2.1 resolution and the corrected approval fixture digest.
- Exact-body notification signing, PostgreSQL claim concurrency, retry scheduling, Bot timeout,
  malformed/non-2xx acknowledgement handling, dead-letter visibility, expired-claim/process-restart
  recovery, duplicate acknowledgement, graceful shutdown, and existing combined-worker lanes.
- Final NICHE_TEST application against PostgreSQL: first decision, revision successor, replay,
  process restart, duplicate HTTP callback, concurrency, transaction retry, T2, every non-approved
  path, malformed/hash-invalid/missing/cross-workspace chains, rollback, outbox uniqueness, and
  native-row survival through legacy projection cleanup.
- Growth pages render under Playwright; unauthenticated/cross-workspace machine requests have no
  side effects; and a seeded authorized decision route creates one Campaign, the two safe stage
  rows, and one final outbox event under blocking Playwright.

Not verified:

- a real API-to-bot approval round trip;
- side effects for the ten approval types after `NICHE_TEST`;
- staging or production rollout of the CRM-1 migrations and code.

## 10. Local, staging, and production deployment evidence

| Environment | Status | Evidence and limitation |
|---|---|---|
| Local build/toolchain | COMPLETE | Sibling contracts checkout is exactly v0.2.1; lint, typecheck, 633 unit tests, invariant, Prisma checks, and production build pass. |
| Local running app with PostgreSQL | COMPLETE | All 19 migrations applied to isolated PostgreSQL 16; 62 integration tests and all 6 blocking Growth OS Next.js/Playwright tests pass. |
| Staging procedure | IMPLEMENTED — NOT VERIFIED | Database cutover documentation describes staging migration/seed/write checks. No staging environment, URL, deployment workflow, or current CRM-1 staging result is recorded in the repository. |
| AWS infrastructure code | IMPLEMENTED — NOT VERIFIED | Terraform, Caddy configuration, systemd units, migration, deploy, redeploy, health, and rollback scripts exist; they were inspected but not applied during this review. |
| AWS production infrastructure claim | IMPLEMENTED — NOT VERIFIED | `docs/AWS_MIGRATION.md` says the EC2/RDS migration completed 2026-07-10, but this review did not query AWS or the production health endpoint. |
| CRM-1 production rollout | IMPLEMENTED — NOT VERIFIED | No deployment record proves Steps 1.2/1.3/1.3A or migrations `20260729200000_growth_os_notify_delivery_leases`, `20260729214000_growth_os_niche_approval_side_effects`, and `20260730120000_growth_os_approval_notification_lifecycle` are live. |

The documented AWS topology is one `t4g.small` EC2 instance running the Next.js standalone server,
the background worker, and Caddy; one private `db.t4g.micro` PostgreSQL RDS instance; SSM; S3; and
SES in `us-east-1`. RDS is single-AZ with PITR and deletion protection. There is no ALB, NAT gateway,
RDS Proxy, Aurora, ECS/Fargate, or Multi-AZ database.

Deployment is manual rather than a GitHub Actions deployment workflow. `redeploy.sh` pulls the
repository, optionally applies migrations when `MIGRATE=1`, builds on the EC2 host, atomically swaps
the standalone bundle, restarts services, and checks `/api/health`.

The on-host build requires a sibling, built checkout of `syncore-contracts` at v0.2.1 and now fails
closed on any other package version. Building on the 2 GB instance is protected by swap and memory
limits but remains operationally fragile. CI-built
release artifacts would remove that dependency and reduce production build risk.

The infrastructure provisions S3, but this repository has no runtime `@aws-sdk/client-s3` usage.
Application object storage for exports, attachments, and recordings is therefore not proven by the
current runtime code.

### Environment configuration status

The shared example, EC2 web/worker templates, and AWS SSM procedure now document the Growth
settings, including delivery timeout, lease, retry, maximum-attempt, and batch controls:

- `SYNCORE_CHAT_API_TOKEN`;
- `SYNCORE_BOT_NOTIFY_SECRET`;
- `SYNCORE_BOT_NOTIFY_URL`;
- `SYNCORE_HUB_URL`.

Repository documentation is COMPLETE for these settings. Staging/production provisioning remains
IMPLEMENTED — NOT VERIFIED because no environment query or deployment record was captured.

## 11. Cross-repository dependencies

Errata supersedes the old five-repository description. Growth OS currently governs seven
repositories.

| Dependency | Status | Current contract with this repository |
|---|---|---|
| `syncore-contracts` | COMPLETE | Sibling checkout at `579a12853641b75b453325f6f08af7bb6521af9b`, exact tag/version v0.2.1. Lockfile, CI, consumer test, and on-host version guard agree. CRM consumes approval, request, research, stage, notify, primitive, and webhook shapes. |
| Contracts CRM-1 patch | COMPLETE | v0.2.1 corrected/conformance-tested the fixture hash and documented the CRM feedback; the CRM deleted its local temporary hash authority. |
| `syncore-growth-bot` | BLOCKED | Slack is the pilot surface; Telegram remains an adapter. CRM has routes and outbound envelope code, but no joint same-record round trip is recorded. |
| `syncore-research-console` | NOT STARTED | CRM-2 requires the `/agent` poller, progress/heartbeat, and validated Template B completion contract. |
| `syncore-lead-hub` | NOT STARTED | CRM-3 requires golden search/export/sync, MV authorization/result, suppression reconciliation, and provider-result imports. Current CRM page is only a launch placeholder. |
| `syncore-email-verifier` | NOT STARTED | CRM must not call it directly. The Hub owns its bridge and status mapping. CRM-3 must consume the corrected shared `VerificationStatus`. |
| `syncore-audit-bot` | NOT STARTED | CRM-5/7 require factual scan and full/video job contracts with signed callbacks and typed findings/assets. |
| Mailshake | NOT STARTED | No adapter, event poller, export, or IDs exist in this repository. |

Contracts version 0.2.1 is authoritative for every wire shape it defines. Contract corrections must
land in `syncore-contracts` first, receive a version/tag bump, and then be consumed here together
with the CI `contracts-ref` update. Local redeclarations are prohibited.

## 12. Known risks, stale documentation, and technical debt

### Growth-critical risks

1. **CRM-1 acceptance is not fully cross-repository.** Local HTTP/PostgreSQL/Playwright proves the
   complete CRM-side initial, revision, and final notification lifecycle plus final NICHE_TEST
   application, but the same-record real-Bot round trip remains unverified.
2. **Contracts v0.2.1 does not carry a typed user/channel recipient.** The CRM routes by the
   authoritative envelope workspace and supplies display metadata; the Bot must resolve configured
   approval recipients within that workspace.
3. **Notify delivery is at least once.** Crash-after-acceptance and lease-expiry races can retry the
   stable event ID; correctness depends on the Bot retaining its documented deduplication behavior.
4. **The accepted cost architecture is not implemented.** ADR-001 Option C and erratum entry 6 are
   binding, but environment inventory, schema, writers, budget gates, reconciliation, and the final
   public financial read model have not started.
5. **`CostEntry` has no writers.** Campaign/stage spend and budget controls currently read an empty
   Growth ledger.
6. **No budget gate exists.** Stored caps and thresholds do not prevent paid execution.
7. **The Bot's actor assertion remains a shared-bearer trust boundary.** CRM now requires that actor
   to be an authorized `ADMIN`/`MANAGER` member of the stated workspace, but the shared bearer does
   not cryptographically establish the individual human behind the assertion.
8. **Approval behavior beyond `NICHE_TEST` remains repository-only.** The notification lifecycle is
   generic, but later approval types still need their phase-specific side-effect orchestration.
9. **Stage transition concurrency is not locked or compare-and-set.** A transaction alone does not
    prevent two callers from reading the same old status and applying different legal transitions.
10. **No cross-workspace campaign check exists in generic `createStageRun`.** The NICHE_TEST
   initializer validates the chain, but independent generic foreign keys can still represent an
   inconsistent workspace/campaign pair.
11. **In-memory rate limiting is instance-local.** It does not coordinate if the web tier scales.

### Persistence debt

- The whole-app snapshot remains the legacy write authority for most of the product.
- Projection still contains destructive delete behavior.
- Existing read paths retain 500/1,500-row caps.
- `workspaces[0]` remains in migration logic.
- Native auth and Growth tables coexist with blob-projected domains through special seams.
- The blob retirement plan is intentionally post-pilot and has not started.

### Deployment and operations debt

- No automated staging or production deployment workflow exists.
- There is no repository evidence of the current production commit or migration status.
- Web and worker share one small EC2 host; RDS is single-AZ.
- Builds occur on the production-sized host and require the contracts sibling checkout.
- S3 exists in infrastructure but runtime object-storage integration is absent.
- Notify outbox health is exposed, but no external alert rule or operator retry UI is configured.
- MFA is represented but not enforced; SSO is absent.

### Stale or contradictory documentation

- `CLAUDE.md` now labels CRM-1 as in closure and points here for the authoritative wave status.
- `README.md` says local file storage remains available and production has an emergency file-mode
  escape hatch. The storage driver now accepts Prisma only.
- `README.md` and `docs/PRODUCTION_ARCHITECTURE.md` describe older Smartlead/Redis/target-state
  architecture. The Growth plan assigns cold sending to Mailshake, and the deployed AWS design has
  no Redis.
- `docs/PRODUCTION_ARCHITECTURE.md`, `docs/CURRENT_CODEBASE_REVIEW.md`, and `docs/ROADMAP.md` describe
  a local or simulated/pre-production state that predates auth, live integrations, PostgreSQL-only
  storage, and the AWS migration.
- `docs/PHASE_6_DATABASE_CUTOVER.md` and `docs/PERSISTENCE_HARDENING.md` retain file-driver fallback
  language that no longer matches `storage-driver.ts`.
- `docs/EC2_WORKER_SETUP.md` retains its dedicated-worker procedure but now labels it historical;
  the newer AWS migration document places web and worker on the same EC2 instance with RDS.
- `GROWTH_OS_END_TO_END_PLAN_v9.1.md` describes five repositories and Telegram-first operation;
  `GROWTH_OS_ERRATA.md` supersedes those points with seven repositories and Slack-first operation.
- `GROWTH_OS_EXECUTION_ROADMAP.md` retains Telegram wording in phase acceptance; the errata wins.
- `GROWTH_OS_END_TO_END_PLAN_v9.1.md` §§6, 21, and 26 and the per-repository plan retain the
  original one-table/direct-`ProviderUsageLedger` conflict for decision provenance. The repository
  plan now carries an explicit supersession pointer; `GROWTH_OS_ERRATA.md` entry 6 and accepted
  ADR-001 govern, and the active CRM-1 brief reflects the accepted rule.
- `GROWTH_OS_PLAN.lead-engine-crm.md` says a separate EC2 worker host; the implemented AWS topology
  runs both services on one host.
- `docs/CRM-0-BASELINE.md` correctly records its historical baseline but its statements that the
  canonical plans were uncommitted and contracts were unavailable are no longer current.
- `tests/unit/growth-schema-invariants.test.ts` comments that CRM-1 adds seven tables while its own
  list contains eight.

### Working-tree evidence at review start

Before this tracker was created, the checkout contained an existing modified `README.md` and three
untracked local planning/review files:

- `CODEBASE-REVIEW-2026-07-12.md`;
- `FIX-PRIORITY-LIST.md`;
- `lead-engine-crm-full-review-goal.md`.

They were not included in this tracker commit. The README modification removes a seeded-password
reference and was also preserved outside this commit.

## 13. Exact next Growth OS step

**Next exact step: Growth Bot Wave 1, B0.1 — correctness and contract hardening. Do not start CRM-2,
paid provider execution, the deferred budget gate, or Growth Bot work from this CRM branch.**

ADR-001 Option C, binding erratum entry 6, and the Step 1.4B additive foundation are complete.
Staging and production read-only inventory and deployment remain gates for CRM rollout, but they do
not change the next cross-repository implementation step. The financial foundation authorizes no
paid action; dispatch, reservation/release, reconciliation-to-authorization, cost-cache replay,
overrun parking, and `SPEND_EXCEPTION` orchestration remain separately scoped.

### Historical closure ordering retained from the initial tracker

The following sequence is preserved as tracker history. Wave execution subsequently released
Contracts v0.2.1 and completed the notification-delivery item first; it is not the current exact
ordering.

The slice must be implemented in this order:

1. Release the `syncore-contracts` patch described in
   `docs/CRM-1-CONTRACTS-FEEDBACK.md`, then bump the sibling/tag pin in this repository.
2. Add one transaction-aware application service used by both dashboard and chat routes. It must:
   decide or revise the approval, apply exactly-once type-specific side effects, and enqueue the
   correct outbox event in the same transaction.
3. For final `NICHE_TEST` approval, the service must mark the linked brief approved and create one
   campaign with the approved budget/kill configuration. Replay must return the same campaign and
   create neither a second campaign nor a second side effect.
4. Enqueue the initial `APPROVAL_REQUESTED` event in the same transaction that creates the brief and
   approval.
5. Wire outbox draining into the production background worker with a safe claim/lease, retry timing
   compatible with the replay window, origin validation, dead-letter visibility, and tests.
6. Add real-PostgreSQL/API coverage and a fake or real bot round-trip proving that dashboard and bot
   observe the same record and final state. Extend blocking Playwright coverage to exercise a seeded
   approval rather than only rendering the empty inbox.
7. Document and provision the four Growth environment variables, then record staging and production
   migration/deployment evidence here.

CRM-1 becomes **COMPLETE** only when this acceptance statement is true:

> A researched brief creates one immutable approval and a durable approval-request notification;
> the operator can approve, decline, or revise it from dashboard or bot; both surfaces show the same
> final state; a final approval applies its business side effect exactly once; the bot may be down
> without blocking the decision; and queued notifications are later delivered by the worker.

After that, the exact CRM-2 entry point is `GET /api/research-runs/next`, followed by heartbeat and
the signed Research Console completion webhook.

## Evidence inventory reviewed for this tracker

- Root guidance and plans: `README.md`, `CLAUDE.md`, `GROWTH_OS_ERRATA.md`,
  `GROWTH_OS_END_TO_END_PLAN_v9.1.md`, `GROWTH_OS_EXECUTION_ROADMAP.md`,
  `GROWTH_OS_PLAN.lead-engine-crm.md`, and `BLOB-MIGRATION.md`.
- Phase evidence: `docs/CRM-0-BASELINE.md`, `docs/CRM-1-BRIEF.md`, and
  `docs/CRM-1-CONTRACTS-FEEDBACK.md`.
- Architecture/operations documentation: AWS migration and Terraform README, background jobs,
  worker setup, production architecture, persistence/cutover, provider, outreach, secrets,
  remediation, and roadmap documents.
- Persistence: complete Prisma schema, all migration names, all four CRM-1 migration SQL files,
  storage-driver code, projection code/invariant, and normalized write boundaries.
- Growth implementation: every file under `lib/growth`, the three Growth API routes, Approval Inbox
  actions/UI, Campaigns/Lead Hub pages, and navigation definitions.
- Workers: combined runner/entry point, provider, lead, recording, daily-report, heartbeat, signal
  handling, and systemd units.
- Tests: Growth schema/hash/approval/auth/notify/state-machine unit tests, Contracts v0.2.1 consumer
  test, real-PostgreSQL Growth spine and NotifyOutbox integration tests, Growth Playwright spec,
  test inventory, and projection tests.
- CI/deployment/configuration: `.github/workflows/ci.yml`, contracts setup action, `.env.example`,
  AWS Terraform and deploy/redeploy scripts, package scripts, Git state, PR #170, and post-merge CI
  run `30478238419`.
- Cross-repository dependency: sibling `syncore-contracts` package/version, Git tag, commit, and CI
  pin.
