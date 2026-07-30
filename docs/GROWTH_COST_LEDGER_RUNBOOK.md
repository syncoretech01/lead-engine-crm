# Growth OS financial-ledger inventory and rollout runbook

ADR-001 Option C is binding. `CostEntry` is the authoritative Growth financial-control ledger;
`ProviderUsageLedger` remains AppState-projected operational evidence. This runbook covers the
additive Wave 1 Step 1.4B foundation only. It does not authorize provider dispatch, paid execution,
the full campaign budget gate, or spend-exception orchestration.

## Read-only inventory

The inventory command opens a PostgreSQL `REPEATABLE READ`, `READ ONLY` transaction. It never
prints `DATABASE_URL`, never writes a row, and is safe to repeat. `--json` emits machine-readable
output. Exit code `2` means structural hazards were found; exit code `64` means invocation or
environment configuration is invalid.

Local or integration PostgreSQL:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@localhost:5432/lead_engine_crm"
npm run growth:ledger:inventory -- --environment local --json
```

Staging and production use the same command with an operator-supplied, preferably read-only,
database credential. Never paste the URL into an issue, PR, log, or tracker.

```bash
DATABASE_URL="$STAGING_READ_ONLY_URL" npm run growth:ledger:inventory -- --environment staging --json
DATABASE_URL="$PRODUCTION_READ_ONLY_URL" npm run growth:ledger:inventory -- --environment production --json
```

The report includes row counts, workspace/status/provider/action groups, currencies, missing
attribution, duplicate identities, orphan and tenant mismatches, metadata-size warnings, timestamps,
provider job/run references, and exact cross-store matches based only on explicit IDs. It never
infers or assigns Campaign, stage, Approval, authorization, or cost-action identity.

Do not deploy when `safeToProceed` is false. Investigate the named hazard, preserve the affected
rows, and approve a forward repair. Duplicate candidates and unattributed history must not be
silently collapsed or backfilled.

## Deployment order

1. Take and verify the normal pre-deployment PostgreSQL backup/snapshot.
2. Run the inventory against staging and production before migration; save the redacted JSON as a
   deployment artifact.
3. Confirm all existing currencies, duplicate candidates, orphans, and cross-workspace references
   have an explicit disposition. Do not guess historical attribution.
4. Deploy migration `20260730190000_growth_os_cost_entry_foundation` with:

   ```bash
   npm run prisma:migrate:deploy
   ```

5. Deploy the application. The application may read and append foundation events, but no paid
   writer or dispatch is enabled by Step 1.4B.
6. Re-run the inventory and compare row counts with the preflight artifact.
7. Run Prisma validation/generation, projection invariant, focused PostgreSQL financial tests, and
   normal application smoke checks.
8. Keep paid execution disabled until a separately approved budget gate, reservation/release,
   reconciliation, overrun, and `SPEND_EXCEPTION` implementation is deployed and validated.

## Additive compatibility

The migration preserves all existing columns and rows. New financial-event fields are nullable at
the database level so pre-foundation `CostEntry` rows remain byte-for-byte unattributed; the new
repository requires the complete event identity for every new write. No `ProviderUsageLedger`
column, ownership rule, AppState mapping, cleanup, or writer changes.

PostgreSQL `NOT VALID` tenant constraints enforce new native Campaign, stage, Approval, and
Research links without claiming that un-inventoried historical rows already passed validation.
Operational provider job/run/evidence IDs deliberately are not foreign keys: those rows remain
projection-owned and may be removed by legacy cleanup. The repository validates their existence,
workspace, parent job, provider, and evidence identity inside the financial transaction, while the
immutable financial event retains the stable operational ID if the evidence is later projected
away.

## Application rollback

1. Disable any newly introduced financial command producer. Step 1.4B itself introduces no paid
   producer.
2. Deploy the prior application release.
3. Leave the additive enums, columns, indexes, constraints, and new financial rows in place. The
   prior application ignores nullable additions.
4. Re-run the inventory and reconcile every financial event recorded before rollback.
5. Use a forward fix for defects. Do not update/delete financial facts, remove additive schema in
   an emergency, copy financial events into `ProviderUsageLedger`, or guess attribution.

A physical database restore is a separate incident decision. If one is required, stop writes,
restore the matching pre-deployment snapshot, and reconcile any immutable events created after the
restore point from authoritative source events before service resumes.

## Reconciliation checks

- Pre- and post-migration row counts match for both physical stores.
- Historical `CostEntry.eventKind`, currency, command, and source identities remain null unless an
  independently approved evidence-backed repair was performed.
- New command and source identities are unique within their defined scope.
- No mixed-currency aggregate is emitted.
- Campaign/stage totals count only `CostEntry` actuals, adjustments, and reversals.
- Provider evidence is labelled operational and contributes zero authoritative spend.
- Projection sync can delete projected provider evidence without deleting `CostEntry`.
- `CampaignStageRun` cost columns remain reconstructible caches, not the source of truth.

## Gates still outstanding

Staging and production row inventory, live deployment evidence, reservation/release semantics,
refund/credit/tax behavior, exact authorization-to-dispatch wiring, cost-cache replay, campaign
budget gates, overrun handling, and paid-provider integrations remain separate work. None is implied
by a successful Step 1.4B migration.
