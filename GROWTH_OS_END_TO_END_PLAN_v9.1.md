# Syncore Growth OS — Unified End-to-End Plan (v9.1, Executable Spec)

**Status:** Active, canonical build plan. **Single source of truth.** Supersedes `GROWTH_OS_END_TO_END_PLAN_v9.md` (which added the chatbot + personalization + Hub-first spend). v9.1 closes the contract and workflow gaps that stood between "strong vision" and "implementable spec." Where any older doc — including the per-repo `GROWTH_OS_PLAN.*` files — conflicts, this one wins (errata §31).
**Scope:** Internal Syncore use. Not a public SaaS.
**Repos governed (five):** `syncore-lead-hub` · `lead-engine-crm` · `syncore-audit-bot` (Site Whisper) · `syncore-research-console` · `syncore-email-verifier`. **Two non-repo services:** the **Chatbot** (Telegram-first, platform-neutral) and a **Console Agent** (polling bridge for the local Research Console).
**Verification stamp:** ground-truth §3 verified against the five repo snapshots on 2026-07-24.

> **v9.1 changes (from v9.0) — 11 non-negotiable corrections + extensions:**
> 1. **`NicheRequest` and `ResearchRun` added (§6, §7).** A voice note becomes a `NicheRequest` (Template A) — **not** a `NicheBrief`. `NicheBrief` (Template B) is created **only after** research completes. Resolves the v9 contradiction where the chat endpoint created a `NicheBrief`/`NICHE_TEST` before any research existed.
> 2. **CRM → Research Console execution contract + Console Agent (§9.1).** Chat → research is now automated: the CRM creates a `ResearchRun`; a **Console Agent** polls a durable queue, runs the Console when the machine is online, and returns progress + the completed brief. Handles offline gracefully.
> 3. **`CampaignStageRun` — the execution backbone (§6, §11).** One durable record per pipeline stage powers the admin dashboard, chatbot status, cost reports, retries, progress %, and historical reconstruction. `CostEntry`/`Approval` reference its `stageRunId`; it carries `estimated/approved/actual` cost with a reconciliation rule.
> 4. **Provider-result → Hub contract for automated acquisition (§9.3).** The CRM executes the Apify/Apollo job and pushes results directly into the Hub (`POST /api/import/provider-result`); the Hub creates `ImportBatch`/`RawRecord`s. Option A (operator upload) remains the fallback.
> 5. **Per-provider approval proposals with a Hub overlap pre-check (§10).** Each waterfall level proposes each provider with estimated records, cost, expected fields, **existing-Hub overlap, expected unique yield, cost-per-unique**, and a fallback — approvable per-provider / per-N-records / skip / replace / approve-remaining-within-ceiling.
> 6. **Approval editing is a revision, never an in-place edit (§10).** Editing supersedes the original (`status: SUPERSEDED`, new row with `supersedesApprovalId` + new SHA-256). Immutability preserved.
> 7. **Bot minimal durable store clarified (§9.4, §15).** The bot stores no lead/campaign/approval **truth**, but keeps a small durable mapping/outbox store (user↔CRM-user, chat/thread/message IDs, delivery/dedup/retry) so it survives restarts.
> 8. **Chat permissions formalized (§15, §23).** user → CRM user → workspace → role/permission; allow-listed chat IDs, signed callbacks, replay protection, one-time button tokens, spend thresholds, optional two-person approval for large spend.
> 9. **Scan returns factual findings; the personalization worker writes wording (§9.5, §13).** `mode=scan` emits `findingCode` + evidence from a closed `FindingCatalog`; it invents no marketing language. Wording (and QA of claims) belongs to the personalization layer.
> 10. **Warm audit-campaign sequencing fixed (§12 Stage 16–17).** A `WARM_CAMPAIGN_PENDING_ASSET` state gates enrollment on the audit/page existing + passing QA; an optional non-asset SDR touch bridges the wait.
> 11. **Concrete personalization tables + a global eligibility policy (§13, §14).** Named objects (`PersonalizationProfile`, `PersonalizationRun`, `MessageTemplate`, `MessageTemplateVersion`, `GeneratedMessage`, `CopyQaResult`, `PersonalizationSampleSet`) and a `CampaignEligibilityPolicy` (frequency caps, one-active-cold-campaign-per-contact, exclusions) applied to **both** entry points. Existing-Hub campaigns now require a brief (reuse or lightweight).
> **Extensions beyond the review:** stage-run estimate↔actual reconciliation with auto-park on overrun; `ProviderRunProposal` Hub pre-check; deterministic `findingCode→phrase` mapping for Tier B/C; "meaningful click" definition; a stage state machine; Telegram-first behind a platform-neutral interface.
> Everything from v9 (chatbot-as-remote-control, Hub owns data + all verification, CRM owns spend + execution, personalization from the scan, intent-based routing, dedupe-before-spend) is carried forward.

---

## 1. What Growth OS is
The disciplined, cost-controlled outbound loop connecting assets Syncore already owns into one measurable engine, driven from a chat surface. **Chatbot** = control surface (remote control). **Research Console** = niche/ICP intelligence. **Lead Hub** = lead-data system of record (raw vault → resolve/dedupe → **all verification** free+MV → tag → score → golden records). **CRM** = campaign control plane (campaigns, approvals, budget/ledger, paid **enrichment**, scoring/tiering, **personalization**, outreach orchestration, SDR, reporting). **Audit Bot** = website proof + **factual personalization signal**. **Email Verifier** = free L1. **Mailshake + SES** = sending (Mailshake cold+warm; SES transactional/warm/system).
**North star:** qualified meetings at the lowest cost per opportunity. **Operating principle:** automate repetitive work; approve money/reputation/strategy from anywhere. **Build principle:** one working vertical loop first. **Personalization principle:** collect signal once (the scan), reuse everywhere. **Spend principle:** only pay for what you don't already own.

### KPI chain
Cost per imported company → per resolved golden company → per verified contact (free-first) → per qualified lead → per scan → per full audit → per video → per positive reply → **per meeting** → per proposal → per closed client. Efficiency metrics: **Hunter/MV-calls-avoided** (free verifier + dedupe) and **duplicate-merge rate**.

## 2. The big idea
Run **controlled growth experiments**, not isolated campaigns. Collect a lead once (permanent, deduped, verified Hub), spend only on gaps you don't own (dedupe before paying), personalize from the audit you were already running. Each campaign has a hypothesis, brief, test size, budget cap, angle, audit policy, source policy, sending policy, kill rules, human approvals, cost tracking, and a post-mortem.

