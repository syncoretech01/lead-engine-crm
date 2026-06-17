# LEAD-ENGINE-CRM (Syncore) — Codebase Analysis

_Comprehensive inspection — architecture, data model, features, security, quality, and a prioritized risk register._

**Method:** Findings come from direct reads of `prisma/schema.prisma`, `package.json`, configs, and key modules, plus a structured exploration of persistence/providers, auth/tenancy, and features/tests. Every High/Medium security finding was **verified directly against source** (file:line cited). One early claim ("provider secrets are not encrypted") was checked and found **false** — secrets *are* AES-256-GCM encrypted — and is corrected below.

---

## 1. Executive summary & verdict
A **multi-tenant B2B lead-generation engine + CRM** ("Syncore") covering the full GTM lifecycle: ICP definition → multi-source lead acquisition → CSV / dedupe / normalize / verify / enrich / score → CRM (accounts / opportunities / activities) → SDR routing → outreach (email / SMS / call) → AI automation → reporting → compliance / governance.

**Verdict: a mature, thoughtfully-architected pre-production application.** The security and compliance *mechanisms* are genuinely strong (real cryptography, pervasive audit logging, compliance-by-design). The gaps are **enforcement-consistency** issues, not missing primitives:

- a few queries miss the tenant filter their siblings have;
- two of three app secrets lack the production guard the third enforces;
- auth is enforced per-action with no central middleware (which is how the isolation gap crept in);
- plus expected unfinished work (live provider adapters are stubbed).

None are architectural dead-ends; all are localized fixes.

**The single most important thing to understand:** the entire application state is one JSON blob (the source of truth); the normalized Postgres tables are a *write-only projection*. See §3.

---

## 2. Tech stack
- **Next.js 16.2** (App Router, RSC + Server Actions), **React 19.2**, **TypeScript 6** (strict).
- **Prisma 6 / PostgreSQL** (`@prisma/client`). Path alias `@/*`.
- **Vitest** (unit, node env) + **Playwright** (e2e, single worker, dev server on `:3001`).
- Tailwind-style utilities (`tailwind-merge`, `clsx`), `lucide-react`, `@fontsource`. ESLint 9 (`next/core-web-vitals`).
- Scripts: `db:bootstrap` (generate + migrate deploy + seed), `test:all` (typecheck + vitest + playwright).
- Notably lean dependency tree — **no auth library, no crypto library, no validation library**; auth, signing, and encryption are all hand-rolled on `node:crypto` (see §6).

---

## 3. Architecture

### Layering
`app/` pages (RSC) & API routes → **server actions** (`app/actions.ts`, ~130 mutations) → **domain modules** (`lib/phase1/*`) → **store** (`store.ts`) → persistence. Every mutation runs through `updateState((state, session) => …, { normalizedTables })`, which loads state, runs the mutator, persists, and projects to the declared normalized tables.

