# GROWTH OS PLAN — `lead-engine-crm`

**Aligned to:** Growth OS Plan v9.1 · **Roadmap phases:** P1 through P8 (this repo appears in every phase)
**Size:** **~60% of the total build.** Phased into CRM-0 … CRM-8.
**Stack:** Next.js 16 · React 19 · TypeScript (strict) · Prisma/Postgres
**Deploy:** AWS — EC2 (t4g) app + RDS Postgres, us-east-1; separate EC2 worker host (systemd `syncore-worker`)

> **Binding cost-ledger supersession (2026-07-30):** ADR-001 Option C is accepted, and
> `GROWTH_OS_ERRATA.md` entry 6 supersedes this plan's original "extend
> `ProviderUsageLedger`"/one-physical-table instruction. `CostEntry` is the authoritative native
> Growth financial ledger; `ProviderUsageLedger` remains projection-owned operational evidence and
> must not receive native Growth financial writes. Only `CostEntry` counts toward Growth financial
> totals, and linked provider evidence is never counted twice. Step 1.4B implementation is not
> started or authorized by the acceptance documentation.

> **This repo is the control room.** It is also the one carrying real architectural debt. Read §2 before writing a single line — one of those rules prevents silent data loss.

---

## 0. Role — what this repo is and is not

**IS:** the **campaign control plane**. Campaigns, approvals, all spending decisions, the single cost ledger, paid enrichment, lead tiering, audit orchestration, personalization, outreach orchestration, SDR workflow, hosted audit pages, and every dashboard.

**IS NOT:** the lead-data system of record. From v9.1 onward this repo **does not ingest, normalize, deduplicate, or verify raw leads** — the Hub does. The CRM consumes clean golden records and adds campaign context on top.

**The boundary in one sentence:** everything left of *"a golden contact becomes a campaign member"* is the Hub; everything right of it is here.

---

## 1. Ground truth — verify at session start

```bash
npm run test                                                    # ~90 vitest files; confirm the count
grep -nE '^(model|enum) ' prisma/schema.prisma | wc -l          # ~75 models
grep -n 'deleteMany' lib/phase1/persistence-projection.ts       # ⚠️ ~line 1559
grep -n 'SYNCORE_PROJECTION_MODE' lib/phase1/store.ts           # defaults to 'diff'
grep -n 'workspaces\[0\]' lib/phase1/store.ts                   # ~825–828, migration blocker
sed -n '1,80p' lib/providers/register-live-adapters.ts          # which adapters are registered
grep -rn 'stepNumber === 1' lib/phase1/outreach.ts              # ~339–368, the inert engine
```

**Already exists — do NOT rebuild:** CSV import + field mapping · normalization · dedupe · `SuppressionRecord` · `VerificationResult` · `EnrichmentResult` + provider cache · `LeadScore`/segments · CRM entities (`Account`/`CrmContact`/`Opportunity`/`Activity`/`Task`/`Note`/`CallLog`) · SDR (`SdrTeam`/`SdrAssignment`/`FollowUpReminder`/`ReassignmentRule`) · outreach models · signed HMAC webhooks (`/api/webhooks/email|sms|ses`) with idempotency keys · the provider framework with idempotent out-of-band jobs and worker scripts · AES-256-GCM secret vault · `ProviderUsageLedger` · export gates · the `Ai*` heuristic suite.

**Live provider adapters exist** behind a double gate (`SYNCORE_ENABLE_LIVE_PROVIDERS=true` **and** connection `executionMode:"live"`): `hunter` (find+verify), `apollo` (find), `apify_maps`/`apify_harvest`, `millionverifier`, `amazon_ses`. `ringcentral` written but unregistered. **Making these live is wiring + gating, not adapter authorship.**

