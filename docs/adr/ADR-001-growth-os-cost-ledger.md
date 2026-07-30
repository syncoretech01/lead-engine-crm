# ADR-001: Growth OS cost-ledger ownership

**Status:** ACCEPTED

**Decision date:** 2026-07-30

**Approver:** Syncore Tech project owner

**Accepted option:** Option C — separate operational provider usage from financial cost events

## Context

The Lead Engine CRM is the Growth OS campaign control plane. It owns campaign execution,
spending decisions, authorization, reconciliation, and spend reporting. It also contains a legacy
provider-execution subsystem whose state is stored in `AppStateSnapshot` and projected into
normalized Prisma tables.

Two plan rules collide in the cost area:

1. Growth OS records must be Prisma-native and must never share a table owned by the legacy blob
   projection, because projection cleanup deletes rows that are absent from the blob.
2. The Growth OS plan says to extend the existing `ProviderUsageLedger` and never create a second
   cost ledger.

CRM-1 introduced a Prisma-native `CostEntry` table and a combined logical read model without first
settling that conflict in an ADR. This ADR now settles the ownership model. Acceptance does not
authorize the additive schema, writers, budget gate, actual-versus-approved reconciliation, or any
paid Growth OS execution; those require a separately approved implementation step.

This ADR uses "ledger" in two distinct senses:

- a **financial control ledger** is the immutable, auditable record of estimates,
  authorizations, approved ceilings, actual charges, adjustments, and reversals; and
- an **operational usage record** describes a provider invocation and its measured units/cost
  evidence.

One operational event may support one financial cost action, but the records are not
interchangeable and must not be counted twice.

## Existing implementation

### `ProviderUsageLedger`

`ProviderUsageLedger` was created by the normalized-schema baseline and remains part of legacy
`AppState`. It stores:

- workspace, provider, and operation;
- optional lead job, provider job, and provider job-run identifiers;
- units, unit cost, total cost, currency, and `amountKind`;
- redacted provider metadata and creation time.

It has workspace/provider/job indexes, but no database idempotency key and no foreign keys to a
Growth `Campaign`, `CampaignStageRun`, `Approval`, authorization, or source event. Existing writers
flow through `recordProviderUsage()` and `updateState()`. Provider-job completion, live/mock
execution, enrichment, waterfall execution, seed/default repair, and legacy money/budget reporting
all consume or mutate the blob-owned array.

`recordProviderUsage()` updates an existing entry with the same provider-job-run and amount kind,
or creates a new random-ID row. That is appropriate for the current legacy operational model, but
it is not an append-only financial event model and does not provide a universal idempotency rule
for non-provider Growth actions.

### `CostEntry`

CRM-1 created `CostEntry` in migration `20260728120000_growth_os_crm1_spine`. It is outside
`AppState`, the projection table list, `upsertOrder`, and every normalized write-table set. It
currently stores:

- required workspace, provider, action, units, unit, unit cost, total cost, and status;
- optional campaign, stage run, reference type, and reference ID;
- metadata and creation time.

It has foreign keys to Workspace and optional Campaign and CampaignStageRun rows, plus indexes for
workspace/campaign/time, workspace/stage, and workspace/provider/action/time. It does not yet have
fields or constraints for currency, approval, authorization, source event, idempotency, immutable
event kind, approved ceiling, or reconciliation grouping. No application writer currently creates,
updates, upserts, or deletes a `CostEntry`.

### Projection lifecycle and deletion risk

`ProviderUsageLedger` is explicitly present in:

- the `AppState` type and default/seed lifecycle;
- `projectionTables`;
- the workspace-scoped `upsertOrder`; and
- the lead-generation, enrichment, lead-worker, and provider-job normalized write-table sets.

During a projection sync, the implementation maps `state.providerUsageLedger`, then executes a
workspace-scoped `deleteMany({ id: { notIn: ids } })` before upserting the blob rows. Therefore a
row written directly to the Prisma `ProviderUsageLedger` table, but not present in the authoritative
blob snapshot, can be deleted silently by the next applicable legacy write. A matching blob ID can
also overwrite the normalized row on upsert.

The Growth projection-invariant tests do not protect native records placed in
`ProviderUsageLedger`: that table is intentionally legacy and must appear in the projection. The
invariant correctly protects `CostEntry` because `CostEntry` is a native Growth model.

Moving Growth writes into `ProviderUsageLedger` safely would first require a complete blob peel:
removing the array, projection mapping, upsert-order entry, every write-table declaration, and all
legacy mutators in one coordinated migration. The repository's blob migration plan explicitly
requires that atomic ownership transfer and defers it until after the pilot.

