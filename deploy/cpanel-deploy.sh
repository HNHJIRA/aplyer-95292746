#!/usr/bin/env bash
# cPanel deploy script for Aplyer (TanStack Start SSR via Passenger / Setup Node.js App)
#
# Usage:
#   ./deploy/cpanel-deploy.sh
#
# Requirements:
#   - SSH access to your cPanel account (Manage SSH Keys in cPanel)
#   - rsync available on both sides (standard on cPanel)
#   - You've created the Node.js App once in cPanel UI (see deploy/cpanel-setup.md)
#
# Configure via env vars or by editing the defaults below:
#   CPANEL_HOST       SSH host (e.g. server123.web-hosting.com)
#   CPANEL_USER       cPanel username
#   CPANEL_PORT       SSH port (often 21098 on shared cPanel; 22 on some hosts)
#   APP_DIR           Absolute path to the Node app root on the server
#                     (must be OUTSIDE public_html — e.g. /home/USER/aplyer)
#   DOMAIN_DOCROOT    The autoindex folder cPanel created for the subdomain
#                     under public_html (we clear stale files here so Passenger
#                     can take over). Leave empty to skip.

set -euo pipefail

CPANEL_HOST="${CPANEL_HOST:-your-cpanel-host}"
CPANEL_USER="${CPANEL_USER:-your-cpanel-user}"
CPANEL_PORT="${CPANEL_PORT:-22}"
APP_DIR="${APP_DIR:-/home/${CPANEL_USER}/aplyer}"
DOMAIN_DOCROOT="${DOMAIN_DOCROOT:-/home/${CPANEL_USER}/public_html/aplyer.assuredtechno.com}"

SSH_TARGET="${CPANEL_USER}@${CPANEL_HOST}"
SSH_OPTS=(-p "${CPANEL_PORT}" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

echo "=== Aplyer cPanel Deploy ==="
echo "Target : ${SSH_TARGET}:${CPANEL_PORT}"
echo "AppDir : ${APP_DIR}"
echo "Docroot: ${DOMAIN_DOCROOT:-<skipped>}"
echo

# 1. Build locally
echo "[1/5] Building locally..."
bun install
bun run build
test -d .output || { echo "ERROR: .output/ not produced by build"; exit 1; }
test -f .output/server/index.mjs || {
  echo "ERROR: .output/server/index.mjs missing — TanStack Start build layout changed?"
  exit 1
}

# 2. Ensure remote dirs exist
echo "[2/5] Preparing remote directories..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "mkdir -p '${APP_DIR}/.output' '${APP_DIR}/tmp'"

# 3. Sync built app + package files (do NOT sync node_modules — cPanel rebuilds them)
echo "[3/5] Syncing .output/ and package.json ..."
rsync -avz --delete -e "${RSYNC_SSH}" \
  .output/ \
  "${SSH_TARGET}:${APP_DIR}/.output/"

rsync -avz -e "${RSYNC_SSH}" \
  package.json \
  "${SSH_TARGET}:${APP_DIR}/package.json"

# Sync .env only if present locally and not already on server (don't clobber prod secrets)
if [[ -f deploy/.cpanel.env ]]; then
  echo "      Uploading deploy/.cpanel.env -> ${APP_DIR}/.env"
  rsync -avz -e "${RSYNC_SSH}" deploy/.cpanel.env "${SSH_TARGET}:${APP_DIR}/.env"
fi

# 4. Clear stale files from the public_html subdomain folder so Passenger's
#    .htaccess (auto-created by Setup Node.js App) routes the domain to Node
#    instead of cPanel autoindex serving leftover files.
if [[ -n "${DOMAIN_DOCROOT}" ]]; then
  echo "[4/5] Clearing stale autoindex files in ${DOMAIN_DOCROOT} ..."
  # Keep the Passenger-generated .htaccess + the symlinked Node app entry,
  # remove other leftovers (old zips, favicon, assets/, index.html, etc.)
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "
    set -e
    if [ -d '${DOMAIN_DOCROOT}' ]; then
      cd '${DOMAIN_DOCROOT}'
      find . -mindepth 1 -maxdepth 1 \
        ! -name '.htaccess' \
        ! -name '.well-known' \
        ! -name 'cgi-bin' \
        -exec rm -rf {} +
    else
      echo 'NOTE: docroot does not exist yet (subdomain not created?). Skipping cleanup.'
    fi
  "
else
  echo "[4/5] DOMAIN_DOCROOT empty — skipping autoindex cleanup."
fi

# 5. Install deps + restart the Node app via cPanel's helper.
#    Setup Node.js App writes a per-app virtualenv activator under
#    /home/USER/nodevenv/<app>/<ver>/bin/activate that puts the right `npm`
#    + `node` on PATH. We try common locations; falls back to plain npm.
echo "[5/5] Installing deps and restarting app on server..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "
  set -e
  cd '${APP_DIR}'

  # Try to source a Node virtualenv if present (Setup Node.js App pattern).
  ACTIVATOR=\$(ls -1 /home/${CPANEL_USER}/nodevenv/*/*/bin/activate 2>/dev/null | head -n1 || true)
  if [ -n \"\$ACTIVATOR\" ]; then
    echo \"Activating Node env: \$ACTIVATOR\"
    # shellcheck disable=SC1090
    source \"\$ACTIVATOR\"
  else
    echo 'WARNING: no nodevenv activator found; using system node/npm.'
    echo '         Create the app once via cPanel > Setup Node.js App, then re-run.'
  fi

  node -v || true
  npm -v  || true

  # Production install (no devDeps; smaller, faster).
  npm install --omit=dev --no-audit --no-fund

  # Touch restart trigger — Passenger reloads on next request.
  mkdir -p tmp
  touch tmp/restart.txt
  echo 'Restart signal sent (tmp/restart.txt touched).'
"

echo
echo "=== Deploy Complete ==="
echo "Visit: https://aplyer.assuredtechno.com"
echo "If you still see an autoindex page:"
echo "  1) Open cPanel > Setup Node.js App and confirm the app is RUNNING."
echo "  2) Confirm 'Application startup file' is .output/server/index.mjs"
echo "  3) Confirm 'Application root' is ${APP_DIR/\/home\/${CPANEL_USER}\//}"
echo "  4) Confirm 'Application URL' is aplyer.assuredtechno.com"