**Three known problems:**
1. **The blob landmine.** App state is one JSON blob (`AppStateSnapshot`, ~70 top-level arrays) projected onto ~74 tables. `lib/phase1/persistence-projection.ts:~1559` runs `deleteMany({ where: { workspaceId, id: { notIn: ids } } })` for every table in `upsertOrder` — **any projected table loses every row not present in the blob on the next sync.** Caused a production OOM and an egress-cap breach; ~3 MB ceiling. Mitigated by a `writeSeq` CAS guard and `SYNCORE_PROJECTION_MODE` defaulting to `diff`, but not fixed.
2. **Outreach is UI-without-engine.** Send paths only ever resolve `stepNumber === 1`; delays, stop-on-reply, and SMS are inert; there is no scheduler, no open/click tracking, no reply inbox. **This is why Mailshake exists in the plan.**
3. **Read models cap results** (`take: 500` / `take: 1500`). Every new read model must paginate server-side.

---

## 2. Golden rules — read before writing code

1. **🔴 Blob-projected XOR Prisma-native. Never both.** Every new Growth OS model gets its own table, its own transactional repository (follow the `lib/phase1/auth-fast-path.ts` precedent), and its own paginated read model. **Never** add it to `AppState`, `syncNormalizedProjectionToPrisma`, or `upsertOrder`, and never write it via `updateState`. *If a natively-written table is ever added to the projection "for consistency," the `deleteMany` call silently destroys every row.* **CI enforces this (CRM-0).**
2. **Every real stage is a `CampaignStageRun`.** No orphan work. `CostEntry` and `Approval` reference `stageRunId`.
3. **One cost ledger.** Extend `ProviderUsageLedger`. Never create a second.
4. **Every paid call passes the budget gate first**, and reconciles actual-vs-approved after (§CRM-4).
5. **Approvals are immutable.** Create + decide + **revise** only. An edit supersedes the original and creates a new row with a new SHA-256. No update path on the payload — enforce it at the repository level.
6. **`NicheRequest` (Template A) ≠ `NicheBrief` (Template B).** No brief and no `NICHE_TEST` approval may exist before research completes.
7. **The CRM never calls the Email Verifier and never runs MillionVerifier itself.** It trusts the Hub's `emailStatus`; it *prices, approves, authorizes, and ledgers* MV, which the Hub executes.
8. **No link in automated cold touch 1.** Enforce with a validator that blocks launch.
9. **Route on intent, not raw opens.** Opens are inflated by image pre-fetching; they adjust score only.
10. **Never enroll a warm campaign before its asset exists and passes QA.**
11. **Server-side pagination on every new read model.** No row caps.
12. **Providers stay mock by default.** Go live one connection at a time behind the double gate.
13. **Never cold-send from `syncoretech.com`.** Lookalike domains only; SES is transactional/warm/system.
14. **`OutreachCampaign` and the raw lead-ingestion path are legacy.** Nothing new references them.

---

## 3. Phases

### CRM-0 — Guardrails first *(2–3 days)* — **P1**

**Do this before any feature work.** It's the cheapest phase and it prevents the most expensive failure.

**Tasks**
- **CI static check** that fails the build if any Growth OS table name appears in `lib/phase1/persistence-projection.ts` or its `upsertOrder`
- **Prove it fails:** add the check, deliberately violate it, watch CI go red, revert
- GitHub Actions: lint + typecheck + vitest on every push
- Root `CLAUDE.md` distilling these golden rules, pointing at v9.1 — so every Claude Code session auto-loads the constraints
- Baseline: run the full suite and record the actual pass count

**Acceptance:** CI is green; the invariant check demonstrably fails when violated; `CLAUDE.md` exists.

---

### CRM-1 — The spine *(3–4 weeks)* — **P1**

**Goal:** campaigns, stage runs, and approvals exist, all Prisma-native.

**Models (all native, none in the blob):**
`NicheRequest` · `ResearchRun` · `NicheBrief` · `Campaign` · `CampaignStageRun` · `Approval`