## 3. Ground truth — five codebases (2026-07-24, condensed)
- **CRM:** multi-tenant Next.js/Prisma/Postgres, ~75 models, on AWS prod (EC2 t4g + RDS). Live provider adapters exist behind a double gate (`hunter`, `apollo`, `apify_*`, `millionverifier`, `amazon_ses`; `ringcentral` unregistered). `Ai*` = heuristics; no Mailshake; no Go-verifier adapter (correct). **Blob landmine:** `AppStateSnapshot` → ~74-table projection with `deleteMany(notIn blobIds)` — projected tables lose rows not in the blob; ~3 MB ceiling; `diff` projection + `writeSeq` CAS mitigations. **Outreach engine inert** (step-1 only) → Mailshake. Net-new (0 in schema): `NicheRequest`, `ResearchRun`, `NicheBrief`, `Campaign`, `CampaignStageRun`, `Approval`, `ProviderRunProposal`, `EngagementEvent`, `AuditRun`, `AuditAsset`, `AuditFinding`, `HubSync`, `CampaignEligibilityPolicy`, and the personalization tables.
- **Audit Bot / Site Whisper:** Express + worker, SQLite queue, PM2, Playwright (desktop+mobile), ~15 deterministic checks, OpenAI+TTS+FFmpeg (full pipeline), S3 + Drive. Absent: `scan/full/video` switch, M2M bearer, HMAC callback. `preflight→capture→rules→ai→voice→pdf→video→s3`.
- **Research Console:** local Next.js (`C:\research`), whitelisted `shell:false` runner, `pathSafety` guards, local **Ollama**, email writer + QA on `fix/phase-0-safety-trust` (**currently re-crawls** — the step v9 removed). `niche-brief`=0. **Local Windows → availability problem (§9.1).**
- **Email Verifier:** Go fork (module+MIT preserved). Routes incl. `POST /v1/verifications:batch`, **`POST /batches`** (async, HMAC callback), feedback, erasure, health. Classes `valid|invalid|risky|unknown`; **honesty guarantee in code** (`smtp_timeout`→`unknown/retryable`; `null_mx`/`domain_not_found`→`invalid`). Env `SYNCORE_VERIFIER_*`; safe-bind.
- **Lead Hub:** Next.js 15/Prisma/**PG16**/**BullMQ+Redis**/**S3 vault**/**Haiku**. Pipeline `ingest→normalize→resolve→verify→classify→score→export`. Resolution ladder **MC/DOT→domain→place_id→phone→fuzzy(review)**; survivorship + provenance + `MergeEvent`/`FieldConflict`. **Verify bridge bug:** posts to nonexistent `/api/verify` (real: `/batches`), no bearer, no callback HMAC — **fix in G3.** ~25 models incl. `ImportBatch/RawRecord/Company/Contact/ContactEmail/ContactPhone/EntitySource/MergeCandidate/MergeEvent/FieldConflict/Tag/RecordTag/Segment/ExportJob/Suppression/ClassifierRun`.

## 4. Responsibility split (canonical)
| System | Responsibility |
|---|---|
| Research Console | Research, ICP, messaging intelligence |
| Chatbot | Commands, approvals, notifications (remote control) |
| Console Agent | Bridges the local Console to the CRM via a durable queue |
| Lead Engine CRM | Campaign orchestration, **spending**, paid **enrichment**, execution, reporting; the **stage-run** ledger |
| Lead Hub | Permanent lead data, dedupe, **all verification** (free + MV), verification history |
| Email Verifier | Free L1 verification |
| MillionVerifier | Paid fallback verification (Hub executes, CRM prices/approves/ledgers) |
| Audit Bot | Website **factual** evidence, PDF, video |
| Mailshake | Sequences, sending, reply tracking (cold + warm) |
| SDR Workspace | Calls, follow-ups, meetings, opportunities |

**Two systems of record, one boundary:** Hub owns lead DATA (up to a verified/deduped/tagged golden `Contact`); CRM owns campaign EXECUTION (from "golden contact → campaign member"). One sync contract joins them.

## 5. Architecture decisions (carried, with v9.1 refinements)
- **5.1 CRM Growth OS entities Prisma-native, never in the blob.** Includes every new object in §6. Own tables + composite indexes + transactional repositories + paginated read models; reference blob entities by ID. **CI static check fails the build** if a Growth OS table appears in `persistence-projection.ts`/`upsertOrder`.
- **5.2 Mailshake** owns cold + warm re-engagement (it reports opens/clicks/replies; SES does not). SES transactional/warm/system only. Never cold-send from `syncoretech.com`.
- **5.3 Repos separate (five) + two thin services** (bot, Console Agent). Integration by signed HTTP contracts.
- **5.4 Verification waterfall, all verification in the Hub.** L1 = Email Verifier (free, every unresolved email). L2 = MillionVerifier (paid, Hub executes, on `unknown` only, CRM prices/approves/ledgers). Enrichment (Hunter/Apollo, CRM, on post-dedupe uniques) is a **separate** operation that *finds* data. Invariant: no paid provider touches a duplicate or a resolved address.
- **5.5** `Campaign` is the spine; `OutreachCampaign` legacy.
- **5.6** Campaigns = CRM nav root; Hub launch tile; chat mirrors the Approval Inbox + reports, not data-editing screens.
- **5.7 Budget gate** before every paid op (warn ≥ threshold; park + `SPEND_EXCEPTION` ≥ cap); **now also enforced on actual-vs-approved overrun (§11).**
- **5.8** Providers mock by default; double gate to go live; order verifier-fix → golden-sync → hunter → apollo → mailshake.
- **5.9/5.10** Hub → CRM golden sync (pilot CSV, target API); CRM raw-ingestion path legacy; CRM `Company`/`Contact` = campaign cache of Hub golden records.
- **5.11 Chatbot = remote control, not a system of record** (§15). **5.12 Personalization = byproduct of the scan** (§13). **5.13 MV: Hub executes, CRM prices/approves/ledgers.** **5.14 Route on intent, not raw opens** (MPP inflation). **5.15 Two entry points** (§14).

## 6. The complete object model (CRM-native unless noted)

**Request & research**
- **`NicheRequest`** *(Template A — what you want)*: `id, workspaceId, createdBy, sourceChannel (telegram|slack|dashboard), sourceMessageId, voiceAssetRef?, transcript?, structuredPayload (niche, geography, serviceToPitch[], hypothesis, knownPains[]?, exclusions[], testSizeHint, budgetHint, deadline?, notes?), status (draft|confirmed|researching|briefed|cancelled), researchRunId?, confirmedAt?, createdAt`.
- **`ResearchRun`**: `id, workspaceId, nicheRequestId, campaignDraftId?, status (queued|running|completed|failed|cancelled), consoleAgentId?, progress?, nicheBriefId?, reportAssetRef?, warnings[], startedAt?, completedAt?, retryCount, callbackSecretRef`.
- **`NicheBrief`** *(Template B — what research recommends; created ONLY after research)*: the `niche-brief.json` payload (validated ICP, buyer role, confirmed pains, offer, outreach angles, audit strategy, source strategy, recommended test size, estimated cost, priority score) + `id, workspaceId, nicheRequestId, researchRunId, status (pending_approval|approved|edited|declined|superseded), approvalId, createdAt`. Reusable across campaigns.

**Campaign & execution**
- **`Campaign`**: universal parent. `id, workspaceId, nicheBriefId, hubSegmentId?, eligibilityPolicyId, budgetCapCents, spendWarnThresholdPct (default 80), overrunTolerancePct (default 20), killRuleConfig, automationLevel, status, createdBy`.
- **`CampaignStageRun`** *(the execution backbone — §11)*: `id, workspaceId, campaignId, stageType, status, estimatedCostCents, approvedCostCents, actualCostCents, estimatedRecords, inputRecords, outputRecords, provider?, providerJobId?, approvalId?, startedAt?, completedAt?, failureCode?, retryCount, reportPayload, createdAt`. `stageType ∈ {RESEARCH, HUB_SEARCH, ACQUISITION, NORMALIZATION, DEDUPLICATION, ENRICHMENT, FREE_VERIFICATION, PAID_VERIFICATION, GOLDEN_SYNC, SCAN, TIERING, PERSONALIZATION, COLD_OUTREACH, INTENT_ROUTING, FULL_AUDIT, WARM_OUTREACH, SDR_EXECUTION, REPORTING}`.
- **`CostEntry`** (extends `ProviderUsageLedger`): references `campaignId` **and `stageRunId`**; `provider, action, units, unit, unitCostCents, totalCents, status, referenceType, referenceId, metadata`.

