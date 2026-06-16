# Current Codebase Review

Updated: 2026-06-16

## Current Architecture

Syncore Lead Engine CRM is a Next.js and TypeScript local MVP. The app uses server-rendered pages, server actions, API routes, Prisma schema definitions, Vitest unit tests, and Playwright smoke tests. Most business logic lives in `lib/phase1`, while UI routes live under `app`.

The active compatibility source of truth is still `AppStateSnapshot`. In file mode, state is stored in `.syncore-data/store.json`. In Prisma mode, the app stores the snapshot in PostgreSQL and mirrors selected normalized rows into Prisma tables for lead, CRM, outreach, compliance, export, reporting, and audit reads.

## Local And Demo Systems

- CSV import simulates lead ingestion and source staging.
- Local normalization, dedupe, verification, enrichment, scoring, routing, outreach, reporting, retention, and AI automation run without external services.
- Outreach providers are local placeholders for Syncore Mail Local and RingCentral Local SMS/voice behavior.
- Webhooks are signed with a Syncore HMAC scheme for local testing.
- RBAC/session behavior uses cookies or environment-selected demo users.
- Brand assets and Syncore UI styling are included locally.

## Real Production Gaps

- No real provider adapters are connected yet for Apollo, Google Places, Apify, Hunter, ZeroBounce, Lusha, People Data Labs, Twilio Lookup, RingCentral, Smartlead, or Amazon SES.
- No production identity provider is wired.
- Provider job/run records and a local mock worker queue exist for extraction, enrichment, verification, sending, and webhook sync. No real provider network execution is active yet.
- Provider connection metadata, encrypted database secret records, secret-reference fields, credential audit tables, server-only management services, and an admin Integration Center UI shell exist. Managed KMS/secret-store integration is not implemented yet.
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
- Provider connection metadata, encrypted credential rows, and credential audit rows are now represented in `AppStateSnapshot`, Prisma tables, normalized projection sync, server-only save/test/disable services, and an admin UI shell.

Still needed:

- Direct transactional normalized writes for CRM opportunities, tasks, notes, call logs, compliance requests, and retention/reporting actions.
- Migration path from snapshot-first writes to normalized-table-first writes.
- PostgreSQL backup/restore checks and production migration workflow.

## Provider Simulation Status

Current provider behavior is intentionally local:

- CSV upload stands in for lead ingestion.
- Local heuristics stand in for email verification and enrichment.
- Local email/SMS/voice provider records stand in for outbound event capture.
- Provider execution jobs/runs and the local worker can claim queued work, lease runs, recover expired locks, queue due retries, and complete mock execution without making network calls.
- Provider adapter contract fixtures and no-network contract tests exist for the selected provider strategy.
- The selected production provider lanes are Apollo, Google Places, Apify, Hunter, ZeroBounce, Lusha, People Data Labs, Twilio Lookup for phone validation, RingCentral for telephony/SMS, Smartlead for cold outbound email, and Amazon SES for transactional app email.
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
- Managed KMS/secret-store integration and production credential rotation operations.
- Workspace-level provider connection permissions.
- Credential rotation and audit evidence.
- Provider-native webhook verification and replay-window checks.

## Testing Status

Current tests cover:

- Unit tests for auth/RBAC, storage driver validation, projection sync, read-path adapters, verification/export rules, compliance, retention, webhooks, job idempotency, provider job/worker execution, provider adapter contracts, enrichment/reporting/AI logic, and workspace isolation.
- Playwright smoke tests across the main app routes and SDR-scoped navigation.

Still needed:

- Production database migration tests.
- Tenant-isolation E2E against Prisma mode.
- Credential lifecycle and webhook replay-window tests.

## Immediate Next Build Order

1. Cut over CRM/compliance/reporting write paths to selected normalized transactions.
2. Add managed KMS/secret-store support or rotate away from the local encryption key path before production.
3. Add real provider adapters one at a time behind feature flags and contract tests, starting with Twilio Lookup/RingCentral/Smartlead only after credentials and compliance review are ready.
4. Add production auth and signed session management.
5. Add production migration, backup/restore, tenant-isolation, and deployment checks.