Field definitions are in v9.1 §6. Key points:
- `Campaign`: `budgetCapCents`, `spendWarnThresholdPct` (default 80), `overrunTolerancePct` (default 20), kill-rule config, automation level, `nicheBriefId`, `eligibilityPolicyId`
- `CampaignStageRun`: `stageType`, `status`, `estimated/approved/actualCostCents`, `inputRecords`/`outputRecords`, `provider`, `providerJobId`, `approvalId`, `failureCode`, `retryCount`, `reportPayload`
- `Approval`: `payloadJson`, `payloadSha256`, `status`, `supersedesApprovalId`, requester/approver/decision time

**Tasks**
- Transactional repositories for each — never `updateState`
- Paginated read models (tight `select`, `workspaceId` in `where`)
- `CostEntry` extended with `stageRunId`
- **Stage state machine:** `PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → COMPLETED | FAILED | PARKED | CANCELLED`
- **Approval Inbox UI** + the revision flow
- Chat API: `POST /api/chat/niche-request` (creates a **`NicheRequest`**, *not* a brief) · `POST /api/approvals/{id}/decide` · `POST /api/approvals/{id}/revise`
- Outbound notify to the bot (HMAC-signed, allow-listed origin)
- IA: Campaigns as nav root; existing function nav → secondary Library/Ops group; a Lead Hub launch tile; label the outreach area "Outreach (legacy sequences)" and add a header comment marking `OutreachCampaign` legacy

**Tests (hardened)**
- New tables absent from `upsertOrder`; never written via `updateState`
- Approval payload has **no update path**; hash is stored; a revise creates a new row referencing the original
- A two-workspace tenant-isolation roundtrip returns zero cross-tenant rows
- Read models paginate (no unbounded `take`)

**Acceptance:** create a campaign → an approval appears in the Approval Inbox → decide it → the state persists → an edit produces a revision chain. Nothing new touches the blob.

---

### CRM-2 — Research loop *(1.5–2 weeks)* — **P2**

**Goal:** a voice note becomes an approved campaign.

**Tasks**
- `ResearchRun` durable queue + `GET /api/research-runs/next` (claimed by the Console Agent, bearer-authed, idempotent claim)
- `POST /api/research-runs/heartbeat` — powers the bot's honest *"Console is offline"* message
- `POST /api/webhooks/research-console` (HMAC-signed) for progress and completion
- On completion: validate the brief independently → create `NicheBrief(pending_approval)` → create `Approval(NICHE_TEST)`
- **Guard:** no `NicheBrief` and no `NICHE_TEST` may exist before a `ResearchRun` completes — assert in tests
- On approval: create the `Campaign` with budget cap, kill rules, and eligibility policy

**Acceptance:** a `NicheRequest` from the bot → queued run → Agent completes it → brief validated → approve from chat or dashboard → `Campaign` exists. With the Agent offline, the run stays queued and the CRM reports it.

> **This is the first end-to-end demo. Show it to someone before continuing.**

---

### CRM-3 — Hub integration + verification control *(2 weeks)* — **P3**

**Goal:** golden records arrive under a campaign; MV is priced, approved, and ledgered here.

**Models:** `HubSync` (cursor: `hubSegmentId`, `lastCursor`, `contactsPulled`, `contactsSuppressedOnArrival`, `lastRunAt`)

