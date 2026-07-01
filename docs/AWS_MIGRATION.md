# AWS Migration Runbook (Neon + Vercel → lean AWS-native)

Status: **in progress.** This runbook moves the app off Neon (Postgres) + Vercel
(web) onto a cost-minimal all-AWS stack co-located in one region, so the metered
egress that capped Neon disappears (app↔DB traffic becomes intra-VPC). Sized for
~6 concurrent users — "only what's absolutely necessary."

> **Framing:** co-location fixes the *cost* problem, not the *structural* one.
> Every write is still a whole-blob read-modify-write + ~74-table re-projection
> (`lib/phase1/store.ts`). Enabling `SYNCORE_PROJECTION_MODE=diff` (below) and,
> longer term, P5 (retire the blob) are the structural fixes. See
> `docs/REMEDIATION_LOG.md` and the `neon-egress-cap` note.

Legend: **[ME]** = done/owned in-repo by the assistant · **[YOU]** = manual AWS
action you perform (exact steps given).

## Target architecture (lean)

```
Route53 + ACM ──► (optional CloudFront) ──►
  ┌──────────── one VPC, one AZ, public subnet (us-east-1) ────────────┐
  │  1× EC2 t4g.small (ARM/Graviton)                                    │
  │    • Next.js standalone (node server.js)  — systemd: syncore-web    │
  │    • background worker                     — systemd: syncore-worker│
  │    • Caddy (auto-TLS) reverse proxy :443 → 127.0.0.1:3000           │
  │              │ 5432 (SG: only this instance's SG)                   │
  │              ▼                                                      │
  │  RDS PostgreSQL db.t4g.micro, single-AZ, gp3, PITR (not public)     │
  └────────────────────────────────────────────────────────────────────┘
     S3 (exports/backups, gateway endpoint = free)   SES (us-east-1)
     Secrets → SSM Parameter Store (standard params = FREE)
```

No ALB, no NAT gateway, no RDS Proxy, no Aurora, no ECS/Fargate, no Multi-AZ —
each removed deliberately as unnecessary at this scale (see the cost note).

## Rough cost (us-east-1, on-demand — verify current pricing)

| Item | ~$/mo |
|---|---|
| EC2 t4g.small + ~30GB gp3 | ~$14 |
| RDS db.t4g.micro single-AZ + 20GB gp3 | ~$14 |
| S3 + SES + SSM + CloudWatch | ~$2–4 |
| Data transfer (EC2↔RDS same-AZ free; egress minimal) | ~$0–2 |
| **Total on-demand** | **~$30/mo** |
| **With a 1-yr Savings Plan / Reserved Instance** | **~$20–24/mo** |

---

## Phase 0 — In-repo prep  ✅ [ME] (nothing for you)

Landed on branch `aws-migration-phase0` (this PR). Changes nothing about live
Neon/Vercel until cutover; verified by CI (typecheck/lint/build/integration).

- `next.config.mjs` → `output: "standalone"` so the app runs as `node server.js`.
- `deploy/ec2/syncore-web.service` → systemd unit for the web app (mirrors the
  existing worker unit's hardening).
- `deploy/ec2/web.env.example` → AWS/RDS env template (direct DB URL, no
  pgbouncer; `SYNCORE_PROJECTION_MODE=diff`).
- This runbook.

**Not done yet (deliberately deferred to avoid touching live prod):**
- Removing the `VERCEL_URL` fallback in `transactional-email-service.ts` /
  `unsubscribe-token.ts` — done at cutover (Phase 4), since `SYNCORE_APP_URL` is
  already the primary source today.
- SES via instance IAM role instead of static keys (`amazon-ses.ts` needs a code
  change) — Phase 6 follow-up.

---

## Phase 1 — Provision AWS  [YOU] run · [ME] drafts IaC + exact steps (next PR)

Target resources (region **us-east-1**, to match the existing SES identity):

1. **VPC** — the account's **default VPC** is fine for this lean setup (public
   subnet already present). No custom VPC/NAT needed.
2. **Security groups:**
   - `sg-web`: inbound 443 (and 80 for ACME) from `0.0.0.0/0`; inbound 22 (SSH)
     from **your IP only**.
   - `sg-db`: inbound 5432 from `sg-web` **only** (no public access).
3. **EC2** — `t4g.small` (Amazon Linux 2023, ARM64), in a public subnet, with an
   **Elastic IP**, `sg-web`, and an **instance IAM role** (SSM read, SES send, S3
   read/write to the app bucket, CloudWatch logs).
4. **RDS** — `db.t4g.micro`, PostgreSQL (confirm minor vs Prisma 6.19.3),
   single-AZ, 20GB gp3, **Publicly accessible = No**, `sg-db`, automated backups +
   PITR on, deletion protection on. DB name `syncore`.
