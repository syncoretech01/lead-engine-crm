# M0 — Internal Go-Live Runbook

Created: 2026-06-18

Goal: get the real team (owner/developer = Admin, 1 Manager, 4 SDRs) logging into a
**hosted** Syncore instance backed by **managed PostgreSQL with backups**, on real
data, with **no demo data and no live provider calls yet**. The CRM, SDR queues, and
manual 1:1 outreach all work today on simulated providers — this milestone is about
hosting, durability, and real scoped logins. Live providers come later (M2/M3).

This runbook ties together the existing decision docs:
[`PHASE_6_DATABASE_CUTOVER.md`](PHASE_6_DATABASE_CUTOVER.md),
[`PHASE_7_PRODUCTION_AUTH.md`](PHASE_7_PRODUCTION_AUTH.md),
[`SECRETS_AND_CREDENTIALS_PLAN.md`](SECRETS_AND_CREDENTIALS_PLAN.md),
[`PRODUCTION_ARCHITECTURE.md`](PRODUCTION_ARCHITECTURE.md), and
[`.env.example`](../.env.example).

---

## 0. What you procure (gates everything below)

- **Managed PostgreSQL** (e.g. Neon, Supabase, RDS, Railway) with **automated backups** enabled.
- **App hosting** (Vercel or AWS App Runner) that can reach the database and lets you restrict access (password protection, IP allowlist, or VPN).

No provider API keys are needed for M0.

---

## 1. Generate production secrets

```bash
npm run generate-secrets
```

This prints fresh, high-entropy values for:

- `SYNCORE_AUTH_SECRET` — signs the `syncore_auth_session` cookie.
- `SYNCORE_WEBHOOK_SECRET` — provider webhook HMAC (not exercised in M0, but required so prod guards don't throw).
- `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` — AES-256-GCM key material for the provider secret vault.
- `SYNCORE_CREDENTIAL_KEY_ID` — a rotation label.

Store them in the **hosting provider's secret manager**, never in git. (`.env*` is gitignored.)

## 2. Set the production environment

Set these in the hosting env (see [`.env.example`](../.env.example) for the full list):

```bash
NODE_ENV="production"
SYNCORE_STORAGE_DRIVER="prisma"
DATABASE_URL="postgresql://…"          # from your managed Postgres
SYNCORE_AUTH_SECRET="…"                # from step 1
SYNCORE_WEBHOOK_SECRET="…"             # from step 1
SYNCORE_CREDENTIAL_ENCRYPTION_KEY="…"  # from step 1
SYNCORE_CREDENTIAL_KEY_ID="…"          # from step 1
```

**Must NOT be set in production** (these enable the demo bypass and would weaken auth):

```bash
SYNCORE_ALLOW_DEMO_SESSION       # leave unset → only signed sessions are honored
SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION
SYNCORE_SESSION_USER_ID
SYNCORE_SESSION_WORKSPACE_ID
```

With `NODE_ENV=production`, session cookies are automatically marked `secure`
(see `authCookieOptions` in `lib/phase1/auth-security.ts`). The storage-driver,
auth-secret, webhook-secret, and credential-key guards all **throw at runtime in
production** if their secret is missing — so a misconfigured deploy fails loudly
rather than silently falling back to dev defaults.

## 3. Migrate the database (schema only)

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

> ⚠ Do **not** run `npm run db:bootstrap` or `npm run db:seed` for go-live — those load
> the **demo** dataset (`createSeedState`). Use the provisioning step below instead.

## 4. Provision the real workspace + 6 scoped logins

1. Copy the template and fill in your real workspace and team (PII — the real file is gitignored):

   ```bash
   cp scripts/provisioning/accounts.example.json scripts/provisioning/accounts.json
   ```

   Roles map to scopes already defined in `permissionsByRole` (`lib/phase1/auth.ts`):
   `Admin` (owner/developer, mark `"superadmin": true`), `Manager`, and `SDR` ×4.
   Other valid roles if you need them: `Data Operator`, `Compliance Admin`, `Viewer`.

   Omit `password` to have a strong one generated per account; or set one explicitly.

2. Provision (this writes the authoritative `AppStateSnapshot` + normalized projection):

   ```bash
   # Preview first — builds the state and prints credentials, writes nothing:
   npm run db:provision -- --config scripts/provisioning/accounts.json --dry-run

   # Then for real:
   npm run db:provision -- --config scripts/provisioning/accounts.json
   ```

   - The script **refuses to overwrite existing state** unless you pass `--force` (use only on a fresh database).
   - It prints each login's password **once** — distribute over a secure channel; users change it on first login.

> **Ordering matters:** provision *before* anyone hits the app. On first read with no
> snapshot, the store would otherwise seed demo data. Provisioning writes the real
> snapshot so that never happens.

## 5. Deploy and lock down access

- Deploy the app to your host with the step-2 env set.
- Restrict access to the team: Vercel password protection / IP allowlist / VPN — whatever your host supports. M0 is internal-only.

## 6. Verify

- [ ] Each of the 6 users logs in at the hosted URL with their credentials.
- [ ] The owner (Admin/superadmin) sees full workspace; an SDR sees only their assigned book (record visibility is data-scoped, not just nav-gated).
- [ ] Create a contact / task / note as the team and reload — data persists in Postgres (check `prisma:studio` against `DATABASE_URL`).
- [ ] No demo records are present (no `@syncore.tech` users, no seeded companies/contacts).
- [ ] Hitting an app route while logged out redirects to `/login`.

## 7. Backup & restore drill (do once, before real use)

Managed Postgres automated backups are necessary but **untested until you restore one**.

```bash
# Capture a logical backup
pg_dump "$DATABASE_URL" -Fc -f syncore-backup.dump

# Restore into a scratch database and confirm the snapshot row + a table or two exist
createdb syncore_restore_test
pg_restore --no-owner -d "postgresql://…/syncore_restore_test" syncore-backup.dump
# psql: SELECT id, version FROM "AppStateSnapshot";  → expect 'syncore-primary-state'
```

Confirm your managed provider's point-in-time-restore is enabled and note the retention window.

---

## Exit criteria

All 6 roles log in on the hosted URL and see only what their scope allows; data persists
in Postgres; automated backups are enabled and a restore has been verified. At that point
the team can begin real CRM/SDR work on simulated providers, and you can move to **M1/M2**
(live providers) incrementally — see [`ROADMAP.md`](ROADMAP.md).

## Reference: scripts added for go-live

| Command | Purpose |
| --- | --- |
| `npm run generate-secrets` | Print fresh production secret values. |
| `npm run db:provision -- --config <path> [--dry-run] [--force]` | Provision a clean real workspace + scoped logins. |
| `scripts/provisioning/accounts.example.json` | Template for the (gitignored) real `accounts.json`. |