**Tasks**
- **Golden intake:** import a Hub golden segment under a campaign; store `hubContactId`/`hubCompanyId` in a native side-table; populate `Company`/`Contact` as a **campaign-scoped cache**; re-run dedupe + suppression as a safety net
- Stage runs: `HUB_SEARCH`, `GOLDEN_SYNC`, `FREE_VERIFICATION` (recorded from the Hub's result), `PAID_VERIFICATION`
- **MV pricing + approval:** count the Hub's `unknown` set → estimate cost → `Approval(PAID_VERIFICATION)` → on approval call `POST {hub}/api/verify/millionverifier` with the approval reference
- `POST /api/webhooks/hub-verify-result` (signed) → write the `CostEntry` against the stage run
- Populate `VerificationResult` **from the Hub's status** — no verifier call from here
- **Do not build a verifier adapter.** Keep `millionverifier` dormant as a CRM adapter; MV executes in the Hub.

**Acceptance:** a Hub segment lands under a campaign with suppression re-checked; every lead references a `hubContactId`; approving MV triggers a Hub-executed run whose actual cost lands in the ledger against the right stage.

---

### CRM-4 — Acquisition & enrichment waterfall *(2.5–3 weeks)* — **P4**

**Goal:** approve a provider run in chat and watch data flow into the Hub automatically.

**Models:** `ProviderRunProposal`

**Tasks**
- **Hub overlap pre-check:** call `POST {hub}/api/search/overlap` *before* rendering a proposal — this is what makes expected unique yield and cost-per-unique real rather than guessed
- Proposal shows: provider · purpose · estimated records · estimated cost · **existing-Hub overlap** · **expected unique yield** · **cost per expected unique** · fallback provider
- Decision options: **approve** / **approve capped at N records** / **skip** / **replace provider** / **approve the remaining waterfall within a fixed ceiling** (anti-fatigue)
- Execute under an `ACQUISITION` stage run (adapters exist — wire + gate them), then **push results to the Hub** via `POST {hub}/api/import/provider-result` with `contentHash`
- `ENRICHMENT` stage: Hunter/Apollo on **post-dedupe uniques missing fields only** — never on duplicates, never on addresses the free verifier already resolved
- **Budget gate** in one shared pre-flight helper so every paid adapter inherits it: sum ledgered spend + estimate; ≥ warn → flag; ≥ cap → **park + `SPEND_EXCEPTION`**
- **Actual-vs-approved reconciliation:** on completion, if `actual > approved × (1 + overrunTolerancePct)` → auto-park the stage + open `SPEND_EXCEPTION`. *(Provider costs are usage-based; this will fire in practice.)*
- Per-provider 429/5xx backoff (retryable)
- Validate each provider with `scripts/validate-adapter.ts` before enabling

**Acceptance:** a proposal in Telegram shows honest unique-yield math → approve → the job runs → raw appears in the Hub → enrichment touches only uniques → an overrun parks the stage and raises an exception. Mock mode still works with flags off.

> **Deferrable:** if this phase runs long, fall back to operator-uploads. Everything downstream is identical; the bot just can't claim it ran the extraction.

---

### CRM-5 — Scan & tiering *(1.5–2 weeks)* — **P5**

**Goal:** every company scored, with factual findings stored for personalization.

**Models:** `AuditRun` · `AuditFinding` · (`AuditAsset` stubbed for CRM-7)

**Tasks**
- `audit-bot` adapter: submit `mode=scan` with bearer + `meta` (`campaignId`, `companyId`, `auditRunId`, `stageRunId`)
- `POST /api/webhooks/audit-bot` — **mirror `/api/webhooks/email`**: `verifyWebhookSignature`, resolve workspace from the signed/echoed `meta` via `resolveSignedWebhookWorkspaceId` (**never first-match**), dedupe by `auditRunId` + finding, dead-letter on failure
- Store each finding as an `AuditFinding` (code + evidence); set `Company.websiteWeakness`; write the `CostEntry`
- 30-day scan cache; typed-failure mapping
- **Tiering → A/B/C/X with visible reasons:** fit + contact quality (Hub score + verification status) + measured weakness

**Acceptance:** every company with a website has a scan score or a typed failure; findings are stored as structured facts; tiers show their reasons; a redelivered callback changes nothing.

---

### CRM-6 — Personalization & cold send *(3–4 weeks)* — **P6, the largest phase**

**Goal:** approve one template plus a few samples, then launch.

**Models:** `PersonalizationProfile` · `PersonalizationRun` · `MessageTemplate` · `MessageTemplateVersion` · `GeneratedMessage` · `CopyQaResult` · `PersonalizationSampleSet`

**Tasks**
- **LLM provider adapter** behind the existing double gate — the CRM has none today (`Ai*` is heuristic). Per-call cost to the ledger; automatic fallback to heuristics on error.
- **Tiered generation** (async batch, between "list ready" and "launch"):
  - **Tier A** — a cloud model weaves the specific `AuditFinding` + the brief's chosen angle
  - **Tier B** — deterministic `findingCode → phrase` templates + niche pain, role, city, company (local model or pure templating)
  - **Tier C** — approved template + merge tags, **no per-lead LLM**
- **Phrase-template library** keyed by `findingCode` (lives here, not in the Audit Bot — it's copy, it changes often, it's campaign-tunable)
- **Port the Console's QA rules** (see the Console repo's `docs/PERSONALIZATION_RULES.md`): greeting-as-subject, vary-touches, normalize-slips → `CopyQaResult` gate. Failing copy never queues.
- **Spin syntax** support for send variation
- `Approval(PERSONALIZATION_SAMPLES)` over a stored `PersonalizationSampleSet` — you approve the *pattern*, not 300 emails
- **Mailshake adapter** (net-new): export with the agreed fields (including `hub_contact_id`), suppression re-check at export, approved-copy hash must match the export, store Mailshake IDs
- **Touch-1 no-link validator** — blocks launch
- Pre-launch checklist + `Approval(CAMPAIGN_LAUNCH)`
- Event ingestion: poll Mailshake every 10–15 min (CSV fallback) → idempotent `EngagementEvent` (dedupe key `(workspaceId, provider, providerEventId, eventType)`; raw payload stored)
- Unsubscribe/bounce/complaint → `SuppressionRecord` → **reconcile to the Hub**
- Circuit breakers: bounce > 3% / complaint > 0.1% / unsubscribe > 2% per campaign-day → auto-pause + `RESUME_AFTER_BREAKER`; source invalid-rate > 20% → park source + flag the Hub source

