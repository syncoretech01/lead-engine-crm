# Persistence Hardening

Updated: 2026-06-10

## Current State

The app still uses `AppStateSnapshot` as the broad compatibility source of truth. When `SYNCORE_STORAGE_DRIVER=prisma` is enabled, snapshot writes mirror normalized rows into core Prisma tables. The first selected write paths now request table-scoped normalized writes inside the same Prisma transaction.

Mirrored tables currently include:

- Workspace, user, and workspace membership rows
- Provider connection metadata and credential audit rows
- Search profiles, lead jobs, raw leads, and normalized records
- Companies, contacts, CRM accounts, CRM contacts, opportunities, activities, tasks, notes, call logs, and suppression records
- Exports, outreach campaigns, campaign sequences, sequence steps, email events, SMS events, and tracked calls
- Data subject requests and audit logs

## Verification

Projection coverage lives in `lib/phase1/persistence-projection.ts`.

Unit coverage verifies:

- Projection row counts match seeded app state
- Compliance fields are present in normalized contact, sequence, and call rows
- CRM event, outreach event, and export read adapters preserve workspace isolation when replacing snapshot rows
- Selected write paths can request only the normalized tables they touch, avoiding a full projection sync for export generation and outreach event/webhook writes
- Projection hashes are deterministic for a given state
- Prisma-style delegates receive mirrored delete/upsert calls
- Provider connection tables mirror metadata without storing raw credentials

Run:

```bash
npm run typecheck
npm run test
```

## Manual Database Step Later

When ready to use a real PostgreSQL database, create the database and set `DATABASE_URL` in `.env`. Then run:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

For local development without migration history, use:

```bash
npm run prisma:push
```

## Remaining Cutover Work

The normalized tables are now populated as a mirror. Contact and account list/detail read paths can prefer normalized Prisma `Contact` and `Company` rows when `SYNCORE_STORAGE_DRIVER=prisma`, with snapshot fallback for local/demo storage and empty legacy projections. Compliance, reporting, CRM event, outreach event, and export reads can also prefer normalized rows.

The first write-path cutover slice is in place for generated export records, manual outreach email/SMS/call events, campaign send simulation, and signed email/SMS webhook processing. These paths still update the snapshot for compatibility, but Prisma mode now syncs only the relevant normalized tables in the same transaction.

Provider connection metadata tables are now included in the normalized projection. The next persistence step is to add server-only provider connection write services, then continue the selected write-path cutover for CRM opportunities, tasks, notes, call logs, compliance requests, and report/retention actions. Production database migrations, backup/restore checks, and tenant/session tests should follow that write-path work.
