#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/syncore/lead-engine-crm}"
SERVICE_USER="${SERVICE_USER:-syncore-worker}"
SERVICE_NAME="${SERVICE_NAME:-syncore-worker}"
ENV_DIR="${ENV_DIR:-/etc/syncore}"
ENV_FILE="${ENV_FILE:-${ENV_DIR}/worker.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_TEMPLATE="${SCRIPT_DIR}/syncore-worker.service"
ENV_TEMPLATE="${SCRIPT_DIR}/worker.env.example"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo bash deploy/ec2/install-worker.sh"
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "App directory not found: ${APP_DIR}"
  echo "Clone or copy the repo to ${APP_DIR}, then run this script again."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required before installing the worker service."
  echo "On Amazon Linux 2023, install Node 22 first, then rerun this script."
  exit 1
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --shell /sbin/nologin "${SERVICE_USER}"
fi

mkdir -p "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -m 600 -o root -g root "${ENV_TEMPLATE}" "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Edit it with production values before starting the service."
fi

cd "${APP_DIR}"
npm ci

tmp_service="$(mktemp)"
sed \
  -e "s#__APP_DIR__#${APP_DIR}#g" \
  -e "s#__SERVICE_USER__#${SERVICE_USER}#g" \
  "${SERVICE_TEMPLATE}" > "${tmp_service}"
install -m 644 -o root -g root "${tmp_service}" "${SERVICE_FILE}"
rm -f "${tmp_service}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

echo "Installed ${SERVICE_NAME}.service."
echo "Next:"
echo "  1. sudo nano ${ENV_FILE}"
echo "  2. sudo systemctl start ${SERVICE_NAME}"
echo "  3. sudo systemctl status ${SERVICE_NAME}"
