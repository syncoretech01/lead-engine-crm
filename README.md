# Syncore Lead Engine & CRM

An MVP scaffold for the lead acquisition engine and Salesforce-style CRM described in `C:\Users\LENOVO\Desktop\lead-engine-crm Final.md`.

## What is included

- Next.js + TypeScript app shell
- Locked production architecture decisions in `docs/PRODUCTION_ARCHITECTURE.md`
- Operational command center
- Prisma/PostgreSQL persistence: an AppState snapshot plus a normalized-table projection sync
- Demo workspace, users, roles, RBAC checks, and audit logs
- Search Profile CRUD and Lead Job creation
- CSV upload with field mapping, raw staging, normalization, suppression checks, and dedupe
- Data quality workspace with verification history and duplicate candidates
- Phase 3 enrichment workspace with provider cache, waterfall, segment rules, and explainable scoring
- Phase 4 CRM workspace with account/contact pages, opportunities, timelines, notes, tasks, manual call logs, and custom fields
- Phase 5 SDR operations with lead assignment, queue views, SLA timers, reminders, manager dashboard, and reassignment rules
- Phase 6 outreach tracking with local email plus RingCentral Local SMS/voice providers, campaigns, sequences, events, bounce/unsubscribe handling, SMS opt-outs, and call recording metadata
- Phase 7 reporting and compliance with admin dashboards, source/SDR/campaign performance, deliverability health, pipeline reports, retention workflows, compliance evidence, and audit history
- Phase 8 AI and advanced automation with local AI personalization, reply classification, call summaries, predictive lead scoring, ICP recommendations, deliverability advice, revenue attribution insights, and automation run history
- Suppression management that immediately re-verifies affected contacts
- Export rules for grade/status/score/role/catch-all/phone gates
- CRM accounts, contacts, and opportunity pipeline pages created from golden company/contact records
- CSV export generation and download routes
- Compliance controls, suppression summary, retention defaults, and audit history
- Prisma PostgreSQL schema for the first build slice plus a normalized persistence projection for core lead, CRM, outreach, compliance, and audit records

## Run locally

Postgres is required — the file storage driver was removed with the blob migration,
and `SYNCORE_STORAGE_DRIVER=file` now throws on startup rather than silently falling
back. `docker-compose.dev.yml` provides the local database.

```bash
docker compose -f docker-compose.dev.yml up -d
npm install
cp .env.example .env          # set DATABASE_URL to the compose database
npm run db:bootstrap          # prisma generate + migrate deploy + seed
npm run dev
```

Note that `next dev` is memory-hungry; if it thrashes, build once and run the
production server instead (`npm run build && npm start`).

## Production persistence

The Prisma schema is in `prisma/schema.prisma`. For PostgreSQL-backed persistence, create a local `.env` from `.env.example`, set `DATABASE_URL`, and set `SYNCORE_STORAGE_DRIVER="prisma"`.

```bash
copy .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
npm run dev
```

For a one-command PostgreSQL bootstrap, use `npm run db:bootstrap`.

Prisma writes mirror a normalized projection into tables for workspace/user membership, provider connections/jobs/usage, search profiles, jobs, raw and normalized leads, companies, contacts, verification/enrichment results, segments/scores, CRM accounts/contacts, opportunities, CRM activities/tasks/notes/call logs, SDR assignments/reminders, exports, suppressions, outreach providers/campaigns/sequences/steps, email events, SMS events, tracked calls, reports, retention, compliance, AI automation outputs, and audit logs. Contact/account list/detail reads, CRM event reads, outreach event reads, export reads, and compliance/reporting reads can prefer normalized Prisma rows when Prisma storage is active. Major write paths now request scoped normalized table writes in the same Prisma transaction while preserving the snapshot compatibility layer.

Before using a production database, create the database, set `DATABASE_URL`, then run:

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
```

`SYNCORE_STORAGE_DRIVER="prisma"` is the only accepted value — there is no file-storage fallback to disable. See `docs/PHASE_6_DATABASE_CUTOVER.md` for the staging, production, seed, and rollback process.

## Production architecture direction

Production runs on AWS: one EC2 instance behind Caddy plus RDS PostgreSQL (`docs/AWS_MIGRATION.md`, `deploy/aws/`). Telephony/SMS is RingCentral and transactional email is Amazon SES, both live. Cold outbound is owned by Mailshake, not this repo (`CLAUDE.md` anti-scope). Background jobs run in an in-process worker, not Redis (`docs/BACKGROUND_JOBS.md`).

`docs/PRODUCTION_ARCHITECTURE.md` predates the AWS migration and names components this repo does not use; `CLAUDE.md` and `docs/AWS_MIGRATION.md` are authoritative where they disagree.

## Session and RBAC

The app uses first-party production auth with hashed passwords, signed `syncore_auth_session` cookies, server-side session records, workspace membership, and role permissions. Seeded **local/CI** users sign in with `Syncore!2026`; the owner/developer account is `nora@syncore.tech`. That password only ever exists in `createSeedState`/`db:seed` — accounts created by an import or an ops script are backfilled locked (status `Invited`, unusable hash) and are activated by an admin setting a password at `/access`. Pages, API routes, server actions, navigation, export downloads, provider jobs, signed webhooks, and generated file paths are scoped to the authenticated workspace and role permissions. See `docs/PHASE_7_PRODUCTION_AUTH.md` and `docs/PHASE_8_TENANT_ISOLATION.md`.

## Async Job Observability

Lead jobs now track structured source runs, provider run IDs, idempotency keys, retry attempts, checkpoints, and job logs. CSV imports use a deterministic request hash from the workspace, source, mapping, and CSV content, so replaying the same import reuses the prior job instead of inserting duplicate raw records.

## Signed Webhooks

Provider webhooks post to `/api/webhooks/email` and `/api/webhooks/sms`. Requests must include `X-Syncore-Signature`, an HMAC-SHA256 signature of the raw JSON body using `SYNCORE_WEBHOOK_SECRET`, and a signed payload `workspaceId`. Accepted webhook events are stored with provider event IDs and idempotency keys; duplicate webhook deliveries return duplicate status and do not replay suppression or outreach side effects.

## Test baseline

```bash
npm run lint
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
