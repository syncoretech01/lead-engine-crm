# Syncore Growth OS — Execution Roadmap

**How to build it: what's new, where everything lives, and the order of work.**
*Companion to Plan v9.1. This is the "what do I do Monday morning" document.*

---

## 1. The repo map (7 repos when complete)

| Repo | Status | Role | Share of build |
|---|---|---|---|
| `lead-engine-crm` | Exists | Campaign control plane, spending, execution, dashboards | **~60%** |
| `syncore-lead-hub` | Exists | Lead data, dedupe, all verification | ~15% |
| `syncore-audit-bot` | Exists | Website evidence, PDF, video | ~8% |
| `syncore-research-console` | Exists | Research, ICP, + **Console Agent** | ~5% |
| `syncore-email-verifier` | Exists | Free L1 verification | ~2% |
| `syncore-contracts` | **NEW** | Shared types and schemas for every cross-service contract | ~3% |
| `syncore-growth-bot` | **NEW** | Telegram control surface | ~7% |

### Where the new pieces go and why

**`syncore-contracts` — new repo.** Every service depends on it, so it can't live inside any one of them. Contains: the verification status enum (currently hand-duplicated in three places), the golden record shape, the `FindingCatalog` codes and evidence schemas, and every webhook payload (research-run, provider-result, MV authorize, hub-verify-result, audit callback, chat notify). Published as a versioned npm package; the Go verifier keeps a small mirror with a conformance test.
*This exists specifically because contract drift already bit you once — the Hub posting to `/api/verify`, a route the verifier doesn't expose.*

**`syncore-growth-bot` — new repo.** Own runtime, own deploy cadence, thin by design. Keeping it separate physically reinforces that it's a remote control and not a second system of record. Build behind a platform-neutral interface so Slack can be added later without a rewrite.

**Console Agent — inside `syncore-research-console` (`/agent`).** It deploys to the same Windows machine as the Console, versions with it, and needs to know how to invoke it. A separate repo would add ceremony for no benefit. Low-stakes either way.

**Personalization worker — inside `lead-engine-crm`.**
*This revises Plan v9.1 §13, which suggested repurposing the Console's email writer as a remote service.* Personalization is an **inline pipeline stage** between "list ready" and "launch." The Console runs on a local machine that may be off — acceptable for research (occasional, human-initiated, delay-tolerant, which is why the Agent queue works) but not for a stage that blocks campaigns. It also has data gravity in the CRM: it needs audit findings, tier, and brief angles, and its Tier-A model calls need the cost ledger.
**Reuse the Console's writing logic and QA rules by porting the code, not by calling it remotely.**

**`FindingCatalog` — split.** The finding *codes* and evidence *schemas* go in `syncore-contracts` (the Audit Bot emits them, the CRM consumes them). The *phrase templates* that turn codes into sentences go in the CRM — they're copy, they change often, and they're campaign-tunable.

### Infrastructure (not repos, but real work)
Hub Docker stack host (Postgres 16 + Redis + worker) · S3 raw-vault bucket · bot host · secrets vaulted (Hunter, Apollo, Apify, Mailshake, MillionVerifier, OpenAI/Anthropic, verifier token + webhook key) · automated backups + PITR on **both** databases · one restore drill each.

---

## 2. The build order

```
P0 Foundations ─→ P1 Spine + bot ─→ P2 ENTRY POINT ─→ P3 Data + verification
                                          │
                                    (demoable here)
                                          ↓
P4 Acquisition ─→ P5 Scan + tier ─→ P6 Personalize + send ─→ P7 Intent + audits ─→ P8 Dashboard + loop
```

**Why the entry point (P2) comes before the data machinery (P3–P4):** it's cheap, it's the first genuinely demoable thing, and it's the part most likely to reveal that the *interaction design* is wrong. You want to discover in week three that your voice notes don't map cleanly onto the request template — not in month five. Invisible plumbing teaches you nothing.

**Run the pilot manually alongside the build.** At every phase, whatever isn't automated yet, do by hand — export the Apify list yourself, upload it, run scans manually, write ten emails. Each phase replaces one manual step. You can book real meetings from month one while automation catches up, and you'll learn which steps were actually painful enough to be worth automating.

---

## PHASE 0 — Foundations

**Goal:** infrastructure exists, secrets are safe, and one message reaches Telegram.

