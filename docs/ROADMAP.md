# Syncore Lead Engine & CRM — Roadmap to Completion

Created: 2026-06-17

## Context
This roadmap answers: *what can the app do today, where is it going, and what are the next steps to completion, in order?*

**The chosen path (drives everything below):**
- **Stage A — Internal outbound tool, on real data.** Users: 4 SDRs + 1 manager (CRM / SDR / outreach), plus the owner/developer (lead engine + dev). Real scoped logins (roles already defined). **Full outbound in-app** (email + SMS + calls). **Wire real provider APIs now.**
- **Stage B — Productize to SaaS** once it is proven internally.

Today the app is a **feature-complete simulation**: all eight feature phases are built and usable, but every external dependency — the 11 providers, AI, and email/SMS/voice sending — is mocked, and state lives in a JSON snapshot. "Completion" therefore means **replacing the simulation with real integrations + production operations**, in the order below. This plan reuses the locked decisions in `docs/PRODUCTION_ARCHITECTURE.md`, `docs/PROVIDER_INTEGRATION_PLAN.md`, and `docs/PHASE_6_DATABASE_CUTOVER.md`.

---

## What the app can do TODAY (starting point)
Run `npm run dev` (file storage by default) and the full product works end-to-end on simulated data:
- **Lead engine:** define ICP search profiles, create lead jobs, import real CSVs (`/staging`), normalize → dedupe → suppress → verify (A–S grades) → enrich → score/segment → export gated CSVs.
- **CRM:** accounts, contacts, opportunities, activities, tasks, notes, call logs, custom fields.
- **SDR:** assignment routing, queues, SLA timers, reminders, manager dashboard, reassignment rules.
- **Outreach:** campaigns/sequences, email/SMS/call event tracking, bounce/unsub/STOP handling — all *simulated* (`simulateCampaignSendAction`; "RingCentral Local" / "Syncore Mail Local" placeholders).
- **AI automation:** personalization, reply classification, call summaries, lead scoring, ICP / deliverability / revenue insights — all *deterministic/local*, no LLM.
- **Admin / compliance:** RBAC (6 roles), audit logs, retention, DSAR, suppression, reporting.
- Optional: switch to PostgreSQL with `SYNCORE_STORAGE_DRIVER=prisma` + `npm run db:bootstrap`.

**One constraint to internalize:** the whole app state is a single JSON blob (source of truth); the normalized Postgres tables are a write-only projection. Fine for internal scale; revisit for SaaS scale (Stage B).

---

# STAGE A — Internal tool on real data

> Order is dependency-driven: harden the base → make adapters real-capable → real data in (the engine) → real outreach out (SDRs) → operate. M2 (engine) and M3 (outreach) can run partly in parallel once M0–M1 are done. Effort tags: S = days, M = 1–2 weeks, L = multi-week.

## M0 — Lock the foundation: secure, durable, hosted, real logins  (do first)
*Goal: the 5 users log into real scoped accounts on a hosted instance backed by a real database with backups. No live provider calls yet, but real CRM use can begin.*

- **DB cutover to PostgreSQL** as the running mode (`SYNCORE_STORAGE_DRIVER=prisma`): provision managed Postgres, `prisma migrate deploy`, enable automated backups. Follow `docs/PHASE_6_DATABASE_CUTOVER.md`. *(M)*
- **Fix the verified security / correctness gaps** (see `ANALYSIS.md`):
  - Tenant-scope the contact lookups in `createTaskAction` / `createNoteAction` / `createCallLogAction` (`app/actions.ts:725,808,848`) — mirror `createOpportunityAction` (`app/actions.ts:624,633`). *(S)*
  - Add production guards for `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` (`lib/phase1/provider-secret-vault.ts:166`) and `SYNCORE_WEBHOOK_SECRET` (`lib/phase1/webhooks.ts:56`) — mirror `resolveAuthSecret`'s prod-throw (`lib/phase1/auth-security.ts:130`). **Required before storing real provider API keys.** *(S)*
  - Set strong secrets in the hosted env; ensure `SYNCORE_ALLOW_DEMO_SESSION` is unset; confirm `secure` cookies in prod. *(S)*
  - Basic rate limiting on `/login`, `/reset-password`, and the webhook routes; optional `middleware.ts` backstop. *(S–M)*
