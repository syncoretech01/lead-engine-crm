# Phase 6 Database Cutover

Updated: 2026-06-26

## Goal

Phase 6 moves Syncore from snapshot-first persistence toward normalized Prisma/PostgreSQL as the production business data source. The local snapshot system is still retained for demo/offline/debug compatibility, but production storage must use Prisma.

## What Is Now In Place

- Prisma migration history starts at `prisma/migrations/20260616000000_baseline_normalized_schema`.
- `prisma/migrations/migration_lock.toml` locks the provider to PostgreSQL.
- `npm run db:bootstrap` runs Prisma generation, production-safe migration deploy, and normalized seed.
- `npm run db:seed` writes seeded workspace data into normalized Prisma tables.
- `npm run db:migrate:status` checks migration status.
- `npm run prisma:validate` validates the schema.
- Production blocks implicit or explicit file storage unless `SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION=true`.
- The normalized projection now covers the main lead, CRM, SDR, outreach, compliance, reporting, provider, AI, and audit tables.
- The remaining helper domains now have normalized projection coverage too: export rules, provider cache entries, async job logs/idempotency rows, dedupe matches, webhook receipts, waterfall templates, field provenance, and provider daily metrics.
- Major server actions declare scoped normalized table writes through `normalizedTables`.

## Local Commands

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
```

For a one-command local bootstrap against PostgreSQL:

```bash
npm run db:bootstrap
```

To include the compatibility snapshot during seed:

```bash
npm run db:seed -- --snapshot
```

or:

```bash
SYNCORE_SEED_SNAPSHOT=true npm run db:seed
```

## Production Environment

Required:

```bash
DATABASE_URL="postgresql://..."
SYNCORE_STORAGE_DRIVER="prisma"
```

Do not enable file storage in production. `SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION=true` exists only as an emergency/demo escape hatch and should not be used for real customer data.

## Staging Migration Process

1. Create or refresh the staging database.
2. Set `DATABASE_URL` and `SYNCORE_STORAGE_DRIVER=prisma`.
3. Run `npm ci`.
4. Run `npm run prisma:validate`.
5. Run `npm run prisma:generate`.
6. Run `npm run prisma:migrate:deploy`.
7. Run `npm run db:seed` only for demo/staging seed data, not for an existing customer dataset.
8. Run `npm run typecheck`.
9. Run `npm run test`.
10. Smoke test the Lead Engine, CRM, SDR, Developer, exports, integrations, and compliance screens.

## Production Migration Process

1. Take a database backup or provider snapshot.
2. Deploy the app image/build that contains the migration files.
3. Run `npm run prisma:validate`.
4. Run `npm run prisma:generate`.
5. Run `npm run prisma:migrate:deploy`.
6. Start the web app with `SYNCORE_STORAGE_DRIVER=prisma`.
7. Run a read-only smoke test for dashboard, Lead Engine, CRM, reports, exports, integrations, and compliance.
8. Run one low-risk write in staging before allowing production writes for the same release.

## Rollback Plan

Application rollback:

1. Stop the new app release.
2. Redeploy the previous app release.
3. Keep the migrated database only if the previous release is schema-compatible.

Database rollback:

1. Stop app writes.
2. Restore the database backup/snapshot taken before migration.
3. Redeploy the matching previous app release.
4. Run smoke tests before reopening traffic.

Do not use destructive Prisma commands such as `migrate reset` on production. Use `prisma migrate resolve` only when an operator intentionally marks a migration state after manual verification.

## Snapshot Policy

`AppStateSnapshot` remains as a compatibility cache for:

- Local file demo mode.
- Offline sample mode.
- Debug export/recovery.
- Transition safety while direct Prisma read/write coverage expands.

Production should treat normalized Prisma tables as the business data boundary. New production features should add normalized models, scoped write tables, and Prisma-first reads instead of adding snapshot-only fields.

## Snapshot-Only Compatibility Status

The production cutover bridge no longer has known business-critical snapshot-only helper domains. The following state arrays are now covered by dedicated normalized tables and scoped write paths:

- Export rule configuration.
- Provider cache entries.
- Async job observability helper rows outside provider jobs.
- Dedupe match helper rows.
- Webhook event receipts/debug rows.
- Waterfall templates.
- Field provenance rows.
- Provider daily metrics.

`AppStateSnapshot` is still retained for local/demo/debug compatibility. New production features should continue to add normalized Prisma models and scoped write tables before storing new customer-facing state.