### Combined logical read model

`lib/growth/read-models/cost-ledger.ts` currently exposes:

- `listCostEntries()`, which queries `CostEntry` and `ProviderUsageLedger`, maps them to a small
  common shape, merges them by `createdAt`, and returns one logical page;
- `campaignSpendCents()`, which aggregates native `CostEntry` rows; and
- `stageRunSpendCents()`, which aggregates native `CostEntry` rows.

Campaign and stage filters deliberately exclude legacy provider-usage rows because those rows have
no campaign/stage attribution. The read model has no direct tests or production callers. Its
timestamp-only cursor can skip entries sharing the same timestamp, it cannot expose approval or
reconciliation state, and an eventual linked provider-usage/financial pair would be double-counted
unless the public semantics are refined.

### Campaign, approval, and budget state

`CampaignStageRun` already carries cached `estimatedCostCents`, `approvedCostCents`, and
`actualCostCents`, along with optional provider, provider job, and approval identities. Approvals
are immutable and may carry provider proposals, estimates, caps, or spend-exception ceilings in
Contracts v0.2.1. The canonical plans require every paid call to pass a budget gate and require
actual-versus-approved reconciliation to park an overrun and create a `SPEND_EXCEPTION` approval.

These requirements are not implemented. The existing legacy `money.ts` budget logic reads
`ProviderUsageLedger`, while the native campaign/stage aggregate helpers read `CostEntry` and have
no callers.

## Plan conflict

The conflict is present inside the canonical plan itself:

- v9.1 section 5.1 says Growth entities are Prisma-native and never blob-projected;
- v9.1 section 6 describes `CostEntry` as extending `ProviderUsageLedger`;
- v9.1 section 21 says all spend goes through `ProviderUsageLedger`;
- v9.1 section 26 says every paid action writes a `CostEntry`; and
- `CLAUDE.md` and `docs/CRM-1-BRIEF.md` say to extend `ProviderUsageLedger` and never create a
  second ledger.

Before this ADR was accepted, the current physical implementation had chosen a safe migration seam
without defining whether that seam was temporary, redundant, or the intended semantic boundary.
The accepted decision below makes the operational-evidence/financial-control distinction binding.

## Requirements

The chosen design must:

1. preserve Growth-native financial records across every legacy projection sync;
2. cover provider and non-provider costs without fabricating provider identities;
3. attach campaign-phase spend to workspace, Campaign, and CampaignStageRun;
4. retain approval, authorization, estimate, approved ceiling, actual, currency, and source-event
   evidence;
5. make retries, callbacks, worker restarts, and concurrent processing idempotent at the database
   boundary;
6. preserve immutable audit history and represent corrections explicitly;
7. reconcile actual spend against the authorized ceiling and support overrun handling;
8. avoid double counting operational provider evidence and financial events;
9. preserve existing legacy rows without guessing Growth attribution;
10. expose one stable public cost-ledger API/read model for reporting and unit economics;
11. permit an incremental, reversible rollout before the deferred blob migration; and
12. support research, paid data acquisition, MillionVerifier, Audit Bot scans/full audits/videos,
    personalization models, Mailshake, and other outreach tools.

## Options considered

### Option A: Accept `CostEntry` as the native Growth OS store

`CostEntry` stores all native Growth costs. `ProviderUsageLedger` remains legacy/provider
projection data. The combined read model exposes one logical ledger, and an accepted erratum would
correct the canonical plans.

Advantages:

- matches the existing safe native/projection boundary;
- requires additive changes rather than a legacy ownership transfer;
- supports campaign and stage attribution already present in `CostEntry`;
- avoids deleting or overwriting native Growth costs during projection cleanup;
- accommodates non-provider costs; and
- minimizes immediate code and data migration.

Disadvantages:

- the name and current schema do not distinguish financial events from operational usage;
- provider usage and its corresponding financial actual need an explicit linkage;
- an unqualified union can appear to expose two competing ledgers or double-count one charge;
- existing plan language must be corrected; and
- all financial-control, idempotency, and reconciliation fields still have to be added.

### Option B: Move all Growth OS cost writes into `ProviderUsageLedger`

Refactor `ProviderUsageLedger` so native rows cannot be affected by projection cleanup, extend it
with Growth attribution and authorization fields, migrate or retire `CostEntry`, and use one
physical table.

Advantages:

- follows the literal "one table" reading of the older plan;
- reuses legacy provider usage and budget code;
- can eventually remove the combined-table read; and
- keeps provider operational data and financial amounts together for simple provider cases.

Disadvantages:

- unsafe until a complete, atomic blob peel changes every projection and legacy write path;
- a partial rollout can silently delete or overwrite Growth financial records;
- expands a cost-architecture decision into the deferred blob migration before the pilot;
- requires coordinated changes across numerous provider, enrichment, waterfall, seed, money,
  persistence, and test paths;
- makes research, audit, video, model, and outreach charges awkward when no legacy provider job
  exists;
- inherits mutable/upsert behavior and random IDs that are insufficient for an immutable financial
  ledger;
- requires a risky migration of existing `CostEntry` rows and compatibility handling for older app
  versions; and
- produces the largest data-loss and rollback surface.

### Option C: Separate provider usage from financial cost events

`ProviderUsageLedger` remains the legacy, projection-owned operational record of provider
invocations. `CostEntry` becomes the authoritative native Growth OS financial control ledger.
Provider-backed actuals link the two records. One reporting model is authoritative for spend and
distinguishes evidence from financial events.

Advantages:

- gives each existing table one unambiguous owner and purpose;
- preserves the native/projection XOR rule without accelerating the blob migration;
- supports both provider-specific usage and non-provider financial costs;
- permits append-only authorization, reconciliation, adjustment, and reversal semantics;
- preserves legacy operational rows without pretending that they have campaign, stage, or approval
  attribution;
- lets Growth writers and budget enforcement roll out incrementally;
- avoids double counting by making `CostEntry` the only authoritative Growth spend source; and
- leaves open a later, separately reviewed provider-usage peel or archival strategy.

Disadvantages:

- retains two physical tables and requires engineers to understand their semantic boundary;
- requires a linkage/reconciliation path when legacy provider execution performs Growth work;
- requires a more capable logical read model than the current timestamp union;
- may retain duplicated numeric facts when a provider usage row is evidence for a financial actual;
  and
- requires an accepted erratum because "one ledger" becomes one public financial ledger rather
  than one physical database table.

## Data-loss and projection risks

Option B has an immediate destructive risk: a direct native row in the current
`ProviderUsageLedger` table is outside `AppStateSnapshot` and can be removed by projection
`deleteMany`, or overwritten by an upsert with the same ID. No application-level repository guard
can neutralize a separate legacy transaction that later performs that cleanup.

Options A and C avoid that risk because native financial facts stay in `CostEntry`, whose absence
from the blob, projection, and normalized write lists is protected by CI. Option C reduces a second
risk present in a naive Option A: treating both table rows as equally financial can double-count a
single provider charge. Under Option C, a legacy provider row is operational evidence; the linked
`CostEntry` actual is the authoritative Growth spend event.

No option makes cross-workspace attribution safe with the current independent foreign keys alone.
Future repository code must verify that campaign, stage, approval, source, and provider-run
references belong to the same workspace; schema changes should add composite tenant-consistency
constraints where Prisma/PostgreSQL can express them safely.

## Migration implications

### Option A

Keep both tables. Add financial-control fields and constraints to `CostEntry`. Preserve existing
rows and optionally backfill only facts supported by authoritative references. Update reporting
semantics. Do not copy legacy rows without provable attribution.

### Option B

Preflight and back up both tables; deploy dual-compatible code; peel `ProviderUsageLedger` from the
blob and every mutator atomically; extend it; migrate `CostEntry`; reconcile duplicates; redirect
all reads/writes; then retire `CostEntry`. This is effectively a cross-cutting blob-migration phase,
not a focused CRM-1 closure step.

### Option C

Keep and preserve both tables. Extend `CostEntry` additively, introduce its transactional
repository and writers, and add optional evidence links to provider job/run/usage identities.
Existing `ProviderUsageLedger` rows remain untouched. Existing `CostEntry` rows must be inventoried
in every environment even though this checkout has no application writer; migration must not
assume production is empty. Unknown legacy attribution remains unknown.

## Recommended decision

**Accepted decision: Option C — separate operational provider usage from the native Growth OS
financial control ledger.**

On 2026-07-30, the Syncore Tech project owner reviewed this recommendation and formally accepted
Option C.

`CostEntry` is the authoritative native store for every Growth OS financial event.
`ProviderUsageLedger` remains a legacy, blob-projected operational usage store until a future
blob-peel decision. Native Growth code must not write financial facts directly to
`ProviderUsageLedger` while it is projection-owned.