- **Tighten SDR record visibility** so an SDR sees only *assigned* leads/accounts, not everyone's (`ACCEPTANCE_CRITERIA_AUDIT.md` §24.7 flags this Partial — currently nav-gated, not data-gated). Use `sdrQueueSnapshot` owner filtering as the pattern. **Directly serves the "specific scopes" requirement.** *(M)*
- **Provision real users:** seed the real workspace + 6 accounts (owner = Admin, manager = Manager, 4 × SDR) with correct roles; drop demo seed data. Auth itself is already built (Phase 7: hashed passwords, signed sessions). *(S)*
- **Host it:** deploy app (Vercel or AWS App Runner) + managed Postgres + backups; lock to internal access. *(M)*
- **Exit criteria:** each role logs in on the hosted URL, sees only what their scope allows, data persists in Postgres, backups verified.

## M1 — Make the provider framework real-capable (safely)  (prereq for any live call)
*Goal: the typed adapter layer can execute real network calls, gated and observable, without blocking requests.*
- Implement a **live execution path** behind the existing interfaces in `lib/providers` (`interfaces.ts`, `registry.ts`); add `executionMode: "live"` dispatch in `lib/phase1/provider-worker.ts` (`processProviderJobQueue`), **disabled-by-default / feature-flagged** per `docs/PROVIDER_INTEGRATION_PLAN.md`. *(L)*
- **Stand up a real worker runner** (Redis-backed or a hosted cron/worker process) to drive the job queue out-of-band — real extraction / enrichment / sending must not run in the request path. *(M–L)*
- **Enforce `rateLimitPerMinute` + `dailyBudgetCents`** in the worker (fields exist, not enforced) so real spend / limits are honored; surface cost via the existing `ProviderUsageLedger`. *(M)*
- Keep the **contract-test harness** (`lib/providers/contract-testing.ts`, `tests/fixtures/providers/provider-contracts.json`) green — add/record fixtures per adapter *before* enabling it live. *(S each)*
- **Exit criteria:** one trivial adapter runs live behind a flag in the worker, with a job/run record, usage-ledger entry, and budget enforcement.

## M2 — Real lead engine: data IN  (owner's area)
*Goal: replace local heuristics with real sourcing / verification / enrichment. Roll out one adapter at a time in the chosen order, each behind a flag + contract fixtures.*
- Order (`docs/PROVIDER_INTEGRATION_PLAN.md`): **ZeroBounce** (verification) → **Hunter** (email find) → **Apollo** (primary source) → **Google Places** (local source) → **People Data Labs** / **Lusha** (enrichment + fallback) → **Apify** (sanctioned custom extraction, last). *(M per adapter, L total)*
- Each adapter: implement the typed interface, store credentials via the encrypted vault (`lib/phase1/provider-secret-vault.ts`), wire into the existing flows (`lib/phase1/verification.ts`, `enrichment.ts`, `jobs.ts`), validate against real data, watch cost in the usage ledger.
- **You supply:** API credentials for each provider as you reach it.
- **Exit criteria:** a real lead job sources + verifies + enriches real records end-to-end, with real cost tracked.

