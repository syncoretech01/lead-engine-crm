# M0 — Internal Go-Live Runbook (Neon + Vercel)

Created: 2026-06-18

Goal: get the real team (owner/developer = Admin, 1 Manager, 4 SDRs) logging into a
**hosted** Syncore instance backed by **managed PostgreSQL with backups**, on real
data, with **no demo data and no live provider calls yet**. The CRM, SDR queues, and
manual 1:1 outreach all work today on simulated providers — this milestone is about
hosting, durability, and real scoped logins. Live providers come later (M2/M3).

**Chosen stack: [Neon](https://neon.tech) (serverless Postgres) + [Vercel](https://vercel.com) (Next.js host).**
Cheapest at internal scale, fastest to launch, and fully portable — Neon is standard
Postgres and the app containerizes for AWS later if/when you go commercial SaaS (see
[ROADMAP.md](ROADMAP.md) Stage B and the shift triggers there).

Ties together: [`PHASE_6_DATABASE_CUTOVER.md`](PHASE_6_DATABASE_CUTOVER.md),
[`PHASE_7_PRODUCTION_AUTH.md`](PHASE_7_PRODUCTION_AUTH.md),
[`SECRETS_AND_CREDENTIALS_PLAN.md`](SECRETS_AND_CREDENTIALS_PLAN.md), and
[`.env.example`](../.env.example).

> The Prisma client is generated automatically on Vercel via the `postinstall`
> script (`prisma generate`) already wired into [`package.json`](../package.json) —
> no extra build config is required.

---

## Step 1 — Create the Neon database

1. **neon.tech** → sign up → **Create project** (region near your team).
2. From **Dashboard → Connection Details**, copy **both** connection strings:
   - **Pooled** (the default, host contains `-pooler`) → used by the app at runtime.
   - **Direct** (toggle off "Pooled connection") → used for migrations/provisioning.
3. **Settings → enable point-in-time restore / backups**; note the retention window.

Neon scales to zero when idle, so this costs ~$0–19/mo at internal scale.

## Step 2 — Generate production secrets (local)

```powershell
npm run generate-secrets
```

Copy the 4 printed values (`SYNCORE_AUTH_SECRET`, `SYNCORE_WEBHOOK_SECRET`,
`SYNCORE_CREDENTIAL_ENCRYPTION_KEY`, `SYNCORE_CREDENTIAL_KEY_ID`) for Step 4. Never
commit them — `.env*` is gitignored.

## Step 3 — Initialize the database from your machine

Run schema migration + real-account provisioning locally, pointed at the **direct**
Neon URL (migrations need a direct, non-pooled connection). In PowerShell, from the repo:

```powershell
$env:SYNCORE_STORAGE_DRIVER = "prisma"
$env:DATABASE_URL = "postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require"   # DIRECT url

npm run prisma:generate
npm run prisma:migrate:deploy
```

> Do **not** run `npm run db:bootstrap` / `db:seed` for go-live — those load the
> **demo** dataset. Use provisioning below instead.

Create your real team file (PII — the real `accounts.json` is gitignored) and provision:

```powershell
Copy-Item scripts/provisioning/accounts.example.json scripts/provisioning/accounts.json
# → edit accounts.json: real workspace name + 6 people
#   owner = "Admin" + "superadmin": true, manager = "Manager", four = "SDR"

npm run db:provision -- --config scripts/provisioning/accounts.json --dry-run   # preview, writes nothing
npm run db:provision -- --config scripts/provisioning/accounts.json             # writes the snapshot
```

The second command prints each login's password **once** — distribute securely; users
change it on first login. The script refuses to overwrite existing state without
`--force`. Provisioning **before** deploy guarantees the app reads your real workspace
(not auto-seeded demo data) on first request.

## Step 4 — Deploy to Vercel

1. **vercel.com → Add New → Project** → import `syncoretech01/lead-engine-crm`, branch `main`. Vercel auto-detects Next.js.
2. **Settings → Environment Variables** (scope: Production), add:

   | Name | Value |
   | --- | --- |
   | `SYNCORE_STORAGE_DRIVER` | `prisma` |
   | `DATABASE_URL` | Neon **pooled** URL + `?sslmode=require&pgbouncer=true` |
   | `SYNCORE_AUTH_SECRET` | from Step 2 |
   | `SYNCORE_WEBHOOK_SECRET` | from Step 2 |
   | `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` | from Step 2 |
   | `SYNCORE_CREDENTIAL_KEY_ID` | from Step 2 |

   Use the **pooled** URL here (serverless functions + `pgbouncer=true`). **Do NOT** add
   `SYNCORE_ALLOW_DEMO_SESSION`. Vercel sets `NODE_ENV=production` automatically, which
   also makes session cookies `secure` and activates the production secret guards
   (a missing secret fails the request loudly rather than falling back to a dev default).
3. **Deploy.**

## Step 5 — Lock access to your team

Vercel → **Settings → Deployment Protection** → enable **Password Protection** (or
Vercel Authentication / Trusted IPs). Internal-only for M0.

## Step 6 — Verify

- [ ] Each of the 6 people logs in at the Vercel URL with their password.
- [ ] Owner sees the full workspace; an SDR sees only their assigned records.
- [ ] Create a contact/task, reload → it persists (Neon SQL editor: `SELECT id, version FROM "AppStateSnapshot";` → one row `syncore-primary-state`).
- [ ] No demo records (no `@syncore.tech` users, no seeded companies/contacts).
- [ ] Logged out → app routes redirect to `/login`.

## Step 7 — Backup / restore drill (once)

Confirm restore actually works — automated backups are useless until you've restored one.

- In Neon, **create a branch from a past timestamp** (point-in-time restore) and query
  `AppStateSnapshot` on the branch to confirm the data is intact, then delete the test branch.
- Or capture a logical backup if you have Postgres client tools:
  ```powershell
  pg_dump "$env:DATABASE_URL" -Fc -f syncore-backup.dump
  ```

---

## The provider worker is NOT needed for M0

M0 runs with **simulated** providers, so the out-of-band worker (`npm run worker:provider`)
isn't required yet. You'll schedule it when you enable **live** providers (M2) — see
[`M1_PROVIDER_EXECUTION.md`](M1_PROVIDER_EXECUTION.md). On this stack the simplest options
then are a **Vercel Cron** hitting a protected route that runs one tick, or a small
always-on box (Railway / Fly / Render) running `npm run worker:provider --loop`.

## Exit criteria

All 6 roles log in on the Vercel URL and see only what their scope allows; data persists
in Neon Postgres; backups are enabled and a restore has been verified. The team can then
begin real CRM/SDR work on simulated providers, and you move to **M2** (live providers)
incrementally — see [`ROADMAP.md`](ROADMAP.md).

## Reference: scripts for go-live

| Command | Purpose |
| --- | --- |
| `npm run generate-secrets` | Print fresh production secret values. |
| `npm run db:provision -- --config <path> [--dry-run] [--force]` | Provision a clean real workspace + scoped logins. |
| `scripts/provisioning/accounts.example.json` | Template for the (gitignored) real `accounts.json`. |

## Connection-string cheat sheet

| Use | Which Neon URL | Extra params |
| --- | --- | --- |
| Migrations / provisioning (Step 3, local) | **Direct** (no `-pooler`) | `?sslmode=require` |
| App runtime (Step 4, Vercel `DATABASE_URL`) | **Pooled** (`-pooler`) | `?sslmode=require&pgbouncer=true` |

> Later hardening (optional): add `directUrl = env("DIRECT_URL")` to the `datasource`
> in `prisma/schema.prisma` so migrations can also run from CI against the pooled URL.
> Not needed for the local-migration flow above.