**Approvals**
- **`Approval`** (immutable; create+decide only; §10): `id, workspaceId, campaignId?, stageRunId?, type, payloadJson, payloadSha256, status (pending|approved|declined|superseded), requestedBy, decidedBy?, decidedAt?, supersedesApprovalId?, createdAt`. Types: `NICHE_TEST, PROVIDER_RUN, ENRICHMENT_RUN, PAID_VERIFICATION, PERSONALIZATION_SAMPLES, CAMPAIGN_LAUNCH, SPEND_EXCEPTION, SCALE, REPLY_EXCEPTION, SUPPRESS_BULK, RESUME_AFTER_BREAKER`.
- **`ProviderRunProposal`** (§10): `id, stageRunId, provider, purpose, estimatedRecords, estimatedCostCents, expectedFields[], hubOverlapEstimate, expectedUniqueYield, costPerUniqueCents, fallbackProvider?, decision (approve|approve_capped|skip|replace|approve_remaining_ceiling), capRecords?, ceilingCents?`.

**Audit (factual) & assets**
- **`AuditRun`**: `id, campaignId, companyId, mode (scan|full|video), status, score?, costCents, failureCode?, startedAt, finishedAt`.
- **`AuditFinding`** *(facts only — §9.5)*: `id, auditRunId, findingCode, category, severity, title, evidenceJson, pageUrl, selector?, viewport (mobile|desktop), screenshotRef?, confidence, suggestedQuickWinCode`. `findingCode` from a closed **`FindingCatalog`**.
- **`AuditAsset`**: S3 keys for PDF, video, exec video, screenshots, preview, transcript, summary JSON, hosted-page slug.

**Personalization (§13)**
- **`PersonalizationProfile`**: current variables for a campaign lead.
- **`PersonalizationRun`**: the batch-generation job + model usage/cost.
- **`MessageTemplate`** / **`MessageTemplateVersion`**: reusable niche/angle frame + the exact approved content + merge-field structure.
- **`GeneratedMessage`**: rendered touches for one lead.
- **`CopyQaResult`**: QA failures/warnings/pass for a `GeneratedMessage`.
- **`PersonalizationSampleSet`**: the exact samples presented for Approval ⑤ (auditable).

**Engagement, eligibility, sync**
- **`EngagementEvent`**: high-volume stream (`SENT/DELIVERED/OPENED/CLICKED/REPLIED/BOUNCED/UNSUBSCRIBED/COMPLAINED/AUDIT_PAGE_VIEWED/VIDEO_PROGRESS/MEETING_BOOKED/CAMPAIGN_COMPLETED`); dedupe key `(workspaceId, provider, providerEventId, eventType)`; raw payload stored.
- **`CampaignEligibilityPolicy`** (§14): frequency caps + exclusion rules, global.
- **`HubSync`**: golden-record ingestion cursor.

*(Hub-native objects unchanged — §3.5.)*

## 7. Request → Research → Brief lifecycle (corrects the v9 contradiction)
Template A (`NicheRequest`) and Template B (`NicheBrief`) are **separate objects**; B is created **only after** research.
```
Voice/text (chat) → NicheRequest created (status: draft)
  → operator confirms Template A (status: confirmed)     [chat or dashboard]
  → CRM creates ResearchRun (queued) + POSTs to Console Agent queue (§9.1)
  → Console runs when online (status: running, progress reported)
  → Console returns NicheBrief (Template B) + report asset
  → CRM creates NicheBrief (pending_approval) + Approval(NICHE_TEST)
  → Approval ① (accept / edit-as-revision / decline)    [chat or dashboard]
  → on accept: Campaign created; brief drives acquisition
```
**No `NicheBrief` or `NICHE_TEST` exists before research completes.** A confirmed `NicheRequest` can spawn multiple campaigns; an approved `NicheBrief` can be reused (§14).

## 8. The one vertical loop
```
CHAT: voice → NicheRequest (A) → confirm
 → ResearchRun → Console Agent → NicheBrief (B) → APPROVAL ① ICP → Campaign (+eligibility, budget, kill rules)
 ── DATA (Hub-first) ──
 → StageRun HUB_SEARCH (free): overlap with corpus
 → APPROVAL ② per-provider proposals (Hub pre-check) → StageRun ACQUISITION (CRM executes → push to Hub)
 → StageRun NORMALIZATION + DEDUPLICATION (Hub, free) → unique new records
 → APPROVAL ③ enrichment proposals → StageRun ENRICHMENT (CRM, uniques only) → write back to Hub
 → StageRun FREE_VERIFICATION (Hub L1): valid/invalid(suppress)/unknown(flag)
 → APPROVAL ④ MV cost → StageRun PAID_VERIFICATION (Hub executes MV on unknown, CRM ledgers)
 → GOLDEN records → StageRun GOLDEN_SYNC → CRM under campaign (suppression re-checked)
 ── EXECUTION (CRM) ──
 → StageRun SCAN (Bot, factual findings) → StageRun TIERING (A/B/C/X)
 → StageRun PERSONALIZATION (async by tier, findingCode→phrase / LLM for A, QA) → APPROVAL ⑤ template+samples
 → APPROVAL ⑥ LAUNCH → StageRun COLD_OUTREACH (Mailshake; touch 1 no link)
 → StageRun INTENT_ROUTING (clicks/replies/page-visits) → SDR Hot Lead Workspace
 → eligible strong-intent → StageRun FULL_AUDIT (+video) → asset+page → (WARM_PENDING_ASSET) → StageRun WARM_OUTREACH
 → meeting → Opportunity → StageRun REPORTING (admin dashboard, true unit cost)
 → winning niche/angle → pre-drafted NicheRequest → more like it
 ── parallel: Entry Point B (existing Hub leads, reuse/lightweight brief, no acquisition) ──
```

## 9. Integration contracts

### 9.1 CRM → Research Console (research run) + Console Agent *(new)*
`POST {agent-queue}/api/research-runs` (bearer + HMAC):
```json
{ "researchRunId":"rr_123", "nicheRequestId":"nr_123", "campaignDraftId":"cd_123",
  "request": { "niche":"Roofing contractors", "geography":"Florida",
               "serviceToPitch":["Web development","Google Ads"], "testSizeHint":300 },
  "callbackUrl":"https://growth.syncoretech.com/api/webhooks/research-console" }
```
**Console Agent model:** the local Console can't accept inbound calls reliably (local Windows, may be off). So the CRM enqueues the run in a **durable queue**; a small **Console Agent** on the same machine **polls** for work, runs the Console when online, and posts progress + result to `callbackUrl`. Ack: `{ "researchRunId":"rr_123","status":"queued" }`. Progress: `{ status:"running", progress:0.4 }`. Completion: `{ status:"completed", nicheBrief:{…}, reportAsset:{…}, warnings:[] }` or `{ status:"failed", failureCode, detail }` (retryable). **Offline UX:** if no agent heartbeat, the bot says *"Request queued — the Research Console is currently offline; I'll start it when it's back."* Never a silent failure. (Post-pilot: move the research worker to an always-on server; the contract is unchanged.)

### 9.2 Research Console → CRM: `niche-brief.json` (Template B) *(carried)*
Returned via the callback above (or manual upload as fallback). Both sides validate: required fields/types; `priorityScore` 0–100; `decision ∈ TEST|HOLD|SKIP`; positive `recommendedTestSize`; ISO-8601 `generatedAt`; underivable fields surfaced for edit, never fabricated. Creates `NicheBrief(pending_approval)` + `Approval(NICHE_TEST)`.