5. **S3** — one private bucket (block public access, SSE, lifecycle) for
   exports/backups.
6. **SSM Parameter Store** — put every secret from `web.env.example` here (free
   standard params). Instance pulls them at boot into `/etc/syncore/web.env`.
7. **Elastic IP + DNS later** (Phase 5).

> **[ME] next:** I'll add a Terraform stack under `deploy/aws/` that provisions
> all of the above, plus a bootstrap script (`user-data`) that installs Node 22,
> Caddy, the two systemd units, and pulls secrets from SSM. Your manual step
> becomes: set a few Terraform variables → `terraform apply` → copy the outputs
> (EC2 IP, RDS endpoint). Exact commands land with that PR.

**Generate FRESH credentials** (do not reuse Neon/Vercel secrets): new RDS master
+ app password, and regenerate `SYNCORE_AUTH_SECRET` / `SYNCORE_WEBHOOK_SECRET` /
`SYNCORE_CREDENTIAL_ENCRYPTION_KEY` / `SYNCORE_UNSUBSCRIBE_SECRET`
(`npm run generate-secrets`). This also closes the open "rotate Neon password" item.

---

## Phase 2 — Schema + data migrate  [YOU] run (one script)

Neon stays live and writable throughout (rollback safety). This is turnkey via
`deploy/aws/migrate-data.sh` (run on the instance after Phase 1's `deploy-app.sh`):

```bash
NEON_URL='postgresql://…neon direct (non-pooled) URL…' \
RDS_URL='postgresql://USER:PW@RDS_ENDPOINT:5432/syncore?sslmode=require' \
  sudo -E bash /opt/syncore/app/deploy/aws/migrate-data.sh
```

It (1) runs `prisma migrate deploy` to build the RDS schema, (2) `pg_dump`s just
the `AppStateSnapshot` row from Neon and restores it into RDS (data-only), and
(3) runs `scripts/reproject.ts` (`npm run db:reproject`) to rebuild all ~74
normalized tables from that snapshot in one pass — avoiding cross-table FK/enum
ordering issues from a full dump. The reproject step was validated end-to-end
against a real Postgres (seed → empty a table → reproject → repopulated).

> Get the Neon **direct/non-pooled** URL from the Neon console (the host without
> `-pooler`). Install a `pg_dump` client whose major ≥ the Neon server's.

---

## Phase 3 — Verify against RDS  [YOU] run · [ME] test exists

Run the repo's own real-Postgres gate pointed at RDS:
```
SYNCORE_STORAGE_DRIVER=prisma SYNCORE_RUN_DB_INTEGRATION=1 \
  DATABASE_URL="$RDS_URL" npm run test:integration
```
Green = writeState → projection → `readFast*` behaves identically to Neon
(`tests/integration/persistence-roundtrip.test.ts`). Also do a quick manual login
+ create-a-contact smoke test on the instance's local port.

---

## Phase 4 — Cutover  [YOU] run · [ME] final code (VERCEL_URL removal)

1. **[ME]** merge the small cutover PR: drop the `VERCEL_URL` fallback so
   `SYNCORE_APP_URL` is the sole base URL.
2. Announce a short maintenance window. **Stop the current worker** so nothing new
   writes to Neon: `systemctl stop syncore-worker` (old host).
3. Re-run the Phase 2 dump/restore for the final delta, point `/etc/syncore/*.env`
   `DATABASE_URL` at RDS, start both units:
   `systemctl restart syncore-web syncore-worker`.
4. Smoke test on the instance (login as owner + one SDR, create a contact/task,
   reload to confirm persistence).

## Phase 5 — DNS  [YOU] flip

Only after the smoke test passes: point the app domain (Route53) at the Elastic
IP / CloudFront. Lower the DNS TTL beforehand. DNS is last so rollback = one
revert. Caddy obtains the TLS cert automatically on first request.

## Phase 6 — Decommission  [YOU], after 24–72h soak

Confirm Aurora/RDS healthy under real use, take a final `pg_dump` of Neon as a
cold archive, remove Neon strings from all env + CI, delete the Vercel project,
then delete the Neon project. **[ME] follow-ups:** SES instance-role support;
optional exports→S3 with presigned URLs.

---

## Rollback (any phase before decommission)

Neon stays live and writable until Phase 6. To roll back: revert DNS to Vercel
and revert `DATABASE_URL` back to Neon in the env files, then restart. Only writes
that landed on RDS after cutover are lost — keep the window tight; if real usage
occurred on RDS, `pg_dump` it back to Neon before reverting. Run a PITR restore
drill on RDS before decommissioning Neon.
