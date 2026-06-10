# Syncore Lead Engine & CRM

An MVP scaffold for the lead acquisition engine and Salesforce-style CRM described in `C:\Users\LENOVO\Desktop\lead-engine-crm Final.md`.

## What is included

- Next.js + TypeScript app shell
- Locked production architecture decisions in `docs/PRODUCTION_ARCHITECTURE.md`
- Operational command center
- Configurable persistence with local file storage, Prisma/PostgreSQL state snapshots, and normalized-table projection sync
- Demo workspace, users, roles, RBAC checks, and audit logs
- Search Profile CRUD and Lead Job creation
- CSV upload with field mapping, raw staging, normalization, suppression checks, and dedupe
- Data quality workspace with verification history and duplicate candidates
- Phase 3 enrichment workspace with provider cache, waterfall, segment rules, and explainable scoring
- Phase 4 CRM workspace with account/contact pages, opportunities, timelines, notes, tasks, manual call logs, and custom fields
- Phase 5 SDR operations with lead assignment, queue views, SLA timers, reminders, manager dashboard, and reassignment rules
- Phase 6 outreach tracking with local email plus RingCentral-style SMS/voice providers, campaigns, sequences, events, bounce/unsubscribe handling, SMS opt-outs, and call recording metadata
- Phase 7 reporting and compliance with admin dashboards, source/SDR/campaign performance, deliverability health, pipeline reports, retention workflows, compliance evidence, and audit history
- Phase 8 AI and advanced automation with local AI personalization, reply classification, call summaries, predictive lead scoring, ICP recommendations, deliverability advice, revenue attribution insights, and automation run history
- Suppression management that immediately re-verifies affected contacts
- Export rules for grade/status/score/role/catch-all/phone gates
- CRM accounts, contacts, and opportunity pipeline pages created from golden company/contact records
- CSV export generation and download routes
- Compliance controls, suppression summary, retention defaults, and audit history
- Prisma PostgreSQL schema for the first build slice plus a normalized persistence projection for core lead, CRM, outreach, compliance, and audit records

## Run locally

```bash
npm install
npm run dev
```

Without `SYNCORE_STORAGE_DRIVER=prisma`, the app uses local file storage in `.syncore-data/store.json`.

## Production persistence

The Prisma schema is in `prisma/schema.prisma`. For PostgreSQL-backed persistence, create a local `.env` from `.env.example`, set `DATABASE_URL`, and set `SYNCORE_STORAGE_DRIVER="prisma"`.

```bash
copy .env.example .env
npm run prisma:generate
npm run prisma:push
npm run dev
```

The first Prisma-backed app read creates the `AppStateSnapshot` row. If `.syncore-data/store.json` already exists, that state is used as the initial PostgreSQL snapshot; otherwise the seeded Syncore workspace is created.

Prisma writes also mirror a normalized projection into core tables for workspace/user membership, search profiles, jobs, raw and normalized leads, companies, contacts, CRM accounts/contacts, opportunities, CRM activities/tasks/notes/call logs, exports, suppressions, outreach campaigns/sequences/steps, email events, SMS events, tracked calls, data subject requests, and audit logs. Contact/account list/detail reads, CRM event reads, outreach event reads, export reads, and compliance/reporting reads can now prefer normalized Prisma rows when Prisma storage is active. Generated exports, manual outreach email/SMS/call events, campaign send simulation, and signed email/SMS webhook processing now request scoped normalized table writes in the same Prisma transaction while preserving the snapshot compatibility layer.

Before using a production database, create the database, set `DATABASE_URL`, then run:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

For local schema iteration without a migration history yet, use `npm run prisma:push`.

## Production architecture direction

The selected production direction is documented in `docs/PRODUCTION_ARCHITECTURE.md`. In short: keep Next.js and Prisma/PostgreSQL, use RingCentral for telephony/SMS, use S3-compatible object storage for recordings/exports/attachments, add Redis-backed workers for async jobs, and defer OpenSearch/ClickHouse/Kafka/Kubernetes until measured scale requires them.

## Session and RBAC

The app resolves the active workspace session from `syncore_user_id` and `syncore_workspace_id` cookies. If those cookies are absent, it uses `SYNCORE_SESSION_USER_ID` and `SYNCORE_SESSION_WORKSPACE_ID`, then falls back to the seeded admin user/workspace. Pages, API routes, server actions, navigation, and export downloads are scoped to the resolved workspace and role permissions.

## Async Job Observability

Lead jobs now track structured source runs, provider run IDs, idempotency keys, retry attempts, checkpoints, and job logs. CSV imports use a deterministic request hash from the workspace, source, mapping, and CSV content, so replaying the same import reuses the prior job instead of inserting duplicate raw records.

## Signed Webhooks

Provider webhooks post to `/api/webhooks/email` and `/api/webhooks/sms`. Requests must include `X-Syncore-Signature`, an HMAC-SHA256 signature of the raw JSON body using `SYNCORE_WEBHOOK_SECRET`. Accepted webhook events are stored with provider event IDs and idempotency keys; duplicate webhook deliveries return duplicate status and do not replay suppression or outreach side effects.

## Test baseline

```bash
npm run typecheck
npm run test
npm run test:e2e
npm run test:all
```

`npm run test` runs Vitest unit coverage for core verification, export, dedupe, outreach, enrichment, reporting, AI, and retention logic. `npm run test:e2e` runs Playwright smoke coverage across the main app modules and shell navigation. The Playwright config reuses a local dev server at `http://127.0.0.1:3001` when one is already running.

On a new machine, install the Playwright browser once:

```bash
npx playwright install chromium
```

## Try the current build

Open `/staging`, upload `samples/phase1-import-sample.csv`, and keep the default field mapping values. The import creates a Lead Job, stores raw rows, normalizes records, dedupes companies/contacts, blocks suppressed records, creates verification history, and makes clean contacts available under `/crm/accounts` and `/exports`.

Use `/data-quality` to run verification and duplicate scans manually. Use `/enrichment` to run enrichment, manage segment rules, and inspect score explanations. Use `/crm/accounts`, `/crm/contacts`, and `/crm/opportunities` to work CRM records, tasks, notes, call logs, activity timelines, and custom fields. Use `/sdr/queue` and `/sdr/manager` for SDR assignment, SLA timers, reminders, workloads, and reassignment rules. Use `/outreach/campaigns` and `/outreach/events` for provider simulation, campaign/sequence tracking, email/SMS events, bounce/unsubscribe handling, and call recordings. The local telephony placeholder is now labeled `RingCentral Local` to match the production provider decision. Use `/reports` for admin dashboards and report snapshots, `/reports/compliance` for retention workflows, deliverability alerts, checklist evidence, and audit history, `/automation` for Phase 8 AI automations, and `/compliance` to add suppression records. Use `/exports` to create export rules and generate CSVs through those gates.
