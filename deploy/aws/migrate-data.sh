#!/bin/bash
# Phase 2 — migrate schema + data from Neon to RDS. Run on the EC2 instance
# (or any host that can reach BOTH databases). Neon stays live/writable (rollback
# safety). Requires two env vars:
#   NEON_URL = Neon DIRECT (non-pooled) connection string  (the -pooler-less host)
#   RDS_URL  = RDS URL, e.g. postgresql://USER:PW@RDS_ENDPOINT:5432/syncore?sslmode=require
#
#   NEON_URL='...' RDS_URL='...' sudo -E bash deploy/aws/migrate-data.sh
set -euxo pipefail

: "${NEON_URL:?set NEON_URL (Neon direct/non-pooled URL)}"
: "${RDS_URL:?set RDS_URL (RDS connection string)}"
APP_DIR="${APP_DIR:-/opt/syncore/app}"

# Postgres client (pg_dump/pg_restore). Install a client >= the Neon server major.
command -v pg_dump >/dev/null 2>&1 || sudo dnf install -y postgresql16

cd "$APP_DIR"

# 1) Create the schema on RDS.
DATABASE_URL="$RDS_URL" npx prisma migrate deploy

# 2) Copy the single source-of-truth row (data only) Neon -> RDS.
pg_dump --no-owner --data-only --table='"AppStateSnapshot"' -Fc "$NEON_URL" -f /tmp/snapshot.dump
pg_restore --no-owner --data-only -d "$RDS_URL" /tmp/snapshot.dump

# 3) Rebuild all ~74 normalized tables from the restored snapshot.
SYNCORE_STORAGE_DRIVER=prisma DATABASE_URL="$RDS_URL" npx tsx scripts/reproject.ts

echo "Phase 2 done. Next: Phase 3 verify (npm run test:integration against RDS)."
