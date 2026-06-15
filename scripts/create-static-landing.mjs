import { mkdirSync, writeFileSync } from "node:fs";

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aplyer.ai — Stop Skipping Jobs</title>
    <meta
      name="description"
      content="Aplyer is a Chrome extension that fills job application essay questions in your own voice using your resume. Works on Workday, Greenhouse, Lever and any careers page."
    />
    <meta property="og:title" content="Aplyer.ai — Stop Skipping Jobs" />
    <meta property="og:description" content="Apply faster and sound like yourself on every job application." />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Aplyer.ai — Stop Skipping Jobs" />
    <meta name="twitter:description" content="Apply faster and sound like yourself on every job application." />
    <link rel="icon" href="/favicon.ico" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #050a14;
        --paper: #0b1626;
        --field: #0f1c30;
        --green: #1db954;
        --green-glow: rgba(29, 185, 84, 0.7);
        --red: #e5373a;
        --white: #f5f7fa;
        --sub: #c8cfdb;
        --muted: #8a93a4;
        --border: rgba(255, 255, 255, 0.08);
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        min-height: 100vh;
        background:
          radial-gradient(60% 50% at 20% 10%, rgba(29, 185, 84, 0.12), transparent 60%),
          radial-gradient(50% 50% at 85% 90%, rgba(229, 55, 58, 0.10), transparent 60%),
          var(--bg);
        color: var(--white);
        font-family: Lato, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      a { color: inherit; text-decoration: none; }
      .container { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }

      /* Nav */
      .nav {
        position: sticky; top: 0; z-index: 50;
        border-bottom: 1px solid var(--border);
        background: rgba(5, 10, 20, 0.8);
        backdrop-filter: blur(18px);
      }
      .nav-inner {
        height: 64px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .brand { display: inline-flex; align-items: center; gap: 10px; }
      .brand-text { display: flex; flex-direction: column; line-height: 1; }
      .brand-name {
        font-weight: 900; font-size: 20px; letter-spacing: -0.01em;
        color: var(--green);
      }
      .brand-sub {
        margin-top: 4px;
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em;
        color: var(--muted);
      }
      .nav-links { display: flex; align-items: center; gap: 6px; }
      .nav-link {
        padding: 8px 12px; font-size: 14px; color: var(--sub);
        border-radius: 8px; transition: color 180ms ease;
      }
      .nav-link:hover { color: var(--white); }
      .nav-cta {
        display: inline-flex; align-items: center; gap: 8px;
        margin-left: 6px; padding: 9px 16px;
        border-radius: 10px; background: var(--green); color: #06140a;
        font-weight: 800; font-size: 14px;
        box-shadow: 0 8px 24px -8px var(--green-glow);
        transition: transform 180ms ease;
      }
      .nav-cta:hover { transform: scale(1.03); }

      /* Hero */
      .hero { padding: 56px 0 80px; }
      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        gap: 48px; align-items: center;
      }
      .eyebrow {
        display: inline-flex; align-items: center; gap: 9px;
        border: 1px solid rgba(29, 185, 84, 0.3);
        background: rgba(29, 185, 84, 0.1);
        color: var(--green);
        border-radius: 999px; padding: 6px 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
      }
      .pulse {
        width: 6px; height: 6px; border-radius: 999px; background: var(--green);
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      h1 {
        margin: 20px 0 0;
        font-size: clamp(40px, 6.5vw, 58px);
        font-weight: 900; line-height: 1.02; letter-spacing: -0.02em;
      }
      .red { color: var(--red); }
      .green { color: var(--green); }
      .lead {
        margin: 20px 0 0; max-width: 560px;
        color: var(--sub); font-size: 16px; line-height: 1.65;
      }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 14px 22px; border-radius: 12px;
        font-weight: 700; font-size: 15px; cursor: pointer;
        transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
      }
      .btn-primary {
        background: var(--green); color: #06140a; border: 0;
        box-shadow: 0 18px 40px -14px var(--green-glow);
      }
      .btn-primary:hover { transform: scale(1.02); }
      .btn-secondary {
        background: rgba(11, 22, 38, 0.6); color: var(--white);
        border: 1px solid var(--border);
      }
      .btn-secondary:hover { border-color: rgba(29, 185, 84, 0.4); }
      .stats {
        display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px; margin-top: 32px;
      }
      .stat {
        border: 1px solid var(--border);
        background: rgba(11, 22, 38, 0.6);
        border-radius: 10px; padding: 12px;
      }
      .stat-label {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em;
        color: var(--muted);
      }
      .stat-value { margin-top: 6px; font-size: 13px; font-weight: 700; line-height: 1.4; }
      .stat-value.green { color: var(--green); }

      /* Popup preview */
      .preview-wrap { position: relative; max-width: 400px; margin: 0 auto; }
      .preview-glow {
        position: absolute; inset: -32px; z-index: -1;
        background: radial-gradient(50% 50% at 50% 30%, rgba(29, 185, 84, 0.35), transparent 70%);
        filter: blur(48px); opacity: 0.8;
      }
      .preview {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: var(--paper);
        border-radius: 28px; overflow: hidden;
        box-shadow: 0 40px 100px -30px rgba(0, 0, 0, 0.9);
        animation: float 6s ease-in-out infinite;
      }
      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      .preview-bar {
        display: flex; align-items: center; gap: 6px;
        border-bottom: 1px solid var(--border);
        background: #0a1322; padding: 10px 12px;
      }
      .dot { width: 10px; height: 10px; border-radius: 999px; }
      .dot.red { background: #ff5f57; }
      .dot.yellow { background: #febc2e; }
      .dot.green { background: #28c840; }
      .preview-title {
        margin-left: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em;
        color: var(--muted);
      }
      .popup { padding: 18px; }
      .popup-head {
        display: flex; align-items: center; justify-content: space-between;
        padding-bottom: 16px; border-bottom: 1px solid var(--border);
      }
      .popup-brand { display: flex; align-items: center; gap: 10px; }
      .popup-brand-name { font-weight: 800; font-size: 15px; }
      .popup-brand-sub {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
        color: var(--muted); margin-top: 2px;
      }
      .icon-btn {
        width: 30px; height: 30px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--muted); background: transparent; border: 0;
      }
      .connected {
        display: flex; align-items: center; gap: 10px;
        margin: 14px 0; padding: 10px 0;
      }
      .check-circle {
        width: 32px; height: 32px; border-radius: 999px;
        background: rgba(29, 185, 84, 0.15);
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--green);
      }
      .connected-mail { font-weight: 700; font-size: 13px; }
      .connected-status {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
        color: var(--green); margin-top: 2px;
      }
      .pop-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 14px;
        border: 1px solid var(--border); border-radius: 10px;
        background: rgba(15, 28, 48, 0.5);
        margin-bottom: 10px;
      }
      .pop-row-label {
        display: flex; align-items: center; gap: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
        color: var(--muted);
      }
      .pop-row-value { font-size: 12px; color: var(--sub); font-weight: 600; }
      .popup-foot {
        margin-top: 24px;
        padding-top: 18px; border-top: 1px solid var(--border);
        display: flex; flex-direction: column; gap: 10px;
      }
      .pop-cta {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        background: var(--green); color: #06140a;
        padding: 12px; border-radius: 10px; font-weight: 800; font-size: 13px;
        border: 0; cursor: pointer;
      }
      .pop-row-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .pop-ghost {
        padding: 10px; border-radius: 8px;
        background: rgba(15, 28, 48, 0.6); border: 1px solid var(--border);
        color: var(--sub); font-size: 12px; font-weight: 600;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }

      /* Footer */
      .footer {
        border-top: 1px solid var(--border);
        margin-top: 60px; padding: 24px 0;
        color: var(--muted); font-size: 13px;
      }

      @media (max-width: 900px) {
        .hero-grid { grid-template-columns: 1fr; gap: 40px; }
        .stats { grid-template-columns: 1fr 1fr; }
        .brand-sub { display: none; }
      }
      @media (max-width: 560px) {
        .nav-link { display: none; }
        .stats { grid-template-columns: 1fr; }
        .actions .btn { width: 100%; }
      }
    </style>
  </head>
  <body>
    <header class="nav">
      <div class="container nav-inner">
        <a class="brand" href="/" aria-label="Aplyer.ai home">
          <svg width="32" height="32" viewBox="0 0 88 88" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="g" x1="0" y1="44" x2="88" y2="44">
                <stop offset="0%" stop-color="#E5373A" />
                <stop offset="50%" stop-color="#E5373A" />
                <stop offset="50%" stop-color="#1DB954" />
                <stop offset="100%" stop-color="#1DB954" />
              </linearGradient>
            </defs>
            <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#g)" stroke-width="2" />
            <line x1="22" y1="28" x2="44" y2="44" stroke="#E5373A" stroke-width="5" stroke-linecap="round" />
            <line x1="22" y1="60" x2="44" y2="44" stroke="#E5373A" stroke-width="5" stroke-linecap="round" />
            <line x1="44" y1="44" x2="56" y2="56" stroke="#1DB954" stroke-width="5" stroke-linecap="round" />
            <line x1="56" y1="56" x2="72" y2="28" stroke="#1DB954" stroke-width="5" stroke-linecap="round" />
          </svg>
          <span class="brand-text">
            <span class="brand-name">Aplyer.ai</span>
            <span class="brand-sub">Stop Skipping Jobs</span>
          </span>
        </a>
        <nav class="nav-links">
          <a class="nav-link" href="#how">How it works</a>
          <a class="nav-link" href="#founder">Founder</a>
          <a class="nav-cta" href="/dashboard">
            Open Dashboard
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </nav>
      </div>
    </header>

    <main class="hero">
      <div class="container hero-grid">
        <section>
          <div class="eyebrow"><span class="pulse"></span> Early Access Open</div>
          <h1>
            Stop <span class="red">Skipping</span> Jobs.<br />
            Apply and <span class="green">sound like yourself</span> on every one.
          </h1>
          <p class="lead">
            Aplyer is a Chrome extension that fills long essay questions on job applications in your own voice — using your resume. Works inside Workday, Greenhouse, Lever, and any employer careers page.
          </p>
          <div class="actions">
            <a class="btn btn-primary" href="/dashboard">
              Open Dashboard
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
            <button class="btn btn-secondary" type="button" onclick="downloadExtension(event)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Extension
            </button>
          </div>
          <div class="stats">
            <div class="stat">
              <div class="stat-label">Status</div>
              <div class="stat-value green">● Early Access</div>
            </div>
            <div class="stat">
              <div class="stat-label">Works on</div>
              <div class="stat-value">Workday · Greenhouse · Lever</div>
            </div>
            <div class="stat">
              <div class="stat-label">Requires</div>
              <div class="stat-value">Google Chrome</div>
            </div>
            <div class="stat">
              <div class="stat-label">Pricing</div>
              <div class="stat-value">Free to join</div>
            </div>
          </div>
        </section>

        <aside class="preview-wrap" aria-label="Aplyer extension preview">
          <div class="preview-glow"></div>
          <div class="preview">
            <div class="preview-bar">
              <span class="dot red"></span>
              <span class="dot yellow"></span>
              <span class="dot green"></span>
              <span class="preview-title">Aplyer · Popup</span>
            </div>
            <div class="popup">
              <div class="popup-head">
                <div class="popup-brand">
                  <svg width="28" height="28" viewBox="0 0 88 88" fill="none" aria-hidden="true">
                    <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#g)" stroke-width="2" />
                    <line x1="22" y1="28" x2="44" y2="44" stroke="#E5373A" stroke-width="5" stroke-linecap="round" />
                    <line x1="22" y1="60" x2="44" y2="44" stroke="#E5373A" stroke-width="5" stroke-linecap="round" />
                    <line x1="44" y1="44" x2="56" y2="56" stroke="#1DB954" stroke-width="5" stroke-linecap="round" />
                    <line x1="56" y1="56" x2="72" y2="28" stroke="#1DB954" stroke-width="5" stroke-linecap="round" />
                  </svg>
                  <div>
                    <div class="popup-brand-name">Aplyer</div>
                    <div class="popup-brand-sub">Companion</div>
                  </div>
                </div>
                <button class="icon-btn" type="button" aria-label="Refresh">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              </div>

              <div class="connected">
                <span class="check-circle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <div>
                  <div class="connected-mail">miqdadr9@gmail.com</div>
                  <div class="connected-status">Connected</div>
                </div>
              </div>

              <div class="pop-row">
                <div class="pop-row-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                  Sync
                </div>
                <div class="pop-row-value">Up to date</div>
              </div>
              <div class="pop-row">
                <div class="pop-row-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1DB954" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Resume
                </div>
                <div class="pop-row-value">attachment.pdf</div>
              </div>
              <div class="pop-row">
                <div class="pop-row-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 8 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 8 12 2"/></svg>
                  Plan
                </div>
                <div class="pop-row-value">Free</div>
              </div>

              <div class="popup-foot">
                <button class="pop-cta" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Open Dashboard
                </button>
                <div class="pop-row-buttons">
                  <span class="pop-ghost">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Settings
                  </span>
                  <span class="pop-ghost">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Logout
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <footer class="footer">
      <div class="container">© 2026 Aplyer.ai · <a href="mailto:hello@aplyer.ai" style="color: var(--sub);">hello@aplyer.ai</a></div>
    </footer>

    <script>
      async function downloadExtension(event) {
        event.preventDefault();
        try {
          const response = await fetch('/aplyer-extension.zip.b64', { cache: 'no-store' });
          if (!response.ok) throw new Error('Download failed: ' + response.status);
          const encoded = (await response.text()).replace(/\s/g, '');
          const binary = atob(encoded);
          const chunks = [];
          for (let offset = 0; offset < binary.length; offset += 262144) {
            const slice = binary.slice(offset, offset + 262144);
            const bytes = new Uint8Array(slice.length);
            for (let i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
            chunks.push(bytes);
          }
          const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'aplyer-extension.zip';
          link.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert(err.message);
        }
      }
    </script>
  </body>
</html>`;

mkdirSync("dist/client", { recursive: true });
writeFileSync("dist/client/index.html", html);