This is preferable to Option A because it makes the operational-versus-financial boundary and the
anti-double-counting rule explicit. It is preferable to Option B because it avoids silent data loss,
a premature blob migration, and a high-risk conversion of mutable provider usage into the
authorization ledger.

The phrase "one cost ledger" should mean **one authoritative public financial ledger and spend
calculation**, not one physical table containing both legacy operational telemetry and Growth
financial control events.

Acceptance makes this ownership and no-double-counting model binding. It does not approve the final
Prisma schema or authorize schema, writer, budget, read-model, reconciliation, migration, or paid
execution work. The exact additive schema remains subject to environment row inventory and the
separate Wave 1, Step 1.4B implementation design.

## Accepted ownership rules

The following rules are binding:

1. `CostEntry` is Prisma-native and owned exclusively by Growth transactional repositories.
2. `CostEntry` never enters `AppState`, projection mapping, `upsertOrder`, or legacy write-table
   lists; the invariant guard remains mandatory.
3. `ProviderUsageLedger` remains owned by legacy provider/AppState workflows and is never a target
   for native Growth financial writes.
4. `CostEntry` is append-only for economic facts. Corrections use adjustment or reversal events;
   code does not rewrite or delete an amount, currency, source, scope, or authorization.
5. Every campaign-phase cost requires a workspace, campaign, and stage run. Repository and database
   rules must prove that all three share the same workspace.
6. Pre-campaign research costs require a workspace and ResearchRun/source event. They remain
   explicitly pre-campaign until a later append-only allocation attaches them to the campaign's
   `RESEARCH` stage; attribution must not be guessed or silently rewritten.
7. Provider-backed actuals may reference `ProviderJob`, `ProviderJobRun`, and/or the corresponding
   `ProviderUsageLedger` evidence. That evidence is not a second spend event.
8. A non-provider service uses an explicit service identity; it must not be forced into a fictitious
   provider job.
9. `CampaignStageRun` cost totals are cached/materialized control values reconciled from the
   authoritative `CostEntry` event stream, not an independent source of truth.
10. Metadata contains correlation and audit identifiers only, never credentials, bearer tokens,
    callback secrets, raw secret-bearing provider payloads, or sensitive request bodies.

## Proposed logical read model

The public logical "cost ledger" should expose a normalized cost-action view rather than a raw
union of unrelated rows. For each cost action it should return:

- stable action/group identity and immutable event identities;
- source generation (`growth_financial` or `legacy_operational`) and source system/event;
- workspace, campaign, stage run, provider/service, and operational job/run references;
- approval and authorization references;
- estimate, approved ceiling, actual, adjustment, and reconciled totals in one currency;
- units, unit, unit price, status, reconciliation state, remaining authorization, and overrun;
- creation/occurrence times and safe audit/correlation metadata.

Spend and unit-economics totals must use `CostEntry` financial events only. Legacy operational rows
may appear in workspace-level compatibility/history results, clearly labelled and excluded from
Growth financial totals. Campaign/stage filters continue to exclude unattributed legacy rows. When
a legacy usage row is linked to a native actual, the API returns the usage as supporting evidence,
not an additional amount.

Pagination should use a stable composite cursor such as `(occurredAt, id, source)` with a total
ordering. The current timestamp-only cursor should not become a public compatibility guarantee
because equal timestamps can be skipped.

## Proposed idempotency rules

The Step 1.4B implementation design should add database-enforced identities:

- a stable `costActionKey` groups the estimate, authorization, actuals, adjustments, and reversals
  for one economic action;
- `workspaceId + idempotencyKey` is unique for every native write command;
- `workspaceId + sourceSystem + sourceEventId + eventKind` is unique for a source event;
- partial actuals include a stable source line/sequence identity, rather than overwriting a prior
  actual;
- the same provider callback, worker retry, process replay, transaction retry, or lost HTTP
  acknowledgement returns the existing event; and
- linked `ProviderUsageLedger` evidence may support only the intended native actual/action under a
  database uniqueness rule.

Proposed immutable financial event kinds are `ESTIMATE`, `AUTHORIZATION`, `ACTUAL`, `ADJUSTMENT`,
and `REVERSAL`. Exact enum names and whether authorization is stored as a ledger event or a linked
immutable authorization record remain implementation-design questions, but the approved ceiling
must be historically reconstructible and must not be overwritten by the actual.