## M3 — Real outreach: sending OUT (email + SMS + calls)  (highest compliance surface)
*Goal: SDRs send real email, SMS, and calls from Syncore, with real event sync and consent/compliance enforced.*
- **Legal / privacy review FIRST** (`ACCEPTANCE_CRITERIA_AUDIT.md` follow-up #7): lawful basis, consent capture, unsubscribe + physical-address footer, SMS STOP, call-recording consent. Enforcement is already coded (`enforceSequenceStepCompliance`, compliance layer) — get **sign-off before any live send**. *(M, mostly owner/legal time)*
- **Twilio Lookup** (phone validation) before any SMS / call or phone-ready export. *(M)*
- **Amazon SES** for transactional email (invites / resets / notifications) + provider-native bounce/complaint webhooks. *This also makes invite/reset actually email* (today tokens are generated but never sent). Requires an SES domain + DNS (SPF/DKIM/DMARC). *(M)*
- **Smartlead** for cold outbound: replace `simulateCampaignSendAction` with a gated real send + reply/bounce/open/click/unsub sync via real webhooks. Needs sending domain(s) + warmup. *(L)*
- **RingCentral** for telephony / SMS: calls, SMS, delivery/reply/STOP webhooks, recording metadata — replace the "RingCentral Local" placeholder. *(L)*
- **S3-compatible object storage** for call recordings, exports, attachments, provider payload archives. *(M)*
- **Provider-native webhook signatures + replay-window** checks (today only the Syncore HMAC scheme exists) for SES / Smartlead / RingCentral. *(M)*
- **You supply:** provider accounts + credentials, verified sending domains / numbers, DNS records.
- **Exit criteria:** an SDR sends a real sequence (email + SMS + call), events flow back via real webhooks, suppression / STOP / unsub side effects fire, recordings land in S3.

## M4 — Operate it reliably (internal production)
- **Observability:** Sentry + structured logs (`docs/PRODUCTION_ARCHITECTURE.md` step 9). *(M)*
- **Backups / restore drills, migration workflow, runbooks.** *(M)*
- **Continue normalized write-path cutover** for CRM / compliance / reporting actions (current top follow-up) so reads can leave the snapshot — improves reliability and prepares for scale. *(L, incremental)*
- **Test hardening:** tenant-isolation + auth E2E in Prisma mode; real-workflow E2E (form flows, API routes); provider/webhook replay tests — closes the gaps in `ANALYSIS.md` §7. *(M)*
- **Tune** rate limits / daily budgets with real cost data.

---

# STAGE B — Productize to SaaS (after internal proof)
Defer until Stage A is proven. Each builds on what is already modeled:
- **Self-serve onboarding:** signup + workspace provisioning (the multi-tenant schema already supports many workspaces). *(L)*
- **Enterprise auth:** SSO / OIDC / SAML (Clerk / Auth0 / OIDC) alongside the existing first-party auth. *(L)*
- **Billing:** Stripe subscriptions + seat/usage metering — the `ProviderUsageLedger` already captures per-tenant cost as a billing basis. *(L)*
- **Managed secrets:** move the credential key to a KMS / secret-store + rotation ops (the vault already uses AES-256-GCM; swap the key source). *(M)*
- **Scale services only when measured:** OpenSearch (lead search), ClickHouse (reporting), Redis scaling, multi-region — all explicitly deferred in the architecture doc until volume justifies. *(L)*
- **SaaS-grade trust:** full tenant-isolation test lane, external security review / pentest, SOC2-style program. *(L)*

---

## What you need to procure (gates the milestones)
- **M0:** managed Postgres + app hosting + backups.
- **M2:** API keys — ZeroBounce, Hunter, Apollo, Google Places, PDL, Lusha, Apify (in that order).
- **M3:** Twilio (Lookup), Amazon SES (+ DNS), Smartlead (+ sending domains / warmup), RingCentral (app + numbers), S3 bucket / IAM; **legal/privacy sign-off before live sending.**
- **Stage B:** auth-provider account, Stripe account, KMS.

## Verification (per milestone)
- **Always:** `npm run lint && npm run typecheck && npm test && npm run test:e2e` stay green; add tests with each adapter / fix.
- **M0:** `prisma migrate deploy` clean; log in as each of the 6 users on the hosted URL and confirm scoped visibility; kill-and-restore DB backup test.
- **M1:** enable one adapter flag → confirm a live job/run record + usage-ledger row + budget stop.
- **M2:** run a real lead job; confirm real verification grades + enrichment + cost on real records.
- **M3:** send a real test sequence to a seed inbox/number; confirm webhook events, suppression on STOP/unsub, recording in S3.
- **M4:** trigger a Sentry alert; run the restore runbook; tenant-isolation E2E passes in Prisma mode.