### 9.3 CRM → Hub: provider-result import (automated acquisition) *(new)*
**Option B (primary):** the CRM executes the Apify/Apollo job (existing adapters) under an `ACQUISITION` stage run, then pushes results to the Hub:
`POST {hub}/api/import/provider-result` (bearer + HMAC; JSON or multipart file):
```json
{ "campaignId":"camp_1", "stageRunId":"sr_1", "provider":"apify_maps",
  "providerJobId":"apf_9", "sourceKind":"APIFY_GMAPS",
  "providerCostReference":"apf_9_cost", "contentHash":"sha256:…", "records":[ … ] }
```
Hub returns `{ importBatchId, created, duplicatesIgnored }`. **Idempotent on `contentHash`** (re-push = no-op); **partial results** allowed (a later push with more records is additive). Provider cost is an **estimate**; the actual cost returns on the provider job's completion and reconciles into the stage run (§11). **Option A (fallback):** operator downloads the export and uploads to the Hub UI — simpler, but the chat can't claim it executed extraction.

### 9.4 Chatbot ↔ CRM/Hub *(updated)*
- **Inbound:** `POST {crm}/api/chat/niche-request` creates a **`NicheRequest`** (not a brief). `POST {crm}/api/approvals/{id}/decide {decision, editReason?}` decides; **an "edit" does not mutate — it calls `/api/approvals/{id}/revise` which supersedes** (§10). All bearer-authed; the acting human resolved from the chat-identity mapping (§15) and recorded.
- **Outbound:** `POST {bot}/notify {kind, campaignId, stageRunId?, approvalId?, payload}` — approvals render as interactive buttons with **one-time button tokens**; reports render as messages. Origin allow-listed; HMAC-signed; replay-protected (timestamp + nonce).
- **Bot durable store (§15):** mapping + outbox only; no lead/campaign/approval truth.

### 9.5 CRM ↔ Audit Bot — factual scan *(updated)*
Request `{ mode:"scan"|"full"|"video", url, companyName, callbackUrl, meta:{campaignId,companyId,auditRunId,stageRunId} }`, `Authorization: Bearer <AUDIT_BOT_TOKEN>`. **Scan callback returns facts only** (no marketing language), signed `X-Syncore-Signature`:
```json
{ "auditRunId":"a1","status":"done","mode":"scan","score":64,
  "findings":[ { "findingCode":"MOBILE_CTA_BELOW_FOLD","category":"conversion","severity":"high",
                 "title":"Primary CTA below the fold on mobile",
                 "evidence":{ "viewport":"mobile","ctaText":"Request an Estimate","verticalPositionPx":1140 },
                 "pageUrl":"…","selector":"a.cta","confidence":0.92,"suggestedQuickWinCode":"CTA_ABOVE_FOLD_MOBILE" } ],
  "costCents":4, "failureCode":null, "meta":{…} }
```
The CRM stores each as an `AuditFinding`; the **personalization worker** turns codes into wording (§13). `mode=full`/`video` may add AI narrative + assets (that's the pipeline's `ai` stage, not scan). CRM mirrors `/api/webhooks/email` (verify, resolve workspace from signed meta, dedupe by `auditRunId`+finding, dead-letter). Bot callback origin allow-listed.

### 9.6 Lead Hub ↔ Email Verifier (L1) *(carried — G3 fix)*
Only the Hub calls the verifier. Retarget `/api/verify` → **`POST /batches`** `{emails, callback_url, meta}` → `202`; verify the completion webhook's `X-Syncore-Signature` + dedupe `(batch_id,email)`; send bearer; map to `ContactEmail.status`; `invalid → Suppression(EMAIL)`; **never `unknown → invalid`**.

### 9.7 CRM → Hub: authorize MillionVerifier *(carried)*
After Approval ④: `POST {hub}/api/verify/millionverifier {contactEmailIds[], campaignId, stageRunId, estimatedCostCents}`; Hub runs MV on the unresolved set, stores results (survivorship vs prior L1), returns `{ resolved:{valid,invalid,risky,stillUnknown}, actualCostCents }` to `POST {crm}/api/webhooks/hub-verify-result`. **CRM writes the `CostEntry` against the stage run.**

### 9.8 CRM → Mailshake (cold + warm) *(carried)*
Export fields incl. `email, first_name, last_name, company_name, website, city, custom_audit_teaser, custom_angle, custom_pain, audit_page_url?, crm_contact_id, crm_company_id, hub_contact_id, campaign_id`. No link in touch 1; suppression re-checked at export; approved-copy hash matches export. Events (poll 10–15 min, CSV fallback) → idempotent `EngagementEvent`; unsubscribe/bounce/complaint → `SuppressionRecord` + reconcile to Hub. **Warm** reuses this with `audit_page_url` set (only after WARM_PENDING_ASSET clears).

### 9.9 Lead Hub → CRM: golden-record sync *(carried)*
Golden shape carries `hubContactId/hubCompanyId`, identity, `emailStatus/emailVerifiedAt`, phone, firmographics, `mcDot/placeId`, `industryTags`, `qualityScore`, `provenanceSummary`, `sourceKinds`, `mergeCount`, `suppressed`. Pilot CSV import; target API pull/push idempotent on `hubContactId`; suppression reconciled both ways.

## 10. Approval & spend-control model *(new/expanded)*

**Gates (each a single `Approval`, actionable from chat *and* dashboard on the same row):** ① `NICHE_TEST` (ICP) · ② `PROVIDER_RUN` (acquisition) · ③ `ENRICHMENT_RUN` · ④ `PAID_VERIFICATION` (MV) · ⑤ `PERSONALIZATION_SAMPLES` · ⑥ `CAMPAIGN_LAUNCH` · plus `SPEND_EXCEPTION`, `SCALE`, `REPLY_EXCEPTION`, `SUPPRESS_BULK`, `RESUME_AFTER_BREAKER`.

**Per-provider proposals (② and ③).** A waterfall level may bundle several providers (Apify GMaps, Apollo search, directory, CSV). Each is a **`ProviderRunProposal`** showing provider, purpose, estimated records, estimated cost, expected fields, **existing-Hub overlap** (from a **Hub dry-run dedup pre-check**), **expected unique yield**, **cost-per-expected-unique**, and a fallback. You may **approve** / **approve capped to N records** / **skip** / **replace provider** / **approve the remaining waterfall within a fixed ceiling** (anti-fatigue). The Hub pre-check is what makes unique-yield and cost-per-unique real numbers — and ties approvals to the Hub-first principle.

**Editing = revision, never mutation.** "Edit" on any approval calls `/revise`: the original is set `status: SUPERSEDED`; a new `Approval` is created with `supersedesApprovalId`, the edited payload, and a **new SHA-256**. Audit history stays trustworthy; the approved object always matches its hash.

**Thresholds & two-person.** `CampaignEligibilityPolicy`/workspace config sets spend thresholds: below `T1` any authorized approver; above `T2` **two-person approval** (a second distinct approver must confirm). Buttons carry **one-time tokens** (consumed on decide; replayed taps show the final state).

**Estimate ↔ actual reconciliation (extension).** Every paid stage records `estimated/approved/actual`. On completion, if `actual > approved × (1 + overrunTolerancePct)`, the stage **auto-parks** and opens a `SPEND_EXCEPTION` (approve the overrun or stop). This protects the budget cap from usage-based estimate error (Apify/enrichment).

## 11. `CampaignStageRun` — the execution backbone *(new)*
One durable record per pipeline stage (§6). It is the single source for the **admin dashboard, chatbot status, cost reports, retries, progress %, bottleneck view, and historical reconstruction** — responsibilities previously scattered across approvals, provider jobs, Hub imports, audits, and events.