Normal estimate, authorization, and actual amounts should be non-negative integer minor units.
Signed value changes belong only to explicit adjustment/reversal semantics. Currency must be
normalized and aggregation must never mix currencies without an explicit conversion policy.

## Proposed approval and budget linkage

Every paid action should have one stable action group containing or referencing:

| Requirement | Proposed representation |
|---|---|
| Workspace | Required `workspaceId` on every event and uniqueness scope. |
| Campaign | Required for campaign-phase spend; absent only for documented pre-campaign costs. |
| CampaignStageRun | Required for campaign-phase spend and consistent with Campaign/workspace. |
| Provider or service | Typed provider when applicable; otherwise an explicit service identity. |
| Approval | `approvalId` for approval-gated spend; immutable linkage. |
| Authorization | Typed authorization source and ID, such as Approval or ProviderRunProposal. |
| Estimated amount | `ESTIMATE` event in integer minor units and currency. |
| Approved ceiling | Immutable `AUTHORIZATION` event/reference with ceiling and currency. |
| Actual amount | One or more idempotent `ACTUAL` events reconciled to the ceiling. |
| Currency | Required on every financial event; no implicit cross-currency summation. |
| Source event | Source system, event ID, and safe correlation metadata. |
| Idempotency key | Required, deterministic, and unique within workspace. |

Before dispatch, the budget gate should transactionally compare the requested estimate with the
campaign cap, stage authorization, prior actuals, and outstanding reservations/authorizations.
After completion or callback, actual events should reconcile against the same action and approved
ceiling. An actual beyond the permitted tolerance must atomically update/park the stage as required
and create or reuse the immutable `SPEND_EXCEPTION` approval. No external paid call should occur
inside the financial database transaction; the authorization and outbox/job pattern must make the
dispatch replay-safe.

Future actions map to the model as follows:

| Action | Financial/evidence linkage |
|---|---|
| Research | Link to ResearchRun/source event; allocate to the Campaign `RESEARCH` stage once one exists. Free/local work may record zero usage metrics but is not fabricated spend. |
| Paid data providers | Link CampaignStageRun, provider job/run, proposal/approval, and the legacy provider-usage evidence when that path executes the call. |
| MillionVerifier | CRM stores estimate/authorization and an idempotent actual from the Hub execution/result event; the Hub remains the executor. |
| Audit Bot scan | Link SCAN stage, AuditRun, authorization where paid, and the Bot callback/source event. |
| Full audit | Separate FULL_AUDIT cost action linked to its AuditRun and approval/authorization. |
| Video | Separate service/action and source event, even when part of the same audit workflow, so its unit economics remain visible. |
| Personalization models | Link PERSONALIZATION stage and PersonalizationRun/model request; record model/provider, token or call units, and idempotent actual. |
| Mailshake/outreach tools | Link COLD_OUTREACH or WARM_OUTREACH stage and provider job/account/source invoice event; record only billable events according to a defined metering rule. |

## Backward compatibility

- Keep the existing tables and rows during rollout.
- Do not reclassify or copy a legacy row unless authoritative campaign, stage, approval, source, and
  currency evidence exists.
- Existing workspace-level compatibility reads may continue to show legacy operational entries,
  with explicit source semantics.
- Existing legacy money/budget behavior continues to read `ProviderUsageLedger` until its own
  migration is separately scoped; it does not become Growth campaign budget authority.
- New `CostEntry` fields should initially be additive/nullable for existing rows, while the new
  repository requires them for new financial events.
- Deployments must preflight row counts, currencies, duplicate candidates, and orphaned references
  in both tables before constraints are added.
- Contracts v0.2.1 remains authoritative for Approval, Provider, and Stage shapes. No local
  Contracts event or provider enum should be invented. Services not represented by the current
  Provider enum require an upstream Contracts decision or a separately typed service field.

## Rollout plan

ADR acceptance does not authorize rollout. A separately approved Wave 1, Step 1.4B implementation
plan should use small, reversible steps:

1. inventory production/staging rows and define the exact additive schema;
2. add nullable fields, indexes, foreign keys, and uniqueness constraints with preflight checks;
3. add a transaction-aware, append-only `CostEntry` repository and concurrency/rollback tests;
4. implement one idempotent cost-action writer and reconciliation path at a time;
5. replace the raw union with the normalized logical read model and stable cursor;
6. make Growth budget gates consume only authoritative financial events;
7. validate legacy provider-evidence linkage without changing legacy projection ownership; and
8. deploy to local, staging, and production with reconciliation reports before enabling paid work.

