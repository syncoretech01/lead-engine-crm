#!/bin/bash
# Build + install the Syncore web (standalone) and worker on the EC2 instance.
# Run as root (sudo) AFTER user-data finished and the repo is cloned to /opt/syncore/app.
#
#   sudo bash /opt/syncore/app/deploy/aws/deploy-app.sh
#
# It does NOT start the app units — Phase 4 starts them after the DB migrate.
set -euxo pipefail

APP_DIR="/opt/syncore/app"     # full repo (worker runs from here; needs devDeps for tsx)
WEB_DIR="/opt/syncore/web"     # Next.js standalone server lives here
SERVICE_USER="syncore"

cd "$APP_DIR"

# Build with the standalone output (next.config.mjs output:"standalone").
# Cap Node's heap at 3 GB so `next build` doesn't OOM during type-check/page-data
# on the 2 GB instance (3 GB fits in RAM + the 2 GB swapfile). `sudo -u` drops
# the outer env, so set NODE_OPTIONS on the build command itself.
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npx prisma generate
sudo -u "$SERVICE_USER" env NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Assemble the standalone runtime dir: server.js + static assets + public.
rm -rf "$WEB_DIR"
mkdir -p "$WEB_DIR"
cp -r "$APP_DIR/.next/standalone/." "$WEB_DIR/"
mkdir -p "$WEB_DIR/.next"
cp -r "$APP_DIR/.next/static" "$WEB_DIR/.next/static"
[ -d "$APP_DIR/public" ] && cp -r "$APP_DIR/public" "$WEB_DIR/public"
chown -R "$SERVICE_USER:$SERVICE_USER" "$WEB_DIR"

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

echo "Build + install done. Units enabled but NOT started."
echo "Phase 2: run 'npx prisma migrate deploy' + data import, then Phase 4: 'systemctl start syncore-web syncore-worker'."