| Repo / area | Work |
|---|---|
| `syncore-contracts` | Initialize repo. v0.1 with only what's certain: verification status enum, basic webhook envelope. Publish privately. |
| `syncore-growth-bot` | Initialize. Bot registered, token vaulted, one hard-coded "hello" message delivered to your chat. |
| Infrastructure | Hub stack deployed (PG16 + Redis + S3 vault, same VPC as CRM). Bot host up. All provider keys vaulted. Backups + PITR on both DBs; **one restore drill actually performed**. |
| Ops | Lookalike domains bought, mailboxes created, SPF/DKIM/DMARC set, **warmup started** (this takes weeks — start it now, it runs in the background). 3 seed inboxes (Gmail/Outlook/Yahoo). DNS preflight script. |

**Acceptance:** a message appears in Telegram from your service; Hub containers healthy; a restore drill succeeded; warmup visibly running.

> **Start warmup in Phase 0 even though sending is Phase 6.** It's the one thing that can't be compressed later.

---

## PHASE 1 — Spine + bot round-trip

**Goal:** the campaign skeleton exists, and an approval works from both surfaces on the same record.

### `lead-engine-crm`
- Prisma models (**all Prisma-native, never in the blob**): `NicheRequest`, `ResearchRun`, `NicheBrief`, `Campaign`, `CampaignStageRun`, `Approval`
- Transactional repositories (the `auth-fast-path.ts` precedent — never `updateState`)
- Read models with **server-side pagination** (no `take: 500` caps)
- Link `CostEntry` → `stageRunId` (extend `ProviderUsageLedger`, don't create a second ledger)
- **CI static check that fails the build** if any Growth OS table name appears in `persistence-projection.ts` / `upsertOrder` — and prove it fails when violated
- Approval Inbox UI + approval **revision** flow (supersede + new hash, never mutate)
- Campaign nav root + Library group; `OutreachCampaign` labelled legacy
- Chat API: `POST /api/chat/niche-request`, `POST /api/approvals/{id}/decide`, `POST /api/approvals/{id}/revise`
- Root `CLAUDE.md` with the golden rules

### `syncore-growth-bot`
- Chat user → CRM user → workspace → role mapping (durable store)
- Approval rendering with inline buttons + **one-time button tokens**
- Outbound `/notify` receiver; HMAC verification; replay protection
- Outbox with retry + dedupe (survives restart)

### `syncore-contracts`
- Approval payload shapes, notify envelope

**Acceptance:** create an approval in the CRM → it appears in Telegram → decide it from *either* surface → both show the same final state. A second tap does nothing. An "edit" produces a new approval row referencing the original. The CI invariant check is green and demonstrably fails when violated.

---

## PHASE 2 — The entry point (voice → research → ICP)

**Goal:** the moment the product becomes real. A voice note produces an approved campaign.

### `syncore-growth-bot`
- Voice note → transcription (Whisper/STT)
- Transcript → **Template A** (`NicheRequest`) extraction via LLM
- Follow-up questions for missing required fields
- Confirmation step

### `lead-engine-crm`
- `ResearchRun` creation + durable queue for the Agent to poll
- `POST /api/webhooks/research-console` (signed) for progress + completion
- On completion: create `NicheBrief` + `Approval(NICHE_TEST)`
- **Guard: no `NicheBrief` or `NICHE_TEST` may exist before research completes**

### `syncore-research-console`
- **`/agent`**: polls the CRM queue, invokes the Console, reports progress, posts the result. Heartbeat so the CRM knows if it's alive.
- `niche-brief.json` export (**Template B**) with validation

### `syncore-contracts`
- `NicheRequest` (A) and `NicheBrief` (B) schemas — kept explicitly separate

**Acceptance:** send a voice note → confirm Template A → research runs (or the bot reports *"queued, Console offline"* and starts when it returns) → Template B comes back → approve from Telegram → a `Campaign` exists with budget cap and kill rules.

> **This is your first real demo.** Show it to someone before continuing.

---

## PHASE 3 — Data spine + verification

**Goal:** clean, deduplicated, verified golden records land in a campaign.

### `syncore-email-verifier` *(smallest job in the whole build)*
- Bearer auth **on by default** for the Hub caller; constant-time compare; `/health` stays open
- Document the batch `WriteTimeout` bound in the deploy doc
- `go build / vet / test` green; MIT + module name preserved

### `syncore-lead-hub`
- **Fix the verifier bridge** — retarget `/api/verify` → `POST /batches`; send bearer; **verify the callback HMAC**; dedupe `(batch_id, email)`
- Map results → `ContactEmail.status`; `invalid` → `Suppression(EMAIL)`; **never `unknown → invalid`**
- MillionVerifier execution + `POST /api/verify/millionverifier` authorize endpoint
- Hub **search + dry-run overlap** API (needed by Phase 4's proposals)
- Golden-record export (`Segment` → `ExportJob` → the golden shape)
- Suppression reconciliation endpoint

### `lead-engine-crm`
- MV pricing + `Approval(PAID_VERIFICATION)` + `CostEntry` on the result
- `hub-verify-result` webhook receiver
- Golden intake under a campaign + `HubSync` cursor
- Stage runs: `HUB_SEARCH`, `FREE_VERIFICATION`, `PAID_VERIFICATION`, `GOLDEN_SYNC`

**Acceptance:** drop a real CSV into the Hub → normalize → dedupe (merge rate reported) → **free verification against the real verifier** → approve MV on the unknowns → golden segment lands in the CRM under the campaign with suppression re-checked. Re-importing the same file creates zero new entities.

---

## PHASE 4 — Acquisition waterfall

**Goal:** approve a provider run in Telegram and watch data arrive in the Hub automatically.

### `lead-engine-crm`
- `ProviderRunProposal` model + UI + chat rendering
- **Hub overlap pre-check** call → populates expected unique yield and cost-per-unique
- Per-provider approval options: approve / approve capped at N / skip / replace / **approve-remaining-within-ceiling**
- Provider execution under an `ACQUISITION` stage run (adapters already exist — this is wiring + gating)
- Push results to the Hub
- **Budget gate** before every paid call + **actual-vs-approved reconciliation** (overrun → auto-park + `SPEND_EXCEPTION`)
- `ENRICHMENT` stage on **post-dedupe uniques only**

### `syncore-lead-hub`
- `POST /api/import/provider-result` — idempotent on content hash, additive for partial results, returns batch ID + counts

**Acceptance:** a proposal in Telegram shows records, cost, overlap, unique yield, cost-per-unique → approve → job runs → raw lands in the Hub → dedupe → enrichment touches only uniques → actual cost reconciles against approved, and an overrun parks the stage.

> **Fallback if this phase runs long:** keep operator-uploads (Option A). Everything downstream works identically; the bot just can't claim it ran the extraction itself.

---

## PHASE 5 — Scan + tiering

**Goal:** every company scored, with **factual** findings ready for personalization.

### `syncore-audit-bot`
- M2M bearer auth (constant-time; separate from the dashboard cookie)
- Explicit `scan` / `full` / `video` modes
- **`scan` returns `FindingCatalog` codes + structured evidence — no OpenAI, no PDF, no voice, no video, no prose.** Test that asserts scan never touches those stages.
- HMAC-signed callback, origin allow-list, `costCents`, echoed `meta`, resumable delivery

### `lead-engine-crm`
- `audit-bot` scan adapter, `AuditRun`, `AuditFinding` models
- `Company.websiteWeakness`, 30-day scan cache, typed-failure mapping
- Tiering → **A/B/C/X with visible reasons**

### `syncore-contracts`
- `FindingCatalog`: the closed code list + evidence schema per code

**Acceptance:** every company with a website gets a scan score or a typed failure; findings stored as facts with evidence; tiers assigned with reasons; the scan provably never invokes AI.

---

## PHASE 6 — Personalization + cold send

**Goal:** approve one template and a few samples, then launch.

### `lead-engine-crm`
- Models: `PersonalizationProfile`, `PersonalizationRun`, `MessageTemplate`, `MessageTemplateVersion`, `GeneratedMessage`, `CopyQaResult`, `PersonalizationSampleSet`
- **LLM provider adapter** behind the existing double gate (the CRM has none today) + cost ledger entries
- Tiered generation: **A** = model weaves finding + angle; **B/C** = deterministic `findingCode → phrase` templates, no per-lead LLM
- **Port the Console's QA rules** (greeting-as-subject, vary-touches, normalize-slips) → `CopyQaResult` gate
- Spin syntax support
- `Approval(PERSONALIZATION_SAMPLES)` on a stored sample set
- **Mailshake adapter** (net-new): export, suppression re-check, copy-hash match, event polling every 10–15 min
- Touch-1 **no-link validator**; pre-launch checklist; `Approval(CAMPAIGN_LAUNCH)`
- Kill rules + `RESUME_AFTER_BREAKER`

**Acceptance:** variables generate in batch with no second crawl; Tier-C uses zero per-lead LLM; you approve a template + 3 samples; launch is blocked if touch 1 has a link or the checklist fails; events flow back; a Mailshake unsubscribe suppresses in both CRM and Hub.

---

## PHASE 7 — Intent, audits, SDR

**Goal:** real interest reaches a human with proof in hand.

### `syncore-audit-bot`
- `mode=full` (no video) and `mode=video` as a separate job, with assets → S3

### `lead-engine-crm`
- Intent routing + **meaningful-click filter** (scanner UAs, bot-fast clicks, unsubscribe excluded)
- **Audit eligibility rules** (always / conditional / never-alone)
- `WARM_CAMPAIGN_PENDING_ASSET` state — **no warm enrollment before the asset exists and passes QA**
- `AuditAsset` + hosted audit pages (unguessable slug, `noindex`, expiry, revoke, access logs, rate limit, CRM-proxied presigned GETs)
- Reply classification + SDR assignment + Hot Lead Workspace
- Warm re-engagement campaign via Mailshake with `audit_page_url`

**Acceptance:** a reply routes to an SDR immediately; a qualifying lead gets a full audit; the warm campaign fires only after the page exists and QA passes; a single open triggers nothing expensive; angry/legal suppresses globally.

---

## PHASE 8 — Dashboard, learning loop, Entry Point B

**Goal:** see everything, learn from it, and reuse the warehouse.

### `lead-engine-crm`
- **Admin dashboard built from `CampaignStageRun`**: full funnel, per-stage estimated/approved/actual cost, records in/out, progress %, bottlenecks
- True unit costs: cost per verified contact, cost per reply, **cost per meeting**, verifier-avoided, merge rate
- Kill-rule evaluator + `Approval(SCALE)`
- `CampaignEligibilityPolicy`: frequency caps, one-active-cold-campaign-per-contact, exclusions — applied at **every** list build
- **Entry Point B**: three brief modes (fresh research / reuse approved brief / lightweight operator brief) + 90-day re-verification refresh
- Winning-template library + Niche Board

### `syncore-research-console`
- Post-mortem import; winning angle → pre-drafted `NicheRequest`

**Acceptance:** the dashboard reconstructs a campaign end to end from stage runs; an existing-Hub campaign launches with no acquisition spend but *with* a brief; no contact sits in two active cold campaigns.

---

## 3. Working rules for the whole build

1. **One repo per Claude Code window.** The CRM window stays open for months; the others open and close.
2. **Every repo gets a root `CLAUDE.md`** with its golden rules pointing at Plan v9.1, so every session auto-loads the constraints.
3. **Every repo gets CI** — lint + typecheck + tests. The CRM additionally runs the projection-invariant static check; the Hub runs normalize/resolve unit tests + a verifier-bridge smoke test.
4. **Inventory before implementation.** Read what exists before writing anything. You have a lot of working code; the failure mode is rebuilding it.
5. **Contracts change in `syncore-contracts` first**, then in the consumers. Never edit a payload shape in two repos independently.
6. **Providers stay mock by default.** Go live one connection at a time behind the double gate.
7. **Manual fallback is always acceptable.** A phase that's late doesn't block the pilot — do that step by hand.

## 4. If you only do one thing per phase

| Phase | The one thing that matters |
|---|---|
| 0 | **Start mailbox warmup** — it's the only thing you can't compress later |
| 1 | The **CI projection check** — it prevents the class of bug that silently deletes data |
| 2 | The **voice → approved campaign** demo — proves the concept end to end |
| 3 | **Fix the verifier bridge** — today verification silently does nothing |
| 4 | **Overlap pre-check** — without it, cost-per-unique is a guess |
| 5 | **Scan returns facts, not prose** — everything downstream depends on this split |
| 6 | **Touch-1 no-link validator** — the single biggest deliverability protection |
| 7 | **Asset-before-enrollment gate** — prevents sending broken audit links |
| 8 | **Cost per meeting** — the only number that decides scale or stop |

---

*Syncore Growth OS — Execution Roadmap · Internal · Companion to Plan v9.1 · Seven repos, nine phases, one manual fallback at every step.*