The future implementation must keep `CostEntry` in every native/projection-boundary invariant that
already protects Growth models and must prove that legacy projection cleanup cannot delete native
financial events.

## Rollback plan

For the future additive implementation, deploy the previous application before disabling new
writers. Leave additive columns/tables/indexes in place during application rollback so new facts are
not lost. Reconcile and preserve all native financial events; use a forward fix for data issues.
Only remove additive schema after backups, production evidence, and explicit confirmation that no
deployed code reads or writes it.

Do not roll back by copying native financial rows into the current projection-owned
`ProviderUsageLedger`, deleting `CostEntry` rows, rewriting immutable amounts, or guessing legacy
attribution. Point-in-time recovery and immutable adjustment/reversal events are the recovery tools
for financial history.

## Testing requirements

An accepted implementation must include:

- schema and projection-invariant tests proving legacy cleanup cannot delete `CostEntry`;
- real-PostgreSQL tests for workspace/idempotency/source-event uniqueness;
- concurrent duplicate callback, worker retry, transaction retry, process replay, and lost-ack
  tests;
- append-only/immutability and adjustment/reversal tests;
- cross-workspace campaign/stage/approval/source rejection tests;
- estimate, authorization, partial actual, final reconciliation, and overrun tests;
- budget-gate and `SPEND_EXCEPTION` transaction/rollback tests;
- provider-evidence linkage and no-double-counting tests;
- non-provider research, verifier, audit, video, model, and outreach examples;
- currency validation and mixed-currency aggregation rejection tests;
- stable composite-cursor pagination, including equal timestamps;
- preservation of existing legacy and native rows through migration/rollback; and
- reporting/unit-economics tests proving Growth totals use the financial ledger once.

## Deferred questions

Human and implementation review must still settle:

1. the exact `CostEntry` schema and enum names;
2. whether authorization is a `CostEntry` event or a separate immutable authorization record linked
   to financial events;
3. whether pre-campaign research is later linked by an append-only allocation event or by a
   write-once attribution field;
4. the typed service identity for Research Console, Audit Bot, and other costs not represented by
   Contracts v0.2.1 `Provider`;
5. reservation/release semantics for approved but unspent ceilings;
6. partial charge, refund, credit, tax, currency-conversion, and provider-invoice semantics;
7. retention and eventual peel/archive policy for `ProviderUsageLedger`;
8. whether historical `CostEntry` rows exist outside the checked-out application's known writers;
9. exact API versioning and compatibility for the logical read model; and
10. who approves the exact implementation schema and migration rollout.

## Consequences

With this decision accepted, Growth OS has one authoritative and loss-resistant financial ownership
model with explicit authorization and reconciliation semantics. Legacy provider usage remains
available as operational evidence, and the pilot avoids a high-risk blob migration. Reporting must
understand the semantic
split and prevent double counting. Future work must extend `CostEntry` substantially before paid
execution is enabled; the current table and combined read model are not sufficient by themselves.

The accepted decision intentionally preserves data and defers destructive consolidation. It may leave
two physical stores for a long time, but it avoids pretending that mutable provider telemetry and
immutable financial control are the same object.

## Acceptance

- **Status:** ACCEPTED
- **Accepted option:** Option C — separate operational provider usage from financial cost events
- **Decision date:** 2026-07-30
- **Approver:** Syncore Tech project owner
- **Binding ownership rule:** `CostEntry` is the authoritative Prisma-native Growth OS financial
  control ledger. `ProviderUsageLedger` remains the legacy, `AppState`-projected operational
  provider-usage evidence store.
- **No-double-counting rule:** only authoritative `CostEntry` financial events count toward Growth
  spend, campaign spend, stage spend, budget consumption, authorization reconciliation, overrun
  calculations, and unit economics. Linked provider-usage evidence is not a second charge.
- **Projection prohibition:** native Growth financial code must not write financial events directly
  into `ProviderUsageLedger` while that table remains projection-owned.
- **Immutability rule:** financial events are append-only. Corrections use explicit adjustment or
  reversal events rather than destructive update or deletion, and historical attribution is never
  guessed without authoritative evidence.
- **Implementation boundary:** acceptance binds the ownership model but does not authorize a final
  Prisma schema, migration, runtime change, cost writer, budget gate, paid execution, or deployment.
  The exact additive design requires environment row inventory and a separate approved
  implementation step.
- **Next exact step:** Wave 1, Step 1.4B — implement the additive `CostEntry` financial-ledger
  foundation.