**Acceptance:** variables generate in batch with **no second crawl**; Tier-C uses zero per-lead LLM; you approve a template + 3 samples; launch is blocked if touch 1 contains a link or the checklist fails; events flow; a breaker simulation pauses and raises a resume approval; a Mailshake unsubscribe suppresses in both systems.

---

### CRM-7 — Intent, full audits & SDR *(2.5–3 weeks)* — **P7**

**Goal:** real interest reaches a human with proof in hand.

**Tasks**
- **Intent scoring** with a **meaningful-click filter**: exclude known scanner/link-checker user-agents, clicks arriving within seconds of delivery, and unsubscribe clicks. Raw opens adjust score only — **never route on opens alone.**
- **Audit eligibility rules:**
  - *Always:* positive reply · explicit audit request · SDR-qualified opportunity · named strategic account
  - *Conditionally:* Tier-A + meaningful click · repeated strong engagement · audit-page interest
  - *Never alone:* a single open · a single unconfirmed low-tier click
- `AUDIT_BATCH` approval → `mode=full` (+ `mode=video` as a separate job for very strong intent + Tier A) → `AuditAsset`
- **`WARM_CAMPAIGN_PENDING_ASSET` state** — warm enrollment is blocked until the audit **and** hosted page exist **and** pass QA. An SDR may send a non-asset message first.
- **Hosted audit pages:** unguessable slug, `noindex`, expiry, revoke, access logs, per-slug rate limit, **CRM-proxied presigned S3 GETs** (bucket paths never exposed). Emit `AUDIT_PAGE_VIEWED` / `VIDEO_PROGRESS`.
- Reply classification → routing → `SdrAssignment` (reuse); sales brief; **Hot Lead Workspace** (greenfield, `--ui-*` tokens): contact, company, audit proof, talking points, thread, next action, Cal.com link
- Angry/legal → global suppression (CRM + reconciled to Hub) + escalate

**Acceptance:** a reply routes immediately; a qualifying lead gets a full audit; the warm campaign fires only after the asset exists and QA passes; a single open triggers nothing expensive; object-level authorization tests pass on hosted pages.

---

### CRM-8 — Admin dashboard, eligibility & the loop *(2–2.5 weeks)* — **P8**

**Goal:** see everything, enforce contact hygiene, and reuse the warehouse.

