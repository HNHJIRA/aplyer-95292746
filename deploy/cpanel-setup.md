# cPanel Deployment — Aplyer

Aplyer is a TanStack Start SSR app. On cPanel it runs as a Node.js app under
Phusion Passenger (cPanel's "Setup Node.js App"). Static-only hosting does
**not** work — there is no `index.html` to serve.

## One-time cPanel setup

1. **Subdomain.** cPanel → *Domains* → create `aplyer.assuredtechno.com`.
   Note the document root it creates (usually
   `/home/USER/public_html/aplyer.assuredtechno.com`).

2. **SSH access.** cPanel → *SSH Access* → *Manage SSH Keys* → generate or
   import a key, authorize it, download the private key locally. Note the
   SSH port (often `21098` on shared cPanel, sometimes `22`).

3. **Create the Node.js app.** cPanel → *Setup Node.js App* → *Create
   Application*:
   - **Node.js version:** 20.x or 22.x (latest available)
   - **Application mode:** Production
   - **Application root:** `aplyer`  (resolves to `/home/USER/aplyer`,
     **outside** `public_html` — important)
   - **Application URL:** `aplyer.assuredtechno.com`
   - **Application startup file:** `.output/server/index.mjs`
   - **Environment variables:** copy from `deploy/.env.example`, set
     `NODE_ENV=production`. `PORT` is assigned by Passenger — leave blank.
   Click **Create**, then **Stop** the app (we'll start it after the first
   deploy).

4. **Environment file.** Copy `deploy/.env.example` to `deploy/.cpanel.env`
   locally and fill in `SUPABASE_SERVICE_ROLE_KEY`. The deploy script uploads
   it to `${APP_DIR}/.env` on the server. Do **not** commit `.cpanel.env`.

## Deploy

```bash
export CPANEL_HOST=server123.web-hosting.com
export CPANEL_USER=yourcpaneluser
export CPANEL_PORT=21098
# Optional overrides:
# export APP_DIR=/home/${CPANEL_USER}/aplyer
# export DOMAIN_DOCROOT=/home/${CPANEL_USER}/public_html/aplyer.assuredtechno.com

./deploy/cpanel-deploy.sh
```

What the script does:

1. Builds locally (`bun run build`) → produces `.output/`.
2. `rsync`s `.output/` and `package.json` to `${APP_DIR}` on the server.
3. Uploads `deploy/.cpanel.env` → `${APP_DIR}/.env` (if present).
4. Clears stale files (old zip, favicon, autoindex leftovers) from the
   subdomain's `public_html` folder so Passenger's auto-generated
   `.htaccess` can route the domain to the Node app.
5. Activates the per-app Node virtualenv on the server, runs
   `npm install --omit=dev`, and touches `tmp/restart.txt` to make
   Passenger reload the app on the next request.

## Verifying

- cPanel → *Setup Node.js App* → app should show **Running**.
- `https://aplyer.assuredtechno.com` should render the app (not an
  *Index of /* listing).
- If you still see autoindex:
  - Confirm `.htaccess` exists in the subdomain docroot (Setup Node.js App
    writes it; if missing, click *Edit* → *Save* on the app to regenerate).
  - Confirm "Application startup file" is exactly `.output/server/index.mjs`.
  - Check the app's stderr log linked from the Setup Node.js App page.

## Rollback

Each deploy overwrites `.output/` via `rsync --delete`. To roll back, redeploy
from a previous commit:

```bash
git checkout <previous-commit>
./deploy/cpanel-deploy.sh
git checkout -
```

Or keep a tarball of `.output/` from the last known-good build and restore it
to `${APP_DIR}/.output/` manually, then `touch ${APP_DIR}/tmp/restart.txt`.