**State machine:** `PENDING → AWAITING_APPROVAL → APPROVED → RUNNING → (COMPLETED | FAILED | PARKED | CANCELLED)`. `PARKED` = budget/overrun/breaker hold awaiting an approval; `FAILED` carries `failureCode` + `retryCount`; retries are idempotent. **Progress %** = completed stage runs / total planned stage runs for the campaign. `CostEntry.stageRunId` and `Approval.stageRunId` reference it (no data duplication). The bot's status command renders the campaign's stage runs as a checklist with per-stage cost + counts.

## 12. End-to-end process (stage detail)
*(Stages 0–20; each real stage is a `CampaignStageRun`. Only the v9.1-changed stages are detailed; others as v9.)*
- **Stage 1–3 (request/research/ICP):** §7 lifecycle; ICP approval ① supports edit-as-revision.
- **Stage 4 HUB_SEARCH (free):** dry-run overlap with the corpus → the gap.
- **Stage 5 ACQUISITION:** Approval ② per-provider proposals → CRM executes → **push to Hub (§9.3)**; raw stored immediately; actual cost reconciled (§11).
- **Stage 6 NORMALIZATION + DEDUPLICATION (Hub, free):** collapse intra-batch + against the corpus; merge-rate reported.
- **Stage 7 ENRICHMENT:** Approval ③ → CRM enriches **uniques missing fields only** → write back to Hub.
- **Stage 8 FREE_VERIFICATION (Hub L1).** **Stage 9 PAID_VERIFICATION:** Approval ④ → Hub runs MV on `unknown` only.
- **Stage 10 GOLDEN_SYNC → CRM** under the campaign (suppression re-checked).
- **Stage 11 SCAN (factual):** `mode=scan` → `AuditFinding`s (codes + evidence, **no wording**) → `websiteWeakness`; 30-day cache.
- **Stage 12 TIERING:** fit + contact quality (Hub score + verification) + measured weakness → A/B/C/X with reasons.
- **Stage 13 PERSONALIZATION (async, by tier):** fill `PersonalizationProfile` from findings; **Tier B/C map `findingCode → phrase` deterministically (no LLM)**; **Tier A** uses a cloud model to weave the specific finding + angle; `CopyQaResult` gates; spin syntax. **Approval ⑤** on `PersonalizationSampleSet` (template + samples).
- **Stage 14 LAUNCH:** Approval ⑥ after the pre-launch checklist (warmup, suppression Hub+CRM, seed-inbox test, touch-1 link-free, budget+kill rules, copy hash).
- **Stage 15 COLD_OUTREACH (Mailshake):** touch 1 no link → `EngagementEvent`. Kill rules: bounce > 3% / complaint > 0.1% / unsubscribe > 2% → auto-pause + `RESUME_AFTER_BREAKER`; source invalid-rate > 20% → park + flag Hub source.
- **Stage 16 INTENT_ROUTING (intent, not opens):**

  | Signal | Strength | Action |
  |---|---|---|
  | Single open | weak (MPP-inflated) | small score bump; **no routing** |
  | Repeated opens | moderate | warm SDR queue |
  | **Meaningful** click | strong | SDR follow-up; **audit-eligibility check** |
  | Audit-page visit | strong | notify SDR |
  | Video-watch | very strong | immediate SDR |
  | Positive reply | very strong | immediate SDR + brief |
  | Explicit audit request | very strong | **qualify full audit** |
  | Angry/legal | — | global suppress (Hub+CRM) + escalate |

  **"Meaningful click"** excludes: known scanner/link-checker user-agents, bot-fast clicks (< a few seconds after delivery), and clicks on the unsubscribe link. Security gateways pre-click links, so a raw click is not intent.

- **Stage 17 FULL_AUDIT + WARM_OUTREACH (tightened eligibility + fixed sequencing):**
  **Audit eligibility.** *Always qualify:* positive reply, explicit audit request, SDR-qualified opportunity, named strategic account. *Conditionally:* Tier A + meaningful click / repeated engagement / audit-page interest. *Never alone:* single open, single unconfirmed low-tier click.
  **Sequencing (fixes the v9 ordering bug).** Strong engagement → eligibility check → `AUDIT_BATCH`/create `FULL_AUDIT` → **wait** (`WARM_CAMPAIGN_PENDING_ASSET`) for the audit + hosted page to complete + **QA** → only then enroll in the warm Mailshake campaign (`audit_page_url` set). For immediate follow-up, an SDR sends a **non-asset** message first; the audit follows when ready. `video` only for very-strong intent + Tier A.
- **Stage 18 SDR_EXECUTION:** Hot Lead Workspace (contact, company, audit proof, talking points, thread, next action, Cal.com link); calls + follow-ups logged.
- **Stage 19 meeting → Opportunity. Stage 20 REPORTING:** admin dashboard (full funnel from the stage runs), true unit costs, kill-rule evaluator, `SCALE`, Niche Board + winning templates, post-mortem → Console, winning angle → pre-drafted `NicheRequest`.

## 13. Personalization pipeline *(concrete)*
**Principle:** the scan is the signal; no re-crawl. `AuditFinding`s (facts) → wording by the personalization worker.
**Objects:** `PersonalizationProfile` (current vars), `PersonalizationRun` (batch job + model/cost), `MessageTemplate`/`MessageTemplateVersion` (frame + approved content + merge fields), `GeneratedMessage` (rendered touches), `CopyQaResult` (QA), `PersonalizationSampleSet` (samples approved at ⑤).
**Variable sources:** identity/firmographics from the Hub golden record + Haiku tags; `niche_pain`/`chosen_angle` from the `NicheBrief`; `audit_observation`/`quick_win` **derived from `findingCode` + evidence** — never invented by the Audit Bot.
**Tiered depth:** **A** = LLM weaves the specific finding + angle (cloud). **B** = `findingCode → phrase` (a per-code copy template) + niche/role/city/company (local Ollama or pure templating). **C** = template + merge tags, **no per-lead LLM**. Reuses CRM A/B/C/X.
**Deterministic map (extension):** each `findingCode` has a phrase template in `FindingCatalog` (e.g. `MOBILE_CTA_BELOW_FOLD → "Your {ctaText} button sits below the first mobile screen"`), so B/C personalization is deterministic and QA-checkable; only A needs a model.
**Flow:** async batch fills profiles between "list ready" and "launch"; you approve **template + samples**, not 300 emails. Cold (touches 1–3): cheap signal, **touch 1 no link**. Warm: full asset (after WARM_PENDING_ASSET). QA = the Console's `phase-0-safety-trust` checks; **spin syntax** for send variation.
**Where it runs:** repurpose the Console email writer as a **scan-fed batch microservice** (no re-crawl) first; migrate to a CRM personalization worker later.

## 14. Entry Point B — existing-Hub campaigns *(new detail)*
Skipping acquisition is right; skipping **all** research is not — a campaign still needs offer, pain, role, segmentation, angle, template, audit policy. **Three brief modes:** (1) full new niche research; (2) **reuse a previously approved `NicheBrief`**; (3) **lightweight operator-defined brief** (a minimal `NicheBrief` filled by hand). Then: segment Hub golden records → **eligibility filter** → re-verify > 90 days (free → MV on unresolved, priced/approved) → personalize → launch.
**`CampaignEligibilityPolicy` (global — both entry points, checked at every list-build):** suppression status, verification age, **active campaign membership (one active cold campaign per contact)**, prior campaign history, last-contacted date, prior negative/positive reply, existing opportunity, existing-client status, **account-level & domain-level frequency caps**, assigned-SDR ownership, geographic/service exclusions. A lead never enters two cold campaigns at once just because it matches two segments.

