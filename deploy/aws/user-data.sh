#!/bin/bash
# EC2 user-data (Amazon Linux 2023, ARM64). Static — no Terraform templating.
# Installs Node 22 + Caddy + a swapfile, and writes /etc/syncore/{web,worker}.env
# from SSM Parameter Store. App build/deploy is a separate step (deploy-app.sh).
set -euxo pipefail
# Root-only log: xtrace traces every command into it, and this script handles
# decrypted SSM secrets. World-readable would hand the DB password to any local
# user (including the internet-facing caddy user).
install -m 600 /dev/null /var/log/syncore-user-data.log
exec > >(tee /var/log/syncore-user-data.log) 2>&1

SSM_PREFIX="/syncore/prod" # MUST match var.ssm_prefix in Terraform.

# --- region from IMDSv2 ---
TOKEN="$(curl -sX PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')"
REGION="$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)"

# --- swap (so `next build` doesn't OOM on t4g.small / 2GB) ---
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- packages: git + Node 22 (awscli v2 ships with AL2023) ---
dnf -y install git tar gzip
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf -y install nodejs
command -v aws >/dev/null 2>&1 || dnf -y install awscli-2

# --- Caddy (static ARM64 binary + systemd unit) ---
if [ ! -x /usr/bin/caddy ]; then
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=arm64" -o /usr/bin/caddy
  chmod +x /usr/bin/caddy
fi
id caddy >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy

# --- service user + dirs ---
id syncore >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/syncore --shell /bin/bash syncore
mkdir -p /opt/syncore /etc/syncore
chown -R syncore:syncore /opt/syncore

# --- write env files from SSM (config + secrets under the prefix) ---
write_env() {
  aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PREFIX" --with-decryption --recursive \
    --query 'Parameters[*].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      echo "${name##*/}=${value}"
    done
}
# xtrace OFF while decrypted secrets flow: with -x on, every echoed NAME=VALUE
# line lands in the boot log — plaintext credentials in a log file, strictly
# weaker than the 640 env files this block is carefully writing. Same pattern
# redeploy.sh uses around DBURL.
set +x
umask 077
write_env > /etc/syncore/web.env
cp /etc/syncore/web.env /etc/syncore/worker.env
# NODE_ENV must be production for the storage-driver + secret guards.
grep -q '^NODE_ENV=' /etc/syncore/web.env || echo 'NODE_ENV=production' >> /etc/syncore/web.env
grep -q '^NODE_ENV=' /etc/syncore/worker.env || echo 'NODE_ENV=production' >> /etc/syncore/worker.env
chown root:syncore /etc/syncore/web.env /etc/syncore/worker.env
chmod 640 /etc/syncore/web.env /etc/syncore/worker.env
set -x

# --- Caddyfile (reverse proxy + automatic TLS) ---
APP_URL="$(aws ssm get-parameter --region "$REGION" --name "$SSM_PREFIX/SYNCORE_APP_URL" --query 'Parameter.Value' --output text)"
DOMAIN="${APP_URL#https://}"
DOMAIN="${DOMAIN#http://}"
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    encode gzip
    reverse_proxy 127.0.0.1:3000 {
        # Near-zero-downtime deploys: during the ~2s syncore-web restart the upstream
        # refuses connections; keep retrying to select/dial it for up to 10s so a
        # request in flight waits a moment instead of 502-ing. Safe — Caddy only
        # retries when nothing was sent to the upstream yet (a dial failure).
        lb_try_duration 10s
        lb_try_interval 250ms
    }
}
CADDY
chown -R caddy:caddy /var/lib/caddy /etc/caddy

cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
Environment=XDG_DATA_HOME=/var/lib/caddy
Environment=XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now caddy

echo "user-data complete. Next: run deploy/aws/deploy-app.sh on this host (Phase 2/4)."
