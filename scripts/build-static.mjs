#!/usr/bin/env node
// Build a static SPA in dist/ for cPanel / Apache static hosting.
// Run AFTER `bun run build` — copies prerendered + client assets into dist/
// and writes a SPA fallback .htaccess so deep links work on refresh.

import { cp, mkdir, rm, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "dist";
// TanStack Start with prerender writes static HTML + assets into dist/client.
// Older versions used .output/public — fall back for compatibility.
const SRC = existsSync("dist/client") ? "dist/client" : ".output/public";

if (!existsSync(SRC)) {
  console.error(`✗ Neither dist/client nor .output/public found. Run \`bun run build\` first.`);
  process.exit(1);
}

console.log(`→ Flattening ${SRC} → ${OUT}/`);
// Move dist/client/* up into dist/, then remove dist/client and dist/server.
if (SRC === "dist/client") {
  // Copy first to a temp dir to avoid renaming a folder into its own parent.
  const TMP = "dist-static-tmp";
  await rm(TMP, { recursive: true, force: true });
  await cp(SRC, TMP, { recursive: true });
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(TMP, OUT, { recursive: true });
  await rm(TMP, { recursive: true, force: true });
} else {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });
}

// Ensure index.html exists at root (prerendered "/" output)
if (!existsSync(join(OUT, "index.html"))) {
  console.warn("⚠ dist/index.html missing — prerender of '/' may have failed.");
  console.warn("  The SPA fallback will still serve assets, but the root URL needs index.html.");
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

# Cache hashed assets aggressively
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

# Gzip
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

# Security headers
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

// Stats
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
console.log(`✓ Static build ready in ${OUT}/  (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`\nUpload the CONTENTS of ${OUT}/ to your cPanel document root.`);