## 15. Chatbot layer *(platform-neutral, Telegram-first)*
**Remote control, not a system of record.** One `Approval` object, two surfaces; either decides it; the dashboard is authoritative if the bot is down (bot down ≠ pipeline blocked).
**Voice in:** transcribe (Whisper/STT) → map to `NicheRequest` (Template A) → ask follow-ups for missing required fields → operator confirms.
**Permissions:** `chat user → CRM user → workspace → role/permission`. Owner: all gates. Manager: launches under a spend cap. Data specialist: merge decisions, not launches. SDR: no provider spend. Developer: retry technical stages, not outreach. Enforced server-side on every decide.
**Security:** allow-listed chat IDs; signed callbacks; replay protection (timestamp + nonce); **one-time button tokens**; spend thresholds; **two-person approval above `T2`**.
**Durable store (minimal):** chat/thread/message IDs, user↔CRM mapping, campaign↔approval-message mapping, delivery attempts, notification dedup, outbox/retry — **no lead/campaign/approval truth.** Survives restarts (keeps thread context).
**Availability UX:** Console offline → *"queued; I'll start it when it's back"* + a notice when it resumes. **Platform-neutral interface** so Slack is added later without a rewrite; **Telegram first** (voice UX, single operator, existing Console notify hook).

## 16. Automation & HITL
Level B (approved envelope + probation). Automated inside envelopes: Hub search/ingest/normalize/dedupe/free-verify/tag/score/export; CRM scan, tiering, async personalization, event ingestion, intent routing, reporting; stage-run orchestration. Human approvals (chat + dashboard): ① ICP · ② acquisition (per-provider) · ③ enrichment · ④ MV · ⑤ template+samples · ⑥ launch · plus `SPEND_EXCEPTION`, `SCALE`, `REPLY_EXCEPTION`, `SUPPRESS_BULK`, `RESUME_AFTER_BREAKER`, Hub fuzzy-merge. Exceptions-only escalation.

## 17. Deliverability & compliance *(carried + frequency caps)*
Lookalike domains for cold; `syncoretech.com` transactional/warm only. Verify Mailshake native warmup before relying on it, else manual ramp. DNS preflight (SPF/DKIM/DMARC/MX) at Stage 0 + pre-launch. Seed-inbox test on Gmail/Outlook/Yahoo. Global suppression (Hub+CRM) + **`CampaignEligibilityPolicy` frequency caps** block over-contact. US-only pilot.

## 18. System architecture & deployment
```
Chatbot (Telegram, platform-neutral) ── voice/approvals/reports ──> CRM/Hub APIs
Console Agent (local, polls durable queue) ── runs Console when online ──> CRM callbacks
Research Console (local Windows, C:\research, Ollama) — niche research
Lead Hub  → lead-data SoR: S3 vault, search, normalize/resolve/dedupe, ALL verification
            (Email Verifier L1 + MillionVerifier), Haiku tags, quality score, golden export
Lead Engine CRM → campaign control plane: NicheRequest/ResearchRun/Campaign/CampaignStageRun,
            approvals (chat+dashboard), cost ledger + budget gate, paid ENRICHMENT (Hunter/Apollo),
            scoring/tiering, PERSONALIZATION, Mailshake export/sync, SES triggers, SDR, admin dashboard
Email Verifier → Go, free L1, bearer, loopback, HMAC callback → Hub
Audit Bot → scan(factual)/full/video; S3 assets; HMAC callback → allow-listed CRM origin
Mailshake → cold + warm; events → CRM
AWS SES → transactional/system/warm
S3 → audit assets + Hub raw vault (private); CRM proxies presentation
```
| Component | Deployment |
|---|---|
| CRM app + DB | AWS EC2 (t4g) + RDS Postgres, us-east-1 |
| CRM worker | EC2 (systemd `syncore-worker`) |
| Lead Hub app+worker+DB | Own compose: web + worker + `postgres:16` + `redis:7`; S3 vault; same VPC as CRM/verifier |
| Email Verifier | Co-located Go (systemd); bearer; loopback; port 25 blocked → mostly `unknown` |
| Audit Bot | Linux VPS, PM2, API+worker; SQLite queue |
| Chatbot | Small Node service (Telegram); minimal durable mapping/outbox store |
| Console Agent | Local Windows service alongside the Console; polls the CRM queue |
| S3 | audit assets + Hub vault, private |
| Cold + warm | Mailshake · Transactional: SES · Console: local Windows |

## 19. Reliability, observability & DR
Every stage run idempotent; retryable-vs-terminal via `failureCode`; PARKED for holds; dead-letter for callbacks; breakers pause campaigns. Bot stateless-ish (durable mapping only); a missed notify is retried; approvals valid in the dashboard regardless of bot uptime; **Console-offline is a state, not a crash.** Observability: CRM `/api/growth/health` + **stage-run dashboards** + Hub queue/verify-callback health + CloudWatch. DR: PITR on both DBs + S3 versioning (assets+vault) + restore drills; forward-fix + PITR for persistence.

## 20. Dashboards & roles
Owner/Manager (CRM+chat): campaign list, Approval Inbox (mirrored), spend-vs-cap, tiers, deliverability, funnel, unit costs, scale/stop. Data Specialist (Hub): imports, batch funnel, merge review, segments, suppression, export. SDR (CRM): Hot Lead Workspace. **Admin dashboard (CRM):** the complete start→end record **built from `CampaignStageRun`** — request, ICP, per-stage cost (estimated/approved/actual), record counts, engagement, SDR calls, meetings, unit economics, progress %, bottlenecks. Developer: CRM+Hub health, dead-letter, cost ledger.