### Persistence — JSON snapshot is the source of truth; normalized tables are a projection (CQRS-ish)
- **Source of truth:** the whole `AppState` object, stored as a single JSON document — either a file or one `AppStateSnapshot` row (`store.ts`). Storage backend is chosen at runtime by `storage-driver.ts` (`SYNCORE_STORAGE_DRIVER`, defaults to file unless `DATABASE_URL` + prod guards).
- **Write path** (`store.ts` `writeStateToPrisma`): upsert the snapshot inside a Prisma transaction (~20s timeout), then call `syncNormalizedProjectionToPrisma` (`persistence-projection.ts`) to project `AppState` into ~60 normalized tables.
- **Read path:** reads return the in-memory / snapshot `AppState`. Normalized tables are **not** read back for general reads. Four domain "read-path" modules (`compliance-read-path.ts`, `crm-event-read-path.ts`, `outreach-read-path.ts`, `export-read-path.ts`) optionally prefer normalized rows but **fall back to the snapshot** when normalized is empty.
- **Versioning:** `migrateState` (current version 15) upgrades the blob on every read and writes back if changed.
- **Implication:** read-modify-write of the *entire* state per mutation, plus a full re-projection, is simple and consistent at seed/demo scale but is the **primary scalability ceiling** and the reason for the 20s transaction. Snapshot and projection can also drift if a projection mapper is incomplete (see risk #3).

### Provider execution stack (`lib/providers/*`, `lib/phase1/provider-*`)
- **Registry** (`registry.ts`) defines providers (Apollo, Hunter, Google Places, Apify, ZeroBounce, Lusha, PDL, Twilio Lookup, Smartlead, SES, …); all currently `executionMode: "mock"`.
- **Jobs / runs:** `createProviderJob` builds an `idempotencyKey` from workspace + provider + operation + `requestHash` and returns the existing job on duplicates. `ProviderJobRun` is the unit of execution.
- **Worker** (`provider-worker.ts`): per tick it recovers expired locks → queues due retries → claims runnable runs (optimistic lock via `lockedBy` / `lockExpiresAt`, ~60s lease) → executes. The mock executor returns deterministic per-operation results; retries carry a checkpoint; `maxAttempts` is enforced.
- **Secret vault** (`provider-secret-vault.ts`): **AES-256-GCM**, random 12-byte IV, AAD bound to `workspaceId:providerId:vN`, GCM auth tag + HMAC-SHA256 checksum, versioned secret refs with rotation lineage. (Verified — this is real at-rest encryption.)
- **Cost:** `ProviderUsageLedger` records every run; costs roll back up to the originating lead job.
- **Contract testing** (`contract-testing.ts` + `tests/fixtures/providers/provider-contracts.json`): fixture-driven assertions against mock adapters, with secret-redaction checks.

---

## 4. Data model (`prisma/schema.prisma`, ~60 models)
**Multi-tenant by construction:** almost every model carries `workspaceId` and composite `[workspaceId, …]` indexes; `Workspace` is the tenant root with cascade deletes. Groups:

- **Identity / Auth:** `User`, `WorkspaceMember` (roles: ADMIN / MANAGER / SDR / DATA_OPERATOR / VIEWER / COMPLIANCE_ADMIN), `AuthAccount` (passwordHash, failedLoginCount, lockedUntil, mfaEnabled, superadmin), `AuthSession`, `UserInvite`, `PasswordResetToken`.
- **Lead pipeline:** `SearchProfile` → `LeadJob` → `LeadJobSource` → `RawLead` → `NormalizedRecord` → `Company` / `Contact` → `FieldSource` (provenance) → `VerificationResult`, `EnrichmentResult`, `LeadScore`, `Segment` / `RecordSegment`, `Export`.
- **Providers:** `ProviderConnection`, `ProviderEncryptedSecret`, `ProviderCredentialAudit`, `ProviderJob`, `ProviderJobRun`, `ProviderUsageLedger`, `Integration`.
- **CRM:** `Account`, `CrmContact`, `Opportunity`, `Activity`, `Task`, `Note`, `CallLog`, `CustomField` / `CustomFieldValue`.
- **SDR:** `SdrTeam`, `SdrAssignment` (SLA fields), `FollowUpReminder`, `ReassignmentRule`.
- **Outreach:** `OutreachProvider` (SPF/DKIM/DMARC), `OutreachCampaign`, `CampaignSequence`, `SequenceStep`, `EmailEvent`, `SmsEvent`, `TrackedCall`.
- **Governance:** `SuppressionRecord`, `RetentionPolicy` / `RetentionRun`, `ComplianceChecklistItem`, `DataSubjectRequest`, `DeliverabilityAlert`, `AuditLog`.
- **AI:** `AiPersonalization`, `AiReplyClassification`, `AiCallSummary`, `AiLeadScorePrediction`, `AiIcpRecommendation`, `AiDeliverabilityRecommendation`, `AiRevenueInsight`, `AiAutomationRun`.
- **Legacy bridge:** `AppStateSnapshot` (the JSON blob; see §3).

---

## 5. Feature surface (App Router)
- **Lead Gen:** `/` dashboard funnel; `/search-profiles` (ICP), `/lead-jobs` (preflight / cost / retry), `/staging` (CSV import + normalization workbench), `/data-quality` (dedupe + suppression), `/enrichment`, `/exports` (gated templates).
- **CRM:** `/crm` + `/crm/accounts[/id]`, `/crm/contacts[/id]`, `/crm/opportunities`.
- **SDR / Outreach:** `/sdr/queue`, `/sdr/manager`, `/outreach/campaigns`, `/outreach/events`.
- **Admin / Compliance / AI:** `/automation`, `/reports`, `/reports/compliance`, `/compliance`, `/access` (RBAC mgmt), `/integrations` (provider hub).
- **Auth:** `/login`, `/invite/[token]`, `/reset-password[/token]`. `app/layout.tsx` gates the AppShell by session; public auth routes bypass it.
- **API routes:** `POST /api/import/csv`, `GET /api/exports/[id]`, `POST /api/webhooks/email`, `POST /api/webhooks/sms`.

---

## 6. Auth, RBAC & tenant isolation (verified against source)
- **Sessions:** cookie `syncore_auth_session` = base64url JSON payload + HMAC-SHA256 signature, timing-safe verified, 8h expiry; `httpOnly`, `sameSite=lax`, `secure` only in production (`auth-security.ts:57-108`). Session binds `userId` + `workspaceId`; role resolved via `WorkspaceMember`.
- **Passwords:** scrypt (keylen 64) + per-password 16-byte salt, NFKC-normalized, timing-safe compare (`auth-security.ts:32-47`). Invite / reset tokens stored as SHA-256 hashes (`:53-55`).
- **Guards (canonical):** `getSession` → redirect `/login`; `getWorkspaceContext(permission)` → redirect on missing permission (`store.ts:135-157`); `assertPermission` in actions; `requireWorkspaceScopedRecord` for record scoping (`tenant-isolation.ts:28-38`). **No `middleware.ts`** — enforcement is per-action.
- **Brute force:** account lockout after 5 fails / 10 min (`auth-service.ts`). Implemented.
- **Webhooks:** HMAC-SHA256 signature verified before parsing, `sha256=` prefix stripped, timing-safe; payload `workspaceId` validated + actor membership asserted; idempotency key dedupes (`webhooks.ts:64-87`).
- **Production secret enforcement is inconsistent:** `SYNCORE_AUTH_SECRET` **throws** if missing in prod (`auth-security.ts:130-131`), but `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` (`provider-secret-vault.ts:166-170`) and `SYNCORE_WEBHOOK_SECRET` (`webhooks.ts:56-58`) **silently fall back to hardcoded dev keys**. → risk #2.

---

## 7. Testing & quality
- **Unit (~27 files, `tests/unit`):** strong coverage of domain logic — dedupe, verification / export, enrichment / reporting / AI, jobs, money-ledger, retention, compliance, webhooks, all read-paths, persistence-projection, storage-driver, provider jobs / worker / contracts / connections, `auth-rbac`, `workspace-isolation`, `production-auth`.
- **E2E (`tests/e2e`):** `app-smoke` (all routes render, role-scoped nav) + `ui-qa` (responsive screenshots across 3 viewports). **Smoke-level** — no interactive flows (form submit, filter / sort), no direct API-route tests, no perf tests.
- **Cleanliness:** strict TS; **0** `TODO` / `FIXME`, no `@ts-ignore` / `@ts-expect-error`, negligible `console.log`. Disciplined, low-debt code.
- **Coverage gap of note:** the cross-tenant gap in risk #1 is **not caught** by `workspace-isolation.test.ts` (it doesn't exercise task / note / call creation with a foreign `contactId`).

---

## 8. Prioritized risk register

| # | Sev | Finding | Evidence | Suggested direction |
|---|-----|---------|----------|---------------------|
| 1 | **High** | **Cross-tenant reference gap.** `createTaskAction`, `createNoteAction`, `createCallLogAction` look up the contact with bare `contacts.find(item => item.id === contactId)` (no workspace filter), then derive `companyId` from it; `createCallLogAction` also copies the foreign contact's `phone`. A user with `manage_crm` + a known foreign `contactId` can attach their workspace's task/note/call to another tenant's contact and read that phone. Sibling `createOpportunityAction` scopes correctly. **Verified.** | `app/actions.ts:725, 808, 848` (+856); correct pattern at `:624, :633` | Add `&& item.workspaceId === session.workspace.id` or use `requireWorkspaceScopedRecord`; add a regression test. |
| 2 | **Med** | **Two app secrets lack the prod guard the auth secret has** — credential-encryption key and webhook secret silently use public dev defaults in prod ⇒ provider API creds encrypted under a known key; webhooks forgeable. **Verified.** | `provider-secret-vault.ts:166-170`; `webhooks.ts:56-58`; cf. guard at `auth-security.ts:130-131` | Mirror `resolveAuthSecret`'s prod-throw for both. |
| 3 | **Med** | **Projection delete-then-upsert.** Normalized sync deletes workspace rows absent from the projection; an incomplete mapper for a new feature could silently delete legitimate rows. | `persistence-projection.ts:~1321-1335` | Guard against empty/partial projections; add a projection-completeness test. |
| 4 | **Med** | **No central `middleware.ts`.** Auth / permission / tenant checks are per-action; new routes can omit them — exactly how #1 arose. | absent at repo root | Add middleware as a defense-in-depth backstop. |
| 5 | **Med** | **No rate limiting** on password-reset, invite-accept, CSV import, or webhook endpoints (login is partly covered by lockout). | `auth-service.ts`, `app/api/*` | Add throttling on unauthenticated / abuse-prone endpoints. |
| 6 | Low | **Demo-session escape hatch** reads *unsigned* cookies / env when `SYNCORE_ALLOW_DEMO_SESSION=true`. Off by default; deployment-critical. **Verified.** | `store.ts:182-210` | Ensure the flag is never set in prod; document. |
| 7 | Low | **Live providers unimplemented** — `executionMode` hardcoded `"mock"`; no live adapters behind the interfaces. Expected for current phase. | `lib/providers/registry.ts`, `interfaces.ts` | Roadmap item before real integrations. |
| 8 | Low | **`rateLimitPerMinute` not enforced** by the worker (budget only partly enforced). | `provider-worker.ts`, `provider-connections.ts` | Enforce when live execution lands. |
| 9 | Low | **Optimistic lock claim race** (mitigated by unique `(providerJobId, attempt)` + idempotency; single-worker today). | `provider-worker.ts:46-74` | Revisit for multi-worker scaling. |
| 10 | Low | `superadmin` flag set in seed but never consulted in permission checks (dead / incomplete). `sameSite=lax` (not strict); no explicit CSRF tokens. | `auth.ts`; `auth-security.ts:103` | Decide intent / tighten if no cross-site need. |
| — | Note | **Whole-state read/write + full re-projection per mutation** is the core scalability ceiling (§3). | `store.ts`, `persistence-projection.ts` | Architectural watch-item, not a bug. |

---

## 9. Strengths
Disciplined multi-tenant schema (`workspaceId` + composite indexes everywhere); pervasive `AuditLog`; real cryptography done correctly (scrypt, HMAC-signed sessions, AES-256-GCM vault with AAD + checksum, timing-safe compares throughout); account lockout; webhook HMAC + idempotency; compliance-by-design (lawful basis, consent, DSAR, retention, suppression, recording consent); idempotent provider jobs with a usage / cost ledger; clean layering, strict typing, near-zero tech-debt markers, and solid unit-test discipline.

---

## 10. How to verify these findings
- **Risk #1:** open `app/actions.ts:721-873` and compare with `createOpportunityAction` (`:620-636`).
- **Risk #2:** `provider-secret-vault.ts:166-170` & `webhooks.ts:56-58` vs `auth-security.ts:124-135`.
- **Secrets-encrypted (correction):** `provider-secret-vault.ts:125-164`.
- **Persistence model:** `store.ts` (`writeStateToPrisma` / `readState`) + `persistence-projection.ts`.
- **Build / test baseline (read-only):** `npm run typecheck`, `npm test` (vitest), `npm run test:e2e` (Playwright).
