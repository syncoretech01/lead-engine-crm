# Current Codebase Review

Updated: 2026-06-10

## Current Architecture

Syncore Lead Engine CRM is a Next.js and TypeScript local MVP. The app uses server-rendered pages, server actions, API routes, Prisma schema definitions, Vitest unit tests, and Playwright smoke tests. Most business logic lives in `lib/phase1`, while UI routes live under `app`.

The active compatibility source of truth is still `AppStateSnapshot`. In file mode, state is stored in `.syncore-data/store.json`. In Prisma mode, the app stores the snapshot in PostgreSQL and mirrors selected normalized rows into Prisma tables for lead, CRM, outreach, compliance, export, reporting, and audit reads.

## Local And Demo Systems

- CSV import simulates lead ingestion and source staging.
- Local normalization, dedupe, verification, enrichment, scoring, routing, outreach, reporting, retention, and AI automation run without external services.
- Outreach providers are local placeholders for email and RingCentral-style SMS/voice behavior.
- Webhooks are signed with a Syncore HMAC scheme for local testing.
- RBAC/session behavior uses cookies or environment-selected demo users.
- Brand assets and Syncore UI styling are included locally.

## Real Production Gaps

- No real provider adapters are connected yet.
- No production identity provider is wired.
- No background worker queue is active for extraction, enrichment, verification, or campaign sync.
- Provider connection metadata, secret-reference fields, credential audit tables, server-only management services, and an admin Integration Center UI shell exist. Raw secret encryption/KMS storage is not implemented yet.
- No provider-native webhook signature validation exists yet.
- No production object storage path is active for recordings, exports, or attachments.
- No production migration, backup, restore, or tenant-isolation test lane exists yet.

## Persistence Status

Implemented:

- Local file persistence.
- Prisma `AppStateSnapshot` persistence.
- Normalized projection sync to core Prisma tables.
- Normalized read paths for contacts, accounts, CRM events, outreach events, exports, compliance rows, and reporting inputs.
- Scoped normalized write sync for generated exports, outreach event creation, campaign send simulation, and signed email/SMS webhook processing.
- Provider connection metadata and credential audit rows are now represented in `AppStateSnapshot`, Prisma tables, normalized projection sync, server-only save/test/disable services, and an admin UI shell.

Still needed:

- Direct transactional normalized writes for CRM opportunities, tasks, notes, call logs, compliance requests, retention/reporting actions, and provider execution state.
- Migration path from snapshot-first writes to normalized-table-first writes.
- PostgreSQL backup/restore checks and production migration workflow.

## Provider Simulation Status

Current provider behavior is intentionally local:

- CSV upload stands in for lead ingestion.
- Local heuristics stand in for email verification and enrichment.
- Local email/SMS/voice provider records stand in for outbound event capture.
- Local webhook processing tests idempotency and suppression side effects.

Real provider work should start only after the typed provider abstraction, credential model, provider job model, and no-network contract tests are stable.

## Auth And Security Status

Implemented:

- Role definitions and permission checks.
- Workspace-scoped session selection via cookies or environment defaults.
- Page, action, API route, and navigation gating.
- Audit logs for critical local actions.
- Signed local webhook validation.

Still needed:

- Production authentication and session signing.
- SSO/OIDC/SAML provider integration.
- Raw API-key encryption, KMS/secret-store integration, and credential rotation flows.
- Workspace-level provider connection permissions.
- Credential rotation and audit evidence.
- Provider-native webhook verification and replay-window checks.

## Testing Status

Current tests cover:

- Unit tests for auth/RBAC, storage driver validation, projection sync, read-path adapters, verification/export rules, compliance, retention, webhooks, job idempotency, enrichment/reporting/AI logic, and workspace isolation.
- Playwright smoke tests across the main app routes and SDR-scoped navigation.

Still needed:

- Provider adapter contract tests with recorded fixtures.
- Production database migration tests.
- Background worker and retry-lock tests.
- Tenant-isolation E2E against Prisma mode.
- Credential lifecycle and webhook replay-window tests.

## Immediate Next Build Order

1. Add raw API-key encryption or managed secret-store integration behind the provider connection metadata.
2. Add provider job/run records for extraction, verification, enrichment, sending, and webhook sync.
3. Cut over CRM/compliance/reporting write paths to selected normalized transactions.
4. Add background worker queue support for provider jobs.
5. Add real provider adapters one at a time behind feature flags and contract tests.
6. Add production auth and signed session management.
7. Add production migration, backup/restore, tenant-isolation, and deployment checks.