## 21. Cost model
Ask once · research once · **acquire only the gap** · store once · **dedupe before spending** · enrich uniques only · **free-verify before paying** · MV only on unresolved · **personalize from the scan** · scan cheaply · full audit/video on real intent only · frequency-cap contacts · scale only when cost-per-meeting is acceptable. All spend via `ProviderUsageLedger` behind the budget gate + overrun reconciliation. Metrics: cost per verified contact, cost per meeting, **Hunter/MV-avoided**, **merge rate**. *(Dedupe-before-spend saves little on campaign #1 of a new niche; it compounds and powers Entry Point B.)*

## 22. Revised build order (G0–G8)
- **G0 — Infra & deliverability + bot skeleton.** Domains/warmup; Hub infra (PG16+Redis+vault); S3; secrets (incl. MillionVerifier + verifier token/webhook key); **Telegram bot skeleton (one round-trip)**; backups + restore drills; health checks.
- **G1 — Campaign & orchestration spine.** `NicheRequest`, `ResearchRun`, `Campaign`, `CampaignStageRun`, `Approval` (+revisions), `CostEntry`; Approval Inbox; **chat identity mapping + Telegram notification/approval round-trip**; CI projection-invariant check; `CLAUDE.md` per repo.
- **G2 — Research loop (prove the entry point first).** Voice → Template A → confirm → `ResearchRun` → **Console Agent** → Template B → ICP approval. *(Before provider integrations — it proves the real user entry point.)*
- **G3 — Hub & verification.** Fix verifier bridge (`/batches`+bearer+callback HMAC); Hub search; golden records; **MV authorize**; CRM golden sync.
- **G4 — Acquisition & enrichment waterfall.** **Per-provider proposals + Hub overlap pre-check**; cost estimates; per-level approvals; provider jobs; **result push to Hub (§9.3)**; **actual-cost settlement (§11)**.
- **G5 — Scan & tiering.** `mode=scan` + M2M bearer + meta echo; **factual `AuditFinding`s + `FindingCatalog`**; A/B/C/X; cache.
- **G6 — Personalization & Mailshake (cold).** Personalization tables; tiered generation (`findingCode→phrase` for B/C, LLM for A); QA; `PersonalizationSampleSet`; launch approval; cold sequence; event ingestion; spin.
- **G7 — Intent, full audits & SDR.** Intent scoring (meaningful-click filter); **audit eligibility**; full PDF/video; **WARM_PENDING_ASSET** → warm campaign; Hot Lead Workspace.
- **G8 — Admin dashboard & learning loop.** Full funnel from stage runs; true unit costs; **Entry Point B (three brief modes + eligibility policy)**; winning-template library; scale recs; post-mortem → Console.
**Acceptance highlights:** every approval actionable from chat+dashboard on one row; a voice note produces a valid `NicheRequest`; no `NicheBrief` before research; every paid stage reconciles actual-vs-approved; scan invents no wording; a warm campaign never enrolls before its asset exists; no contact in two active cold campaigns.

## 23. Security & privacy hardening
Bearer + constant-time for all M2M (bot, Console Agent, audit bot, verifier, Hub↔CRM sync, MV authorize, provider-result); HMAC raw-body verification + replay protection on every callback; origin allow-lists; AES-256-GCM vault; **chat permission checks server-side**; one-time button tokens; two-person approval above threshold; object-level authorization tests; private S3; hosted audit pages (unguessable slug, expiry, revoke, access logs, rate limit, proxied presigned GETs); no raw S3 links in outreach; suppression reconciled Hub↔CRM; prod secret guards; verifier refuses non-loopback bind without a token; the bot stores no lead/campaign/approval truth; rotate seeded creds at G0.

## 24. Risks & mitigations *(new/updated)*
| Risk | Impact | Mitigation |
|---|---|---|
| Template A stored as a brief | High | **`NicheRequest` distinct; `NicheBrief` only post-research (§7)** |
| No automated chat→research | High | **CRM→Console `ResearchRun` contract + Console Agent (§9.1)** |
| Local Console offline | Medium | **Durable queue + polling agent + graceful bot notice** |
| No unified execution/cost view | Medium | **`CampaignStageRun` backbone (§11)** |
| Acquisition handoff unresolved | Medium | **Provider-result→Hub contract (§9.3); Option A fallback** |
| Approval bundling / fatigue | Medium | **Per-provider proposals + approve-remaining-within-ceiling (§10)** |
| Edit breaks approval immutability | High | **Edit = revision (SUPERSEDED + new hash)** |
| Usage-based cost overrun vs cap | Medium | **Estimate↔actual reconciliation; auto-park + SPEND_EXCEPTION** |
| Bot loses context on restart | Medium | **Minimal durable mapping/outbox store** |
| Unauthorized chat approvals | High | **Chat permissions, one-time tokens, replay protection, two-person for large spend** |
| Scan inventing marketing claims | Medium | **Factual `AuditFinding`s; wording in the personalization layer + QA** |
| Warm enrollment before asset exists | Medium | **`WARM_CAMPAIGN_PENDING_ASSET` gate** |
| Expensive audit on a bot click | Medium | **Meaningful-click filter + tightened eligibility** |
| Over-contacting / two campaigns at once | Medium | **`CampaignEligibilityPolicy` (frequency caps, one active cold campaign)** |
| Paying to enrich/verify duplicates | Medium | Hub-first + dedupe-before-spend; enrich uniques; MV on unresolved |
| Blob OOM/ceiling | High | CRM native-only; diff projection; lead data in Hub |
| Deliverability damage | High | Lookalike domains, warmup, no touch-1 link, seed test, breakers, spin |
| Hub verifier bridge broken | High | G3 fix (`/batches`+bearer+HMAC) |

## 25. Pilot campaign (default)
Dump Truck Rentals / Texas · owner-operators · Meta Ads + landing + tracking / local lead-capture audit · 300 companies / **$85** cap · 14-day window · 30–40 Tier-A full audits / video on strong intent only · goal 5 replies, 1–2 meetings · Level B. Maps to **Beast Haulers** (McKinney, TX); the Hub's MC/DOT resolution fits the vertical.

## 26. Developer hard rules
1. `Campaign` is the universal parent; orphan work is a bug. **Every real stage is a `CampaignStageRun`.**
2. Hub owns lead data + all verification; CRM owns spend + execution. Don't ingest/normalize/dedupe/verify raw leads in the CRM.
3. **`NicheRequest` (A) ≠ `NicheBrief` (B).** No brief/`NICHE_TEST` before research completes.
4. Extend, don't rebuild (CRM features or the Hub pipeline). CRM Growth OS models Prisma-native, never in the blob (CI-enforced).
5. Every paid action writes `CostEntry` with `campaignId` **and `stageRunId`** through the one CRM ledger; reconcile actual-vs-approved.
6. Only the Hub calls the Email Verifier; only the Hub runs MillionVerifier (CRM authorizes/ledgers). CRM trusts Hub `emailStatus`.
7. Hub-first, dedupe-before-spend: search → acquire gap (raw to Hub immediately, §9.3) → dedupe → enrich uniques → free-verify → MV on unresolved → golden → CRM.
8. Personalization reuses the scan; never re-crawl. Depth by tier; Tier-C no per-lead LLM; **scan returns facts, wording is the personalization worker's job.**
9. Route on **intent** (meaningful clicks/replies/page-visits), not raw opens. Full PDFs/videos on real intent + eligibility only. **Never enroll a warm campaign before its asset exists (WARM_PENDING_ASSET).**
10. Audit Bot supports `scan/full/video`; `scan` never calls OpenAI/PDF/voice/video and invents no copy.
11. No link in automated cold touch 1. Mailshake = cold+warm; SES = transactional/warm; Hub = data+verification.
12. **Chatbot is a remote control.** One `Approval` object, two surfaces. **Editing an approval creates a revision, never mutates.** Enforce chat permissions + thresholds server-side.
13. Approvals immutable (payload + SHA-256; create+decide+revise only). Webhooks/callbacks/sync/bot signed, verified, idempotent, replay-protected, dead-lettered; identity from signed data; allow-listed origins.
14. Per-provider approvals show Hub overlap + unique yield + cost-per-unique (from a Hub pre-check).
15. `CampaignEligibilityPolicy` applies to **both** entry points; existing-Hub campaigns still need a brief (reuse/lightweight).
16. Never cold-send from `syncoretech.com`; no heavy infra in the CRM before a proven blocker; providers mock by default; every paid call passes the budget gate first.
17. `OutreachCampaign` + the CRM raw-ingestion path are legacy. Fix the Hub verifier bridge before relying on verification.

## 27. Claude Code operating model
One repo per window (five) + two thin services. Each session: read inventory (+ §3) → phase-scoped plan → approval → small commits → typecheck/lint/test each step → `/clear`. `CLAUDE.md` per repo; CI per repo (CRM adds the projection-invariant check; Hub adds normalize/resolve + verifier-bridge smoke). Build order per §22 — **prove the entry point (G1–G2) before providers.**

## 28. Definition of done (pilot validated)
From a voice note, Syncore structured a `NicheRequest`, auto-ran research (or gracefully queued it while the Console was offline), approved the ICP from chat or dashboard, searched what it already owns, acquired only the gap and stored it immediately, deduped before spending, enriched only uniques, verified free-first with a paid fallback only on the unresolved, produced clean golden records once, personalized from the audit's factual findings (no second crawl) at a depth matching each lead's value, launched link-free warmed outreach with contacts frequency-capped, routed real intent (not phantom opens) to SDRs, generated full audit proof + video only for eligible high-intent leads (never enrolling a warm campaign before its asset existed), tracked every stage and its true cost in one `CampaignStageRun` timeline on the admin dashboard, fed winners back into research, and kept verified data for the next campaign at zero re-acquisition cost — with every money/reputation/strategy decision approvable from anywhere and every edit preserved as an immutable revision. **Validation is meetings + unit economics, not feature count.**

## 29. What "complete" looks like
A single closed, cost-instrumented outbound machine of five services + a chat control surface + a Console bridge, each authoritative for one thing, every stage a durable record. You speak a niche; the machine researches it (or tells you it's queued), checks what Syncore already owns, buys only the gap, cleans and verifies it once, personalizes from the audit it was already running, sends warmed link-free outreach within frequency caps, routes genuine intent to SDRs, spends expensive audit video only on real opportunities, and reports true unit economics from one stage-run timeline — asking your approval, from wherever you are, only where money/reputation/strategy/ambiguous identity are at stake, and preserving every edit as a revision. Every lead collected is owned forever, already clean, ready for the next niche.

## 30. How it works exactly *(pilot: Dump Truck Rentals / TX / Beast Haulers)*
1. **Chat:** voice note → `NicheRequest` (A); bot asks "exclude existing clients?"; you confirm.
2. **Research:** CRM creates `ResearchRun`; the **Console Agent** picks it up (or the bot says "queued, Console offline"); the Console returns `NicheBrief` (B, `priorityScore` 82).
3. **Approval ①:** approve (or edit-as-revision) → `Campaign` (eligibility policy, `$85` cap, kill rules).
4. **HUB_SEARCH:** corpus empty (new niche) → 100% gap.
5. **Approval ②:** per-provider proposals (Apify GMaps: ~300 records, est. $X, **Hub overlap 0%, unique yield ~300, cost/unique ¢**; Apollo: contacts). Approve within a ceiling → **CRM runs the jobs → pushes results to the Hub (§9.3)**; raw vaulted; actual cost reconciled.
6. **NORMALIZE+DEDUP:** Apollo owner + GMaps Beast Haulers → one golden company; a fuzzy Dallas match → review; ~300→~250; merge-rate ~17%.
7. **Approval ③:** enrich uniques missing an email (Hunter) → write back to Hub.
8. **FREE_VERIFY:** `jordan@beasthaulers.com`→VALID; a few INVALID→Hub-suppressed (no paid spend); rest `unknown`.
9. **Approval ④:** MV on `unknown` only → Hub stores results → CRM writes the `CostEntry`; bot reports valid/invalid + $ + paid-verify-avoided.
10. **GOLDEN_SYNC:** golden segment → CRM under the campaign (suppression re-checked); each lead → `hubContactId`.
11. **SCAN (factual):** Beast Haulers → `AuditFinding{ MOBILE_CTA_BELOW_FOLD, evidence:{viewport:mobile, ctaText:"Request an Estimate", verticalPositionPx:1140} }`, score 64. **No wording from the bot.**
12. **TIERING:** valid owner email + high weakness + fit → Tier A.
13. **PERSONALIZATION:** Tier-A LLM weaves the CTA finding + the lead-capture angle; Tier-B/C map `findingCode→phrase`; QA passes; spin. **Approval ⑤:** template + 3 samples.
14. **Approval ⑥ LAUNCH:** checklist green → Mailshake cold send; touch 1 (no link): "Your Request-an-Estimate button sits below the first mobile screen — likely costing inbound."
15. **INTENT_ROUTING:** opens bump score only; a **meaningful click** + a reply from Beast Haulers → immediate SDR + **audit eligibility = qualified**.
16. **FULL_AUDIT → WARM:** create full audit (+video, Tier-A strong intent) → **WARM_PENDING_ASSET** until the page + QA are done → warm Mailshake campaign with `audit_page_url`; SDR works it from the Hot Lead Workspace; meeting → `Opportunity`.
17. **REPORTING:** the admin dashboard shows every `CampaignStageRun` with estimated/approved/actual cost + counts; true unit costs (cost-per-verified-contact, paid-verify-avoided, merge-rate, cost-per-meeting); the winning angle → a pre-drafted `NicheRequest`; the ~250 golden companies stay in the Hub for the next niche at zero re-acquisition cost.

## 31. Repo-plan errata
- **`syncore-lead-hub`:** lead-data + all-verification SoR. Add: verifier-bridge fix (`/batches`+bearer+callback HMAC); **MV execution + CRM authorize contract**; **provider-result import (§9.3)**; `GoldenRecord` export; **Hub search + dry-run overlap pre-check API**; fuzzy-merge review.
- **`lead-engine-crm`:** add `NicheRequest`/`ResearchRun`/`CampaignStageRun`/`ProviderRunProposal`/`AuditFinding`/`CampaignEligibilityPolicy` + personalization tables (Prisma-native); raw ingestion legacy; no verifier adapter; MV authorized/ledgered here (executed in Hub); Hunter/Apollo = wiring + gating on uniques with **per-provider proposals**; **research-run + provider-result + chatbot contracts**; **approval revisions**; budget gate + overrun reconciliation; IA change + Hub tile; CI invariant check.
- **`syncore-email-verifier`:** env `SYNCORE_VERIFIER_*`; batch endpoints exist; remaining = bearer-on-by-default for the Hub caller + batch `WriteTimeout` bound.
- **`syncore-audit-bot`:** callback-origin allow-list + `costCents`; explicit `scan/full/video`; **`scan` returns factual `AuditFinding`s from a `FindingCatalog`, no wording, no AI**; scan-never-touches-AI test.
- **`syncore-research-console`:** add `niche-brief.json` export (Template B) + **`ResearchRun` inbound via the Console Agent** + post-mortem import; **repurpose the email writer as a scan-fed batch microservice (no re-crawl)**; the `phase-0-safety-trust` QA becomes the personalization QA gate.
- **New services:** **Chatbot** (thin bridge; minimal durable mapping store; permissions; Telegram-first, platform-neutral) and **Console Agent** (polls the CRM research queue; runs the local Console; returns progress/result).

## 32. Post-pilot roadmap
1. Hub→CRM **API sync** (replace CSV) + CRM→Hub **enrichment write-back**. 2. **Blob retirement** (smaller now) with drift audit + forward-fix/PITR + `workspaces[0]` fix. 3. **Move the research worker to an always-on server** (retire the offline caveat; contract unchanged). 4. **Unify paid execution** (enrichment into the Hub, or all provider execution behind the CRM framework) to remove the enrichment/verification asymmetry. 5. **Port-25 verifier host.** 6. **Scheduled Apify sourcing** (beyond on-demand). 7. **EngagementEvent retention/archival.** 8. **SES cold decision** vs Mailshake; Smartlead only if Mailshake blocks scale. 9. **Phone waterfall** (RingCentral/Twilio Lookup; Hub phone verification). 10. **Slack** (multi-approver, department channels) behind the platform-neutral interface. 11. **Personalization learning** — feed reply/meeting outcomes back to rank templates/angles per niche. 12. **DB-level approval immutability**; observability re-evaluation only on a real gap.

_Syncore Growth OS — Unified End-to-End Plan v9.1 · Internal Use Only · Verified against five repo snapshots 2026-07-24 · Supersedes v9.0. Chat drives it; a stage-run timeline records it; the Hub owns and verifies the data; the CRM spends and executes; the scan supplies facts and the personalization layer supplies words; spend only on what you don't already own; approve from anywhere and keep every edit as a revision._
