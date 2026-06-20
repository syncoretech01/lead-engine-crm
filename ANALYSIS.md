# LEAD-ENGINE-CRM (Syncore) — Codebase Analysis

_Comprehensive inspection — architecture, data model, features, what's real vs simulated, security, quality, and the gaps to (a) full internal use and (b) a complete SaaS._

**Updated:** 2026-06-20. Reflects the M0 internal go-live (hosted on Neon + Vercel) and the M1 live-provider execution framework. Supersedes the original pre-hardening analysis; resolved findings are noted in §8.

**Method:** Findings come from direct reads of `prisma/schema.prisma`, `package.json`, `proxy.ts`, the store/persistence/provider/auth modules, the app routes, and the test suite. Security-relevant claims are cited to file/line where useful.

---

## 1. Executive summary & verdict

Syncore is a **multi-tenant B2B lead-generation engine + CRM + outreach platform** covering the full GTM lifecycle: ICP definition → multi-source lead acquisition → CSV / dedupe / normalize / verify / enrich / score → CRM (accounts / contacts / opportunities / activities) → SDR routing with SLAs → outreach (email / SMS / call) → AI assistance → reporting → compliance / governance.

**Verdict: a feature-complete, well-architected product that is currently a high-fidelity *simulation*, now running live internally.** Every screen and workflow works end-to-end, but every *external* dependency is faked: the 11 data/outreach providers all run in `mock` mode, the "AI" is local heuristics (no LLM), and email/SMS/voice sends are simulated. As of this milestone it is **deployed and in internal use** (Neon Postgres + Vercel, real scoped logins, no demo data), so the team can use the CRM / SDR / manual-outreach surface on real data — but no real lead-gen or real sending happens yet.

**The single most important thing to understand:** the entire application state is one JSON blob (the source of truth); the normalized Postgres tables are a *write-only projection*. See §3.

**Where completion effort goes:** overwhelmingly into **replacing mocks with real integrations** (Tiers A) and **adding the SaaS business/scale layer** (Tier B), not into building features. See §10–§11.

---

## 2. Tech stack
- **Next.js 16.2** (App Router, RSC + Server Actions, Turbopack), **React 19.2**, **TypeScript 6** (strict).
- **Prisma 6 / PostgreSQL** (`@prisma/client`). Path alias `@/*`. `postinstall: prisma generate` (for hosted builds).
- **Vitest** (unit, node env) + **Playwright** (e2e). ESLint 9.
- Tailwind-style utilities (`tailwind-merge`, `clsx`), `lucide-react`, `@fontsource`.
- Scripts: `db:bootstrap`, `db:provision` (real accounts), `generate-secrets`, `worker:provider` (out-of-band provider worker), `test:all`.
- Notably lean: **no auth/crypto/validation libraries** — auth, signing, and encryption are hand-rolled on `node:crypto` (correctly — §6).
- **Hosting:** Neon serverless Postgres + Vercel (internal). Both portable for an AWS move at SaaS scale.

---

## 3. Architecture

### Layering
`app/` pages (RSC) & API routes → **server actions** (`app/actions.ts`, ~130 mutations) → **domain modules** (`lib/phase1/*`, ~45 modules) → **store** (`store.ts`) → persistence. Every mutation runs through `updateState((state, session) => …, { normalizedTables })`, which loads state, runs the (synchronous) mutator, persists, and projects the declared normalized tables.

### Persistence — JSON snapshot is the source of truth; normalized tables are a projection
- **Source of truth:** the whole `AppState` object (~60 arrays), stored as a single JSON document — a file locally, or one `AppStateSnapshot` row. Backend chosen at runtime by `storage-driver.ts` (`SYNCORE_STORAGE_DRIVER`; prod requires `prisma` + `DATABASE_URL`).
- **Write path** (`store.ts` `writeStateToPrisma`): upsert the snapshot inside a Prisma transaction (~20s cap), then `syncNormalizedProjectionToPrisma` projects `AppState` into ~60 normalized tables. **The mutator is synchronous** — async provider I/O must run out-of-band (see provider framework).
- **Read path:** general reads return the in-memory / snapshot `AppState`. Four read-path modules (`compliance-read-path`, `crm-event-read-path`, `outreach-read-path`, `export-read-path`) optionally prefer normalized rows but **fall back to the snapshot**. The normalized-read cutover is **partial**.
- **Versioning:** `migrateState` (version 15) upgrades the blob on read.
- **Implication:** read-modify-write of the *entire* state per mutation + full re-projection is simple and consistent at team scale, and is the **primary scalability ceiling** for SaaS. See §10 Tier B.

