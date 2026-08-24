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
#
# Memory: the build needs roughly a gigabyte on a 2 GB box, so this refuses to start
# one when there is nothing to give (see MEMORY PRECHECK below). Override the two
# thresholds with MIN_AVAIL_MB / FLOOR_AVAIL_MB.
set -uxo pipefail

APP_DIR="/opt/syncore/app"
HEALTH_URL="${HEALTH_URL:-https://app.syncoretech.com/api/health}"
MIGRATE="${MIGRATE:-0}"
# Below MIN: reclaim before building. Below FLOOR even after reclaiming: refuse.
MIN_AVAIL_MB="${MIN_AVAIL_MB:-600}"
FLOOR_AVAIL_MB="${FLOOR_AVAIL_MB:-300}"

avail_mb() { free -m | awk '/^Mem:/ {print $7}'; }

echo "=== PULL ==="
sudo -u syncore git -C "$APP_DIR" pull --ff-only > /tmp/pull.log 2>&1
PULL_RC=$?
tr -cd '[:print:]\n' < /tmp/pull.log; echo
if [ "$PULL_RC" -ne 0 ]; then echo "ABORT: pull failed; nothing changed."; exit 1; fi
echo "HEAD=$(sudo -u syncore git -C "$APP_DIR" log --oneline -1 2>&1 | tr -cd '[:print:]\n')"

echo "=== MEMORY PRECHECK ==="
# Why this exists: on 2026-08-21 a redeploy started with ~74 MB available and
# thrashed the box into swap-death. SSM went ConnectionLost while EC2 still
# reported status-ok, and only a reboot recovered it — ~40 minutes of downtime,
# far worse than the deploy it was trying to perform. Nothing in the script
# noticed; it just started a build there was no room for.
#
# Two reclaims, cheapest first, then a refusal:
#
#  1. Stop the worker (~600 MB). deploy-app.sh stops it as its first act anyway,
#     so doing it here costs nothing and means we measure the memory the build
#     will actually have rather than a number about to change by half a gig.
#  2. Restart the web server. It grows with the state blob — ~800 MB observed
#     after a bulk import, against ~70 MB fresh. This spends the same ~2 s gap
#     the GO LIVE restart at the end already spends, just earlier, and Caddy
#     retries over it identically. Skipped entirely when memory is fine.
#
# Refusing is the point: a failed build is safe (the old bundle is never
# swapped), but a wedged box is not, and only a reboot clears it.
echo "available_before=$(avail_mb)M worker=$(systemctl is-active syncore-worker)"
systemctl stop syncore-worker 2>/dev/null || true
echo "available_after_worker_stop=$(avail_mb)M"

if [ "$(avail_mb)" -lt "$MIN_AVAIL_MB" ]; then
  echo "Below ${MIN_AVAIL_MB}M — restarting syncore-web to reclaim it (~2s, Caddy retries)."
  systemctl restart syncore-web
  sleep 5
  echo "available_after_web_restart=$(avail_mb)M web=$(systemctl is-active syncore-web)"
fi

AVAIL=$(avail_mb)
if [ "$AVAIL" -lt "$FLOOR_AVAIL_MB" ]; then
  echo "ABORT: ${AVAIL}M available after reclaiming, under the ${FLOOR_AVAIL_MB}M floor."
  echo "       Building here risks wedging the box (2026-08-21). The old bundle is"
  echo "       still live and untouched. Investigate what is holding memory, or"
  echo "       re-run with FLOOR_AVAIL_MB lower if you know it is safe."
  systemctl start syncore-worker 2>/dev/null || true
  exit 1
fi
echo "OK: ${AVAIL}M available (floor ${FLOOR_AVAIL_MB}M)."

if [ "$MIGRATE" = "1" ]; then
  echo "=== MIGRATE (expand-then-migrate; additive — old live bundle tolerates it) ==="
  # Keep the database URL out of SSM command output while tracing remains enabled
  # for the rest of the deployment.
  set +x
  DBURL=$(grep -E '^DATABASE_URL=' /etc/syncore/web.env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
  if [ -z "$DBURL" ]; then echo "ABORT: no DATABASE_URL in /etc/syncore/web.env"; exit 1; fi
  cd "$APP_DIR"
  sudo -u syncore env HOME=/tmp DATABASE_URL="$DBURL" npx prisma migrate deploy > /tmp/migrate.log 2>&1
  MIG_RC=$?
  set -x
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
HEALTHY=0
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  echo "health_attempt_${i}=${code}"
  if [ "$code" = "200" ]; then HEALTHY=1; break; fi
  sleep 2
done
if [ "$HEALTHY" -ne 1 ]; then
  echo "WARN: health not 200 after retries — check the app; rollback = 'mv /opt/syncore/web.old /opt/syncore/web && systemctl restart syncore-web'."
  exit 1
fi
echo "OK: healthy on new bundle."

# Warm-up (best-effort — the app is ALREADY live and healthy; this never fails the deploy).
# A fresh process + a page cache the build evicted means the FIRST hit of each route pays a
# cold-start: Next compiles the route module, the Prisma pool/query-plans are cold, chunks
# aren't cached. Prime them here — hit the app DIRECTLY (127.0.0.1:3000, no Caddy/TLS) so a
# real user doesn't eat that. Unauth'd hits still warm the route module + middleware session
# lookup + DB pool (the bulk of the cold cost); auth-only read models can't be primed without
# a session. Two passes per route make the warming visible (pass 1 compiles, pass 2 is fast).
echo "=== WARM-UP (best-effort) ==="
WARM_BASE="http://127.0.0.1:3000"
for path in / /login /crm /crm/contacts /crm/follow-ups /crm/accounts /crm/opportunities /crm/calls /crm/my-contacts; do
  for pass in 1 2; do
    out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 15 "${WARM_BASE}${path}" 2>/dev/null || echo "000 -")
    printf 'warm %-24s pass%s -> %s\n' "$path" "$pass" "$out"
  done
done
echo "Warm-up complete. Deploy done."
exit 0
