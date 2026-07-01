# Phase 1 — Provision the lean AWS stack (Terraform)

Provisions: default-VPC security groups, **1× EC2 t4g.small** (Elastic IP, IAM
role, Caddy auto-TLS, Node 22, swapfile), **RDS PostgreSQL db.t4g.micro** (private,
gp3, PITR), **S3** bucket, and **SSM** config/secrets. No ALB / NAT / RDS Proxy /
Aurora — see `docs/AWS_MIGRATION.md` for the why + full phase sequence.

Everything here is **[YOU]** (needs your AWS account). The assistant wrote/validated
the code; you run it.

## Prerequisites (one time)
1. Install **Terraform** (≥1.6) and the **AWS CLI**, and `aws configure` with an
   admin profile in **us-east-1**.
2. Create an **EC2 key pair** (EC2 → Key Pairs → Create) and note its name.
3. Find your public IP: `curl -s https://checkip.amazonaws.com` → use `<ip>/32`.
4. Confirm your **SES identity is verified in us-east-1** (it already is).

## Step 1 — Add the app SECRETS to SSM (kept out of Terraform state)
> **REUSE the current production values — do NOT generate fresh ones for a
> migration.** The migrated database contains provider API keys AES-encrypted with
> `SYNCORE_CREDENTIAL_ENCRYPTION_KEY` (see `provider-secret-vault.ts`); a new key
> can't decrypt them → live providers break after cutover. Likewise reuse
> `SYNCORE_UNSUBSCRIBE_SECRET` (signs already-sent unsubscribe links),
> `SYNCORE_AUTH_SECRET` (keeps sessions valid), and `SYNCORE_WEBHOOK_SECRET`
> (keeps inbound webhooks verifying). Copy them from **Vercel → Settings →
> Environment Variables (Production)** or the current worker's
> `/etc/syncore/worker.env`. `npm run generate-secrets` is only for a brand-new
> (greenfield) deploy with no existing encrypted data; rotate later as a separate
> step if desired.

Put each under the prefix `/syncore/prod` as SecureString. Example:
```bash
REGION=us-east-1
put() { aws ssm put-parameter --region $REGION --type SecureString --overwrite --name "/syncore/prod/$1" --value "$2"; }

put SYNCORE_AUTH_SECRET               'REPLACE'
put SYNCORE_WEBHOOK_SECRET            'REPLACE'
put SYNCORE_CREDENTIAL_ENCRYPTION_KEY 'REPLACE'
put SYNCORE_CREDENTIAL_KEY_ID         'production-key'
put SYNCORE_UNSUBSCRIBE_SECRET        'REPLACE'
put SYNCORE_MAILING_ADDRESS           'Syncore Tech, 1500 N Grant St, Denver, CO 80203, USA'
put SYNCORE_OUTREACH_FROM             'Bobby Jones <bobby@syncoretech.com>'
put SYNCORE_OUTREACH_REPLY_TO         'replies@syncoretech.com'
put SYNCORE_OUTREACH_BATCH_SIZE       '50'
# Provider keys (only the ones you use live):
put APOLLO_API_KEY   'REPLACE'
put HUNTER_API_KEY   'REPLACE'
put APIFY_TOKEN      'REPLACE'
put RINGCENTRAL_CLIENT_ID 'REPLACE'
put RINGCENTRAL_CLIENT_SECRET 'REPLACE'
put RINGCENTRAL_JWT 'REPLACE'
put RINGCENTRAL_SERVER_URL 'https://platform.ringcentral.com'
put SYNCORE_RINGCENTRAL_SAM_PHONE_NUMBER 'REPLACE'
# SES creds (until the SES adapter uses the instance role — Phase 6 follow-up):
put AWS_ACCESS_KEY_ID     'REPLACE'
put AWS_SECRET_ACCESS_KEY 'REPLACE'
```
Terraform manages the rest (`DATABASE_URL`, `SYNCORE_STORAGE_DRIVER=prisma`,
`SYNCORE_PROJECTION_MODE=diff`, `SYNCORE_APP_URL`, `AWS_SES_REGION`,
`SYNCORE_ENABLE_LIVE_PROVIDERS`, `SYNCORE_WORKER_LOOP_MS`, ...). Don't duplicate those.

## Step 2 — Apply Terraform
```bash
cd deploy/aws
cp terraform.tfvars.example terraform.tfvars   # then edit it
terraform init
terraform plan      # review
terraform apply
```
Copy the outputs: `instance_public_ip`, `instance_id`, `rds_endpoint`, `s3_bucket`.

## Step 3 — Get the app onto the box, then hand back for Phase 2
```bash
# Shell in without SSH keys via Session Manager:
aws ssm start-session --target <instance_id>

sudo mkdir -p /opt/syncore/app && sudo chown syncore:syncore /opt/syncore/app
sudo -u syncore git clone <YOUR_REPO_URL> /opt/syncore/app   # or scp/rsync the code
sudo bash /opt/syncore/app/deploy/aws/deploy-app.sh          # builds web+worker, installs units (does NOT start them)
```
Then continue with **Phase 2** (schema + data migrate) in `docs/AWS_MIGRATION.md`.

## Teardown
`deletion_protection` is on for RDS and `force_destroy=false` for S3, so
`terraform destroy` will refuse until you snapshot + disable those. Take a manual
RDS snapshot first. This is intentional (protects data).

## Notes / verify against current AWS docs
- `db_engine_version="16"` — confirm an available minor: `aws rds describe-db-engine-versions --engine postgres --query 'DBEngineVersions[].EngineVersion'`.
- The SSM prefix `/syncore/prod` is **hardcoded in `user-data.sh`** — if you change
  `var.ssm_prefix`, update the script too.
- Terraform **state contains the generated DB password** — use a secure/remote
  backend or protect the local state file.
