#!/bin/bash
# Build + stage the Syncore web (standalone) and worker on the EC2 instance.
# Run as root (sudo).
#
#   sudo bash /opt/syncore/app/deploy/aws/deploy-app.sh
#
# Near-zero web downtime: the web server keeps serving from /opt/syncore/web (its own
# self-contained standalone bundle) the WHOLE time this runs. The build writes to
# /opt/syncore/app/.next and the new runtime is assembled into a staging dir, then
# swapped into place with an atomic `mv` — a running web server keeps its already-open
# WorkingDirectory inode, so it serves without interruption until the caller restarts
# it. This script does NOT start/restart the app units:
#   - first install: run 'prisma migrate deploy' then 'systemctl start syncore-web syncore-worker'
#   - redeploy: use redeploy.sh, which does the ~2s 'systemctl restart syncore-web' at the end
#     (Caddy's lb_try_duration retries over that window, so clients see latency, not 502s).
set -euxo pipefail

APP_DIR="/opt/syncore/app"     # full repo (worker runs from here; needs devDeps for tsx)
WEB_DIR="/opt/syncore/web"     # Next.js standalone server lives here (served live)
SERVICE_USER="syncore"

cd "$APP_DIR"

# The worker runs from APP_DIR and uses its node_modules (tsx). Stop it so `npm ci`
# can't pull deps out from under a running job, and to free ~768M for the build on
# the 2 GB box. The WEB server is unaffected — it runs from WEB_DIR's own bundle, so
# it stays UP through the build. (No-op on first install; the worker isn't running.)
systemctl stop syncore-worker 2>/dev/null || true

# Build with the standalone output (next.config.mjs output:"standalone").
# Cap Node's heap at 3 GB so `next build` doesn't OOM during type-check/page-data
# on the 2 GB instance (3 GB fits in RAM + the 2 GB swapfile). `sudo -u` drops the
# outer env, so set NODE_OPTIONS on the build command itself.
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npx prisma generate
sudo -u "$SERVICE_USER" env NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Assemble the standalone runtime into a STAGING dir — never touch the live WEB_DIR,
# so the running web server keeps serving throughout the assembly.
STAGE="${WEB_DIR}.new"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$APP_DIR/.next/standalone/." "$STAGE/"
mkdir -p "$STAGE/.next"
cp -r "$APP_DIR/.next/static" "$STAGE/.next/static"
if [ -d "$APP_DIR/public" ]; then
  cp -r "$APP_DIR/public" "$STAGE/public"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$STAGE"

# Install systemd units from the repo, filling in the placeholders.
install_unit() {
  local src="$1" dst="$2" appdir="$3"
  sed -e "s#__SERVICE_USER__#${SERVICE_USER}#g" -e "s#__APP_DIR__#${appdir}#g" \
    "$src" > "$dst"
}
install_unit "$APP_DIR/deploy/ec2/syncore-web.service"    /etc/systemd/system/syncore-web.service    "$WEB_DIR"
install_unit "$APP_DIR/deploy/ec2/syncore-worker.service" /etc/systemd/system/syncore-worker.service "$APP_DIR"
systemctl daemon-reload
systemctl enable syncore-web syncore-worker

# Atomic swap: move the freshly-built bundle into place. A running web server keeps
# its already-open WorkingDirectory inode (now at WEB_DIR.old), so it serves without
# interruption until the caller restarts it onto the new WEB_DIR.
rm -rf "${WEB_DIR}.old"
if [ -e "$WEB_DIR" ]; then
  mv "$WEB_DIR" "${WEB_DIR}.old"
fi
mv "$STAGE" "$WEB_DIR"

echo "Build + swap done. Web bundle staged into $WEB_DIR; syncore-web NOT restarted."
echo "First install: 'prisma migrate deploy' then 'systemctl start syncore-web syncore-worker'."
echo "Redeploy: 'systemctl restart syncore-web && systemctl start syncore-worker' (redeploy.sh does this)."