### Provider execution stack (`lib/providers/*`, `lib/phase1/provider-*`)
- **Registry** (`registry.ts`): 11 providers — Apollo, Hunter, Google Places, Apify, ZeroBounce, Lusha, People Data Labs, Twilio Lookup, RingCentral, Smartlead, Amazon SES. **All `executionMode: "mock"`** (verified).
- **Jobs / runs:** idempotency-keyed `ProviderJob`; `ProviderJobRun` is the execution unit with optimistic locking + retries.
- **Worker** (`provider-worker.ts`): recovers expired locks → queues retries → claims runs → executes. Now enforces **`rateLimitPerMinute`** (defers over-limit runs) and **`dailyBudgetCents`** (skips over-budget), and **defers live-mode runs** to the out-of-band executor.
- **Live-execution framework** (added M1, `provider-live-execution.ts` + `provider-worker-runner.ts`): 3-phase out-of-band flow — **plan** (sync; claim + budget gate + decrypt credential into context), **invoke** (async network call), **apply** (sync; record outcome + usage). Session-less worker runner (`npm run worker:provider`) drives mock queue + live drain. **Disabled by default** (`SYNCORE_ENABLE_LIVE_PROVIDERS` + connection `executionMode:"live"`). The registry of live adapters is **empty** until M2.
- **Secret vault** (`provider-secret-vault.ts`): AES-256-GCM, random IV, AAD bound to `workspaceId:providerId:vN`, GCM tag + HMAC checksum, versioned refs with rotation lineage. Real at-rest encryption.
- **Cost:** `ProviderUsageLedger` records every run; rolls up to the originating lead job. This is the **billing basis** for Stage B.

---

## 4. Data model (`prisma/schema.prisma`, ~60 models)
Multi-tenant by construction: nearly every model carries `workspaceId` + composite indexes; `Workspace` is the tenant root with cascade deletes. Groups: **Identity/Auth** (User, WorkspaceMember [6 roles], AuthAccount, AuthSession, UserInvite, PasswordResetToken); **Lead pipeline** (SearchProfile → LeadJob → RawLead → NormalizedRecord → Company/Contact → VerificationResult, EnrichmentResult, LeadScore, Segment, Export); **Providers** (ProviderConnection, ProviderEncryptedSecret, ProviderCredentialAudit, ProviderJob, ProviderJobRun, ProviderUsageLedger); **CRM** (Account, CrmContact, Opportunity, Activity, Task, Note, CallLog, CustomField/Value); **SDR** (SdrTeam, SdrAssignment, FollowUpReminder, ReassignmentRule); **Outreach** (OutreachProvider, OutreachCampaign, CampaignSequence, SequenceStep, EmailEvent, SmsEvent, TrackedCall); **Governance** (SuppressionRecord, RetentionPolicy/Run, ComplianceChecklistItem, DataSubjectRequest, DeliverabilityAlert, AuditLog); **AI** (8 AI artifact models); **Bridge** (AppStateSnapshot — the JSON blob).

---

## 5. Feature surface (App Router)
- **Lead engine:** `/` dashboard funnel; `/search-profiles` (ICP); `/lead-jobs` (preflight cost/budget/retry); `/staging` (CSV import + field mapping — incl. per-row **source column** and **custom columns** → contact custom fields); `/data-quality` (dedupe + suppression); `/enrichment`; `/exports` (gated templates).
- **CRM:** `/crm` + `/crm/accounts[/id]`, `/crm/contacts[/id]`, `/crm/opportunities`.
- **SDR / Outreach:** `/sdr/queue`, `/sdr/manager` (assignment routing, SLA, reminders, reassignment); `/outreach/campaigns`, `/outreach/events`.
- **Admin / Compliance / AI:** `/automation`, `/reports`, `/reports/compliance`, `/compliance`, `/access` (RBAC, invites, deactivation), `/integrations` (provider hub).
- **Auth:** `/login`, `/invite/[token]`, `/reset-password[/token]`.
- **API routes:** `POST /api/import/csv`, `GET /api/exports/[id]`, `POST /api/webhooks/{email,sms}`.

---

