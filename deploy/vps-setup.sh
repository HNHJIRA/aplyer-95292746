#!/bin/bash
# One-time VPS setup script for Aplyer on OVH VPS (Ubuntu 22.04/24.04)
# Run this ONCE as root on your VPS via SSH

set -e

DOMAIN="aplyer.assuredtechno.com"
APP_DIR="/var/www/aplyer"
APP_USER="aplyer"

echo "=== Aplyer VPS Setup ==="

# 1. Update system
echo "[1/8] Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 20
echo "[2/8] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install Nginx, Certbot, Git, PM2
echo "[3/8] Installing Nginx, Certbot, PM2..."
apt install -y nginx certbot python3-certbot-nginx git
npm install -g pm2

# 4. Install Bun (optional but recommended)
echo "[4/8] Installing Bun..."
curl -fsSL https://bun.sh/install | bash
# Make bun available for this script
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# 5. Create app user
echo "[5/8] Creating app user..."
if id "$APP_USER" &>/dev/null; then
    echo "User $APP_USER already exists"
else
    adduser --disabled-password --gecos "" "$APP_USER"
fi

# 6. Create app directory
echo "[6/8] Creating app directory..."
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# 7. Setup PM2 startup
echo "[7/8] Setting up PM2 startup..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"

# 8. Configure Nginx
echo "[8/8] Configuring Nginx..."
cat > /etc/nginx/sites-available/aplyer << 'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name aplyer.assuredtechno.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/aplyer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 9. SSL (Certbot) — will prompt for email if not set, or use --register-unsafely-without-email
# You can run this separately after DNS is pointing to the VPS:
# certbot --nginx -d aplyer.assuredtechno.com --non-interactive --agree-tos --register-unsafely-without-email

echo ""
echo "=== VPS Setup Complete ==="
echo "Next steps:"
echo "  1. Point aplyer.assuredtechno.com DNS A record to this server's IP"
echo "  2. Run SSL setup:  certbot --nginx -d aplyer.assuredtechno.com"
echo "  3. Copy the deploy script output to $APP_DIR and run: pm2 start ecosystem.config.cjs"
echo ""
echo "App directory: $APP_DIR"
echo "App user:      $APP_USER"
echo "Domain:        $DOMAIN"
