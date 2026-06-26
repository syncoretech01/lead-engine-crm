# Persistence Hardening

Updated: 2026-06-26

## Current State

The app keeps `AppStateSnapshot` as a local/demo/debug compatibility layer. When `SYNCORE_STORAGE_DRIVER=prisma` is enabled, production writes mirror normalized rows into Prisma tables, and the major server action groups request table-scoped normalized writes inside the same Prisma transaction.

Mirrored tables currently include:

- Workspace, user, and workspace membership rows
- Provider connection metadata, encrypted credential rows, and credential audit rows
- Provider execution job, run, usage ledger, daily metric, async job run, job log, and idempotency rows
- Search profiles, lead jobs, raw leads, normalized records, dedupe matches, export rules, and generated exports
- Companies, contacts, field provenance, verification results, enrichment results, provider cache entries, segments, record segments, lead scores, CRM accounts, CRM contacts, opportunities, activities, tasks, notes, call logs, custom fields, SDR teams, SDR assignments, follow-up reminders, reassignment rules, and suppression records
- Outreach providers, outreach campaigns, campaign sequences, sequence steps, email events, SMS events, webhook receipts, and tracked calls
- Report snapshots, retention policies/runs, compliance checklist items, data subject requests, deliverability alerts, AI automation outputs, and audit logs
- Waterfall templates and their JSON step definitions

## Verification

Projection coverage lives in `lib/phase1/persistence-projection.ts`.

Unit coverage verifies:

- Projection row counts match seeded app state
- Compliance fields are present in normalized contact, sequence, and call rows
- CRM event, outreach event, and export read adapters preserve workspace isolation when replacing snapshot rows
- Selected write paths can request only the normalized tables they touch, avoiding a full projection sync for lead generation, enrichment, CRM, SDR, outreach, reporting, compliance, AI, provider, export, and webhook writes
- Projection hashes are deterministic for a given state
- Prisma-style delegates receive mirrored delete/upsert calls
- Provider connection and encrypted credential tables mirror credential lifecycle state without storing raw plaintext credentials
- Provider job/run tables mirror future provider execution state, local worker leases, retry state, and mock execution results for extraction, verification, enrichment, sending, and webhook sync
- Export rule, provider cache, async job observability, dedupe match, webhook receipt, waterfall template, field provenance, and provider metric arrays are included in the normalized projection

Run:

```bash
npm run typecheck
npm run test
```

## Manual Database Step Later

When ready to use a real PostgreSQL database, create the database and set `DATABASE_URL` in `.env`. Then run:

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
```

For a complete Prisma bootstrap, use:

```bash
npm run db:bootstrap
```

See `docs/PHASE_6_DATABASE_CUTOVER.md` for the staging, production, and rollback process.

## Remaining Cutover Work

The normalized tables are now populated as the production cutover bridge. Contact and account list/detail read paths can prefer normalized Prisma `Contact` and `Company` rows when `SYNCORE_STORAGE_DRIVER=prisma`, with snapshot fallback for local/demo storage and empty legacy projections. Compliance, reporting, CRM event, outreach event, and export reads can also prefer normalized rows.

Scoped normalized writes are in place for generated export records, lead generation actions, verification, enrichment/scoring, CRM records, SDR assignment workflows, outreach setup/events/sending, signed email/SMS webhook processing, reporting/retention, compliance/DSR, AI automation outputs, provider connection settings, and provider job execution. These paths still update the snapshot for compatibility, but Prisma mode now syncs only the relevant normalized tables in the same transaction.

Provider connection metadata, encrypted credential records, credential audit tables, provider execution job/run/usage/metric tables, export rules, provider cache entries, async job logs/idempotency records, dedupe matches, webhook receipts, waterfall templates, and field provenance rows are included in the normalized projection and scoped write services.

No known production business-data domains remain intentionally snapshot-only. The snapshot remains in place for local/demo/debug compatibility and transitional recovery only.