## 6. Auth, RBAC & tenant isolation
- **Central backstop:** `proxy.ts` (Next 16's renamed middleware) redirects unauthenticated page requests to `/login` and returns 401 for `/api/*`, bypassing public auth/asset/webhook paths. Note: it checks **cookie presence only** — real authorization is still per-action `assertPermission`.
- **Sessions:** `syncore_auth_session` = base64url JSON + HMAC-SHA256, timing-safe verified, 8h expiry; `httpOnly`, `sameSite=lax`, `secure` in production.
- **Passwords:** scrypt (keylen 64) + 16-byte salt, NFKC-normalized, timing-safe compare. Invite/reset tokens stored as SHA-256 hashes. Account lockout after 5 fails / 10 min.
- **RBAC:** `permissionsByRole` map (Admin, Manager, SDR, Data Operator, Viewer, Compliance Admin). SDRs are **data-scoped to their assigned records** (`view_records` vs `view_all_records`, `ownedCrmRecordScope`); team-wide ops gated by `manage_sdr_team`; 1:1 outreach gated by `send_direct_outreach`.
- **Production secret guards (now consistent):** `SYNCORE_AUTH_SECRET`, `SYNCORE_WEBHOOK_SECRET`, and `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` **all throw in production** if unset (was inconsistent in the prior analysis — now fixed).
- **Rate limiting:** `rate-limit.ts` (in-memory, production-gated) plus account lockout.
- **Webhooks:** HMAC-SHA256 verified before parsing, timing-safe, workspace + membership validated, idempotency-deduped. (Provider-*native* signature schemes still TODO for M3.)
- **Tenancy:** CRM task/note/call creation is workspace-scoped (`resolveWorkspaceCrmTargets`) — the prior cross-tenant reference gap is closed.

---

## 7. What's real vs. simulated

| Area | Real today | Simulated / missing |
|---|---|---|
| CRM, SDR, pipeline, staging, dedupe, scoring | ✅ | — |
| Auth, RBAC, sessions, tenancy, audit, compliance | ✅ | — |
| Hosting + DB (internal) | ✅ Neon + Vercel | — |
| Provider framework (jobs/worker/vault/ledger/live-exec) | ✅ | adapters behind it are mock |
| Lead **data** (Apollo, Hunter, ZeroBounce, Places, PDL, Lusha, Apify) | — | ❌ all mock (M2) |
| **Outreach sending** (Smartlead, SES, RingCentral, Twilio) | — | ❌ all mock (M3) |
| **AI** | local heuristics | ❌ no real LLM |
| Object storage (recordings/exports/payloads) | — | ❌ no S3 |
| Invite/reset **email delivery** | tokens generated | ❌ not actually emailed (needs SES) |

---

## 8. Testing & quality
- **Unit (~32 files):** strong coverage — dedupe, verification/export, enrichment/reporting/AI, jobs, money-ledger, retention, compliance, webhooks, read-paths, persistence-projection, storage-driver, provider jobs/worker/contracts/connections/live-execution/worker-runner, auth-rbac, workspace-isolation, sdr-visibility, production-auth/secrets, rate-limit, provisioning, csv source/custom columns. **129 tests passing.**
- **E2E (`tests/e2e`):** `app-smoke` + `ui-qa` — **smoke-level only** (routes render, responsive screenshots). No interactive form/API/permission flows, no tenant-isolation E2E in Prisma mode, no perf tests.
- **Cleanliness:** strict TS, ~0 TODO/FIXME, no `@ts-ignore`, disciplined low-debt code.

### Resolved since the original analysis
Cross-tenant CRM reference gap (now workspace-scoped); missing prod secret guards (all three now throw); "no central middleware" (`proxy.ts` exists); `rateLimitPerMinute` (now enforced); live-provider execution (framework now built, M1). Original risks #1, #2, #4, #5, #7, #8 are largely closed.

---

## 9. Current risk register

| # | Sev | Finding | Direction |
|---|-----|---------|-----------|
| 1 | **Med** | **Whole-state read/write + full re-projection per mutation; one snapshot row per workspace.** The core scalability ceiling for multi-tenant SaaS with concurrent writers. | Complete the normalized read-path cutover; eventually retire snapshot-as-source-of-truth. (Tier B) |
| 2 | **Med** | **Projection delete-then-upsert** — an incomplete projection mapper for a new feature could delete legitimate normalized rows (mitigated: snapshot is source of truth). | Projection-completeness guard/test. |
| 3 | Low | `proxy.ts` checks **cookie presence only**, not validity/permission. | Fine as defense-in-depth; authz stays per-action. |
| 4 | Low | `sameSite=lax`, **no explicit CSRF tokens** on actions/forms. | Revisit for SaaS. |
| 5 | Low | **Demo-session escape hatch** (`SYNCORE_ALLOW_DEMO_SESSION`) reads unsigned cookies/env. Off by default; must stay unset in prod. | Documented in go-live runbook. |
| 6 | Low | `superadmin` flag set but **never consulted** — no platform-admin concept. | Wire up for Stage B back-office. |
| 7 | Low | Optimistic-lock claim race (mitigated by unique `(jobId, attempt)` + idempotency; single worker today). | Revisit for multi-worker. |
| — | Note | **Everything external is simulated** (providers, AI, sending) — expected for the current phase; this is the bulk of remaining work. | M2 / M3 / real LLM. |

---

## 10. Gaps to a complete SaaS (by tier)

**Tier A — make integrations real:** M2 real lead data (ZeroBounce → Hunter → Apollo → Places → PDL/Lusha → Apify, one adapter at a time behind the flag + contract fixtures); M3 real outreach (Twilio Lookup, Amazon SES [also fixes invite/reset email], Smartlead, RingCentral, provider-native webhook signatures) **after legal/privacy sign-off**; real LLM for AI; S3 object storage.

**Tier B — SaaS productization:** self-serve **signup + workspace provisioning** (none today — workspaces are created by the `db:provision` CLI); **Stripe billing** + seat/usage metering (ledger captures the basis; nothing meters/charges); **SSO/SAML**; the **persistence re-architecture** off the single-blob model; **managed secrets** (KMS + rotation); external **security review / pentest / SOC2**.

**Tier C — operational maturity:** observability (Sentry + structured logs); **schedule the provider worker** (cron/hosted process); backups/restore drills + runbooks; deepen E2E (interactive + tenant-isolation in Prisma mode).

---

## 11. What's left for *internal* use by the Syncore team

Internal use ≠ SaaS-complete. The team does **not** need signup, billing, SSO, or the persistence re-architecture. The focused remaining list:

**Usable today** (no further work): CRM (accounts/contacts/opportunities/activities/tasks/notes/calls), SDR queues/SLAs/reminders/manager dashboard, **CSV lead import** + dedupe/verify/enrich/score on imported data, reporting, compliance/audit.

**M0 operational close-out (days, mostly owner tasks):**
1. **Repoint Vercel to the `lead-engine-crm` repo** (currently watching the stray `leadenginecrm`) — until done, merges don't deploy. *(immediate blocker)*
2. Finish onboarding the 4 SDRs via the in-app **invite flow** (links delivered manually until SES lands).
3. Lock Vercel access (Deployment Protection), rotate the Neon DB password, run a backup/restore drill.

**To do real lead-gen in-app (M2):** wire the first real adapters (ZeroBounce verification + one source like Apollo) so the owner can run real lead jobs instead of mock/CSV-only. Schedule the provider worker. *(Optional if CSV import is enough initially.)*

**To do real outreach in-app (M3) — the core of an "outbound tool":** Amazon SES (transactional + makes invites/resets actually email), Twilio Lookup (phone validation), Smartlead and/or RingCentral (real email/SMS/calls + webhooks), **plus legal/privacy sign-off before any live send**. Until this lands, SDRs can manage their book and log activity but **cannot send real email/SMS/calls from the app**.

**Bottom line for internal use:** the CRM + lead-import + SDR workflow is usable now after the M0 close-out (esp. the Vercel repo fix). Becoming a true *internal outbound tool* requires **M3 (real sending)** as the headline gap, with **M2 (real sourcing)** close behind. Neither billing nor multi-tenant scale work is needed for the Syncore team itself.

---

## 12. Strengths
Disciplined multi-tenant schema; pervasive `AuditLog`; real cryptography done correctly (scrypt, HMAC sessions, AES-256-GCM vault with AAD + checksum, timing-safe compares); account lockout; webhook HMAC + idempotency; compliance-by-design (lawful basis, consent, DSAR, retention, suppression, recording consent); idempotent provider jobs with a usage/cost ledger; a real, gated, out-of-band live-execution framework ready for M2; clean layering; strict typing; near-zero tech debt; ~129 passing tests.
