# Growth OS implementation tracker — `lead-engine-crm`

This is the authoritative living implementation tracker for Growth OS work in this repository.
It records what the repository actually does, what has been verified, what remains disconnected,
and the exact next implementation slice. It is not a replacement for the product plan.

**Last repository review:** 2026-07-29

**Implementation baseline:** GitHub `main` at `bb603d344b1f31a73afecba4eef8b3a9715c9a3b`
(PR #170, CRM-1 spine)

**Review branch before this tracker commit:** `crm-1-spine` at
`57ba98a82e4d62d7249c17a3c4d929bcdba6c51e`

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

## Current executive snapshot

| Area | Status | Current fact |
|---|---|---|
| CRM-0 guardrails | COMPLETE | Projection invariant, CI isolation, contracts checkout, and the baseline are present and verified. |
| CRM-1 spine | IN PROGRESS | Wave 1 Steps 1.2 and 1.3 completed leased notification delivery plus atomic/idempotent NICHE_TEST decision-to-brief/campaign/stage/outbox orchestration. Initial approval-request enqueue, real-Bot acceptance, and deployment evidence still block CRM-1 completion. |
| CRM-2 through CRM-8 | NOT STARTED | Some CRM-2 domain primitives landed as CRM-1 prerequisites, but none of the later phase acceptance paths is connected. |
| Contracts consumption | COMPLETE | Version 0.2.1 is installed, locked, pinned in CI/on-host deployment, and directly consumer-tested. |
| GitHub `main` CI at the implementation baseline | COMPLETE | Run `30478238419` passed projection, validate, build, real-PostgreSQL integration, legacy Playwright, and blocking Growth OS Playwright steps. |
| Latest CRM-1 production deployment | IMPLEMENTED — NOT VERIFIED | Deployment scripts exist and AWS production is documented, but no evidence shows the Step 1.2 commit or its third CRM-1 migration is live. |

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
| CRM-1 — Growth spine | IN PROGRESS | Eight native Growth models, nine enums, four migrations, immutable/T2 approvals, one locked and retryable decision service shared by dashboard/chat, exactly-once NICHE_TEST brief/Campaign/initial-stage application, transactional final-decision outbox, leased delivery worker, PostgreSQL concurrency/rollback/projection tests, and blocking seeded-approval Playwright coverage. | Enqueue the initial approval request transactionally, close remaining revision notification parity, run the joint real-Bot round trip, and record staging/production migration evidence. |
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
`20260729200000_growth_os_notify_delivery_leases`.

| Model or schema change | Status | Current responsibility and implementation |
|---|---|---|
| `Workspace.approvalThresholdT1Cents` | IMPLEMENTED — NOT VERIFIED | Stored with default zero, but no decision or budget path reads T1. |
| `Workspace.approvalThresholdT2Cents` | COMPLETE | Read by approval decisions and the inbox; at/above T2, two distinct approvers are enforced server-side. |
| `NicheRequest` | COMPLETE | Template A; stores source channel/message, optional voice/transcript, validated structured request, creator, status, and research pointer. Create, confirm, and cursor-paged list functions exist. |
| `ResearchRun` | COMPLETE | Durable global FIFO research queue record with claim, progress, completion, retry/failure, warnings, assets, agent, and timestamps. Repository behavior is covered by real PostgreSQL integration, but no public Console Agent API exists. |
| `NicheBrief` | COMPLETE | Template B; requires completed `researchRunId`. Creation atomically creates its `NICHE_TEST`; a final valid decision now approves it exactly once. Revision advances the pending brief to the immutable successor Approval. |
| `Campaign` | IN PROGRESS | Universal parent with approved-brief guard, Hub/policy pointers, budget configuration, kill config, automation level, and status. Repository creation and paged listing exist; user creation and lifecycle orchestration do not. |
| `CampaignStageRun` | IN PROGRESS | The NICHE_TEST orchestrator creates historical `RESEARCH/COMPLETED` and next-step `HUB_SEARCH/PENDING` rows with unique orchestration keys. Later phase execution/lifecycle orchestration remains absent. |
| `Approval` | IN PROGRESS | Immutable payload/hash plus T2 and revision history. Final NICHE_TEST validation/application/notification is atomic, locked, retryable, and replay-safe; later approval-type side effects and the live Bot round trip remain incomplete. |
| `CostEntry` | IN PROGRESS | Native Growth cost generation with campaign/stage attribution. Read and aggregate functions exist; no production code currently creates a `CostEntry`. |
| `NotifyOutbox` | COMPLETE | Durable exact-body delivery with event identity, target references, attempts, scheduled retry, owner/token/expiry lease, terminal dead-letter time, structured attempt logs, health aggregates, and production background-worker drain. Real PostgreSQL proves concurrency and recovery. |

The nine Growth-related enums added by CRM-1 are:

- `NicheRequestSourceChannel`: `telegram`, `slack`, `dashboard`;
- `NicheRequestStatus`: `draft`, `confirmed`, `researching`, `briefed`, `cancelled`;
- `ResearchRunStatus`: `queued`, `running`, `completed`, `failed`, `cancelled`;
- `NicheBriefStatus`: `pending_approval`, `approved`, `edited`, `declined`, `superseded`;
- `ApprovalType`: the 11 approval gates;
- `ApprovalStatus`: `pending`, `approved`, `declined`, `superseded`;
- `StageType`: the 18 Growth pipeline stages;
- `StageRunStatus`: `PENDING`, `AWAITING_APPROVAL`, `APPROVED`, `RUNNING`, `COMPLETED`,
  `FAILED`, `PARKED`, `CANCELLED`;
- `CampaignStatus`: `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`.

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
a new pending row with `supersedesApprovalId` and a fresh hash in one transaction. Final approvals
cannot be revised. Decision replay returns the already-final state without changing it.

### Creation reality

- The generic `createApproval` validates and hashes any of the 11 contract payload types.
- The only real business producer is `createNicheBriefWithApproval`, which creates
  `NICHE_TEST` after completed research.
- `SUPPRESS_BULK` is exercised in integration tests but has no product producer in CRM-1.
- The other nine later-phase approval types are rendered and typechecked but not produced by real
  workflows.
- Initial approval creation does not enqueue `APPROVAL_REQUESTED`.

### Decision reality

- Dashboard decisions obtain the actor from the authenticated CRM session.
- Chat API decisions authenticate the bot with `SYNCORE_CHAT_API_TOKEN`, obtain the acting actor
  from `X-Syncore-Actor-Id`, and require `X-Syncore-Workspace-Id`.
- The bearer proves the caller is the bot; the CRM trusts the bot's actor header. It does not
  independently prove the human identity.
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
| Revise through chat API | IMPLEMENTED — NOT VERIFIED | Route is built; no joint bot/API test proves it. |
| T2 two-person rule | COMPLETE | Unit and PostgreSQL concurrency coverage prove first-actor pending, same-actor rejection, second-distinct finalization, replay, and decline. |
| T1 policy | NOT STARTED | Field exists but no code consumes it. |
| Enqueue initial approval request | NOT STARTED | Brief/approval creation does not call `enqueueNotify`. |
| Notify after dashboard decision/revision | IN PROGRESS | Final decisions enqueue once inside the decision transaction. Dashboard revision notification retains the older post-transaction path. |
| Notify after chat API decision/revision | IN PROGRESS | Final decisions enqueue transactionally through the shared service. Chat revision notification remains absent. |
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

- Final decision and outbox insertion are one transaction on dashboard and chat paths. Dashboard
  revision notify remains post-transaction, and chat revision notify remains absent.
- Initial approval creation never enqueues an event.
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
| Budget preflight and actual reconciliation | NOT STARTED | Cost aggregate helpers exist but are unused. |
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

CRM-1 therefore implemented a migration seam:

- `ProviderUsageLedger` remains the legacy, blob-projected generation.
- `CostEntry` is the native Growth generation and includes campaign and stage-run attribution.
- `listCostEntries` unions both generations into one logical read model.
- Campaign/stage filters exclude legacy rows because those rows have no campaign or stage IDs.
- `campaignSpendCents` and `stageRunSpendCents` aggregate only native `CostEntry` rows.

| Ledger behavior | Status | Current fact |
|---|---|---|
| Logical union read model | IMPLEMENTED — NOT VERIFIED | Code merges both generations into one time-ordered page, but no direct test exercises the union. |
| Campaign and stage spend aggregates | IMPLEMENTED — NOT VERIFIED | Database aggregate functions exist for native rows, but no direct test or caller exercises them. |
| Growth cost writer | NOT STARTED | No `costEntry.create`, `createMany`, or `upsert` call exists in application code. |
| Budget-gate consumption | NOT STARTED | Aggregate helpers have no callers. |
| Legacy campaign attribution | NOT STARTED | Historical rows lack campaign/stage identity; guessing attribution is intentionally rejected. |
| Final single-table ledger after blob peel | NOT STARTED | The read seam remains necessary until legacy ledger ownership becomes native. |

This is physically two tables but intentionally one logical ledger during migration. The native
table must not be replaced by direct native writes to `ProviderUsageLedger` while that table remains
in projection ownership.

## 9. Test, build, and CI evidence

### Local evidence from this review

| Check | Status | Result on 2026-07-29 |
|---|---|---|
| Projection invariant | COMPLETE | Passed; projection file free of all 22 guarded Growth model names. |
| Unit tests | COMPLETE | 102 test files, 624 tests, zero failures. |
| Lint | COMPLETE | `npm run lint` exited zero. |
| TypeScript | COMPLETE | `npm run typecheck` exited zero. |
| Production build | COMPLETE | `npm run build` exited zero with Next.js 16.2.7 and emitted all current routes. |
| Local real-PostgreSQL integration | COMPLETE | PostgreSQL 16 on isolated port 55432 applied all 18 migrations; 9 files and 52 tests passed, including 13 approval-orchestration and 9 direct delivery tests. |
| Local Playwright | COMPLETE | All 5 blocking Growth OS tests passed against Next.js and PostgreSQL on isolated port 3011, including the seeded NICHE_TEST decision-route replay test. |

Current test inventory is 102 unit files, 9 integration files, and 14 Playwright files.

### GitHub evidence

PR #170 merged `crm-1-spine` into `main` as `bb603d3` on 2026-07-29. The post-merge push CI run
`30478238419` completed successfully for that exact SHA:

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
- Growth pages render under Playwright, and a seeded signed decision route creates one Campaign,
  the two safe stage rows, and one outbox event under blocking Playwright.

Not verified:

- a real API-to-bot approval round trip;
- initial approval-request notification creation;
- side effects for the ten approval types after `NICHE_TEST`;
- staging or production rollout of the CRM-1 migrations and code.

## 10. Local, staging, and production deployment evidence

| Environment | Status | Evidence and limitation |
|---|---|---|
| Local build/toolchain | COMPLETE | Sibling contracts checkout is exactly v0.2.1; lint, typecheck, 624 unit tests, invariant, Prisma checks, and production build pass. |
| Local running app with PostgreSQL | COMPLETE | All 18 migrations applied to isolated PostgreSQL 16; 52 integration tests and the focused seeded-approval Next.js/Playwright route test pass. |
| Staging procedure | IMPLEMENTED — NOT VERIFIED | Database cutover documentation describes staging migration/seed/write checks. No staging environment, URL, deployment workflow, or current CRM-1 staging result is recorded in the repository. |
| AWS infrastructure code | IMPLEMENTED — NOT VERIFIED | Terraform, Caddy configuration, systemd units, migration, deploy, redeploy, health, and rollback scripts exist; they were inspected but not applied during this review. |
| AWS production infrastructure claim | IMPLEMENTED — NOT VERIFIED | `docs/AWS_MIGRATION.md` says the EC2/RDS migration completed 2026-07-10, but this review did not query AWS or the production health endpoint. |
| CRM-1 production rollout | IMPLEMENTED — NOT VERIFIED | No deployment record proves Steps 1.2/1.3 or migrations `20260729200000_growth_os_notify_delivery_leases` and `20260729214000_growth_os_niche_approval_side_effects` are live. |

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

1. **CRM-1 acceptance is not fully cross-repository.** Local HTTP/PostgreSQL/Playwright now proves
   final NICHE_TEST application, but initial APPROVAL_REQUESTED creation and the same-record real-Bot
   round trip remain unverified.
2. **Revision notification parity remains incomplete.** Final decisions are transactional on both
   surfaces; dashboard revision notify is still post-transaction and chat revision notify is absent.
3. **Notify delivery is at least once.** Crash-after-acceptance and lease-expiry races can retry the
   stable event ID; correctness depends on the Bot retaining its documented deduplication behavior.
4. **`CostEntry` has no writers.** Campaign/stage spend and budget controls currently read an empty
   Growth ledger.
5. **No budget gate exists.** Stored caps and thresholds do not prevent paid execution.
6. **The chat actor is trusted.** Shared bearer authentication does not independently establish a
   human identity for adversarial two-person approval.
7. **Revision concurrency still uses the repository transaction without the decision service's row
   lock.** Concurrent decision application is locked/retried; concurrent revisions need the same
   treatment before multi-operator revision traffic.
8. **Stage transition concurrency is not locked or compare-and-set.** A transaction alone does not
    prevent two callers from reading the same old status and applying different legal transitions.
9. **No cross-workspace campaign check exists in generic `createStageRun`.** The NICHE_TEST
   initializer validates the chain, but independent generic foreign keys can still represent an
   inconsistent workspace/campaign pair.
10. **In-memory rate limiting is instance-local.** It does not coordinate if the web tier scales.

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

**Next exact step: Lead Engine CRM Wave 1, Step 1.4 — CostEntry versus ProviderUsageLedger ADR and
decision. Do not start CRM-2 APIs first.**

Step 1.4 must resolve the documented conflict between golden rule 3 (one logical ledger, extend
`ProviderUsageLedger`) and golden rule 1 (Growth-native rows cannot safely enter a blob-projected
table). It must produce the ADR, select the target schema/migration direction, define rollout and
rollback, and update the repository plan before any paid-stage writer or budget gate is added. This
Step 1.3 commit intentionally changes no cost-ledger model or behavior.

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
