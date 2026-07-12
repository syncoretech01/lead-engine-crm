#!/bin/bash
# Near-zero-downtime redeploy on the EC2 box. Run as root via SSM send-command:
#
#   aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript \
#     --parameters commands='bash /opt/syncore/app/deploy/aws/redeploy.sh'
#
# The web server stays UP through the whole build (deploy-app.sh assembles the new
# bundle in a staging dir and swaps it in with a mv; the running server keeps its
# open inode). Only the final 'systemctl restart syncore-web' is a gap (~2s), which
# Caddy's `lb_try_duration` retries over — so clients see a moment of latency, not a
# 502. The worker pauses for the build (background jobs, no user impact) and resumes.
#
# NOT transactional across build+restart, but each step is safe: a failed build leaves
# the old bundle live (never swapped); rollback = `mv /opt/syncore/web.old back` + restart.
#
# DB migrations: deploy-app.sh does NOT run them. If a PR includes a new migration,
# set MIGRATE=1 (expand-then-migrate: additive columns, old bundle tolerates them).
set -uxo pipefail

APP_DIR="/opt/syncore/app"
HEALTH_URL="${HEALTH_URL:-https://app.syncoretech.com/api/health}"
MIGRATE="${MIGRATE:-0}"

echo "=== PULL ==="
sudo -u syncore git -C "$APP_DIR" pull --ff-only > /tmp/pull.log 2>&1
PULL_RC=$?
tr -cd '[:print:]\n' < /tmp/pull.log; echo
if [ "$PULL_RC" -ne 0 ]; then echo "ABORT: pull failed; nothing changed."; exit 1; fi
echo "HEAD=$(sudo -u syncore git -C "$APP_DIR" log --oneline -1 2>&1 | tr -cd '[:print:]\n')"

if [ "$MIGRATE" = "1" ]; then
  echo "=== MIGRATE (expand-then-migrate; additive — old live bundle tolerates it) ==="
  DBURL=$(grep -E '^DATABASE_URL=' /etc/syncore/web.env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
  if [ -z "$DBURL" ]; then echo "ABORT: no DATABASE_URL in /etc/syncore/web.env"; exit 1; fi
  cd "$APP_DIR"
  sudo -u syncore env HOME=/tmp DATABASE_URL="$DBURL" npx prisma migrate deploy > /tmp/migrate.log 2>&1
  MIG_RC=$?
  tail -14 /tmp/migrate.log | tr -cd '[:print:]\n'; echo
  if [ "$MIG_RC" -ne 0 ]; then echo "ABORT: migrate failed; web still live on old bundle."; exit 1; fi
fi

echo "=== BUILD + STAGE + SWAP (web stays UP; worker paused for the build) ==="
bash "$APP_DIR/deploy/aws/deploy-app.sh" > /tmp/deploy.log 2>&1
BUILD_RC=$?
tail -8 /tmp/deploy.log | tr -cd '[:print:]\n'; echo
if [ "$BUILD_RC" -ne 0 ]; then
  echo "ABORT: build/stage failed; web still live on the OLD bundle (never swapped). Resuming worker."
  systemctl start syncore-worker 2>/dev/null || true
  exit 1
fi

echo "=== GO LIVE: restart web (~2s, Caddy retries) + resume worker ==="
systemctl restart syncore-web
systemctl start syncore-worker
sleep 3
echo "web=$(systemctl is-active syncore-web) worker=$(systemctl is-active syncore-worker)"

# Health-gate: poll a few times so a slightly-slow first request doesn't read as a fail.
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  echo "health_attempt_${i}=${code}"
  if [ "$code" = "200" ]; then echo "OK: healthy on new bundle."; exit 0; fi
  sleep 2
done
echo "WARN: health not 200 after retries — check the app; rollback = 'mv /opt/syncore/web.old /opt/syncore/web && systemctl restart syncore-web'."
exit 1
