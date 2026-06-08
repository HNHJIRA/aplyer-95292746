#!/bin/bash
# Local deploy script — run from your local machine after building
# Usage: ./deploy/deploy.sh user@your-vps-ip

set -e

VPS_HOST="${1:-root@your-vps-ip}"
APP_DIR="/var/www/aplyer"
REMOTE_USER="aplyer"

echo "=== Aplyer Deploy ==="
echo "Target: $VPS_HOST"
echo ""

# 1. Build locally
echo "[1/4] Building locally..."
bun install
bun run build

# 2. Ensure log directory exists on VPS
echo "[2/4] Ensuring remote directories..."
ssh "$VPS_HOST" "mkdir -p /var/log/aplyer && chown $REMOTE_USER:$REMOTE_USER /var/log/aplyer"

# 3. Sync built app + package files
echo "[3/4] Syncing files to VPS..."
rsync -avz --delete \
  .output/ \
  package.json \
  deploy/ecosystem.config.cjs \
  "$VPS_HOST:$APP_DIR/"

# 4. Restart app with PM2
echo "[4/4] Restarting app..."
ssh "$VPS_HOST" "cd $APP_DIR && pm2 delete aplyer 2>/dev/null || true && pm2 start ecosystem.config.cjs && pm2 save"

echo ""
echo "=== Deploy Complete ==="
echo "Check status:  ssh $VPS_HOST 'pm2 logs aplyer'"
echo ""
