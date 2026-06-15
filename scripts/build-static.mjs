#!/usr/bin/env node
// Flatten the SPA build (dist-spa/) into dist/ for cPanel deploy,
// add .htaccess SPA fallback, and base64-encode the extension zip.
import { cp, mkdir, rm, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "dist";
const SRC = "dist-spa";

if (!existsSync(SRC)) {
  console.error(`✗ ${SRC} not found. Run \`vite build --config vite.spa.config.ts\` first.`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });
console.log(`→ Copied ${SRC} → ${OUT}/`);

if (!existsSync(join(OUT, "index.html"))) {
  console.error("✗ dist/index.html missing — SPA build failed.");
  process.exit(1);
}

const htaccess = `# Aplyer SPA — cPanel/Apache static hosting
Options -MultiViews
RewriteEngine On

# Force HTTPS
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Serve existing files/dirs as-is
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# SPA fallback — all other requests go to index.html
RewriteRule ^ index.html [L]

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
  ExpiresByType text/html "access plus 0 seconds"
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
`;
await writeFile(join(OUT, ".htaccess"), htaccess);
console.log(`→ Wrote ${OUT}/.htaccess`);

const extensionZip = join(OUT, "aplyer-extension.zip");
if (existsSync(extensionZip)) {
  const zip = await readFile(extensionZip);
  await writeFile(join(OUT, "aplyer-extension.zip.b64"), zip.toString("base64"));
  await rm(extensionZip, { force: true });
  console.log("→ Wrote text-safe extension download and removed raw zip");
}

async function dirSize(p) {
  let total = 0;
  for (const entry of await readdir(p, { withFileTypes: true })) {
    const full = join(p, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}
const bytes = await dirSize(OUT);
console.log(`✓ SPA static build ready in ${OUT}/  (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