**Models:** `CampaignEligibilityPolicy`

**Tasks**
- **Admin dashboard built from `CampaignStageRun`:** the complete start→end timeline; per-stage estimated/approved/actual cost; records in/out; progress %; bottlenecks; failure/retry visibility
- True unit costs: cost per verified contact · cost per reply · **cost per meeting** · verifier-avoided · duplicate-merge rate
- Kill-rule evaluator + `Approval(SCALE)`
- **`CampaignEligibilityPolicy` applied at every list build** (both entry points): suppression · verification age · **active campaign membership (one active cold campaign per contact)** · prior history · last-contacted date · prior negative/positive reply · existing opportunity · client status · **account- and domain-level frequency caps** · SDR ownership · geo/service exclusions
- **Entry Point B:** existing-Hub campaigns with **three brief modes** — fresh research, reuse an approved `NicheBrief`, or a lightweight operator-defined brief. Skips acquisition, **not** strategy. Triggers the Hub's 90-day re-verification refresh.
- Niche Board + winning-template capture; post-mortem export to the Console; winning angle → a pre-drafted `NicheRequest`
- `GET /api/growth/health`: queue depth, oldest job age, dead-letter count, webhook failure count, spend-vs-cap per active campaign

**Acceptance:** the dashboard reconstructs a campaign end to end from stage runs; an existing-Hub campaign launches with no acquisition spend but *with* a brief; no contact appears in two active cold campaigns.

---

## 4. Contracts

**Consumed:** Hub (`/api/search/overlap`, `/api/import/provider-result`, `/api/verify/millionverifier`, `/api/suppression/reconcile`, golden export) · Audit Bot (`POST /jobs`) · Mailshake · SES · the bot's `/notify`.

**Provided:** `/api/chat/niche-request` · `/api/approvals/{id}/decide|revise` · `/api/research-runs/next|heartbeat` · `/api/webhooks/research-console` · `/api/webhooks/audit-bot` · `/api/webhooks/hub-verify-result` · `/api/growth/health`.

All schemas live in `syncore-contracts`. **Change the contract there first, then in consumers.**

---

## 5. Anti-scope — do NOT build

- **Raw lead ingestion, normalization, dedupe, or verification** — the Hub owns these (legacy path stays for non-Growth-OS use only)
- **A verifier adapter** — the CRM never calls the Email Verifier
- **A native cold-sending engine** — Mailshake owns sequencing/sending/tracking for the pilot. `PHASE_B_OUTREACH_SPEC.md` is read-only context.
- **A second cost ledger**
- **BullMQ, Prometheus, Grafana, OTel, Temporal, Trigger.dev** in this repo before a proven blocker (the Hub's BullMQ stays in the Hub)
- **Blob migration** — out of pilot scope; the `workspaces[0]` assumption in `store.ts:~825–828` must be fixed before any peel, post-pilot
- Anything referencing `OutreachCampaign` in new code

---

## 6. Session protocol

1. Read this file, the golden rules (§2), and v9.1 §3.1, §5, §6, §9, §10, §11
2. Also read the in-repo docs before proposing architecture: `docs/CAMPAIGN_WATERFALLS.md`, `docs/PROVIDER_INTEGRATION_PLAN.md`, `docs/M1_PROVIDER_EXECUTION.md`, `docs/PHASE_B_OUTREACH_SPEC.md`, `docs/SECRETS_AND_CREDENTIALS_PLAN.md`, `docs/BACKGROUND_JOBS.md`, `docs/AWS_MIGRATION.md`, `BLOB-MIGRATION.md`
3. Verify ground truth; run the test suite
4. Propose a phase-scoped plan; get approval
5. Implement in small commits; typecheck + lint + test after each
6. `/clear` between phases — this repo is too large to hold in one context

**CI:** lint + typecheck + vitest + **the projection-invariant static check**.

**Rollback reality:** for persistence changes, `git revert` is **not** a rollback. Forward-fix plus RDS PITR is the story. Confirm backups and run a restore drill before CRM-1.
