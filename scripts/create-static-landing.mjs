import { mkdirSync, writeFileSync } from "node:fs";

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aplyer.ai — Stop Skipping Jobs</title>
    <meta
      name="description"
      content="Aplyer is a Chrome extension that fills job application essay questions in your own voice using your resume."
    />
    <link rel="icon" href="/favicon.ico" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #080f1a;
        --paper: #0d1829;
        --field: #122038;
        --green: #1db954;
        --red: #e5373a;
        --white: #f5f5f5;
        --sub: #d7dde7;
        --muted: #9ba3ae;
        --border: rgba(255, 255, 255, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 18% 8%, rgba(29, 185, 84, 0.18), transparent 34rem),
          radial-gradient(circle at 86% 86%, rgba(229, 55, 58, 0.14), transparent 34rem),
          var(--bg);
        color: var(--white);
        font-family: Lato, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      .nav {
        border-bottom: 1px solid var(--border);
        background: rgba(8, 15, 26, 0.82);
        backdrop-filter: blur(18px);
      }

      .nav-inner,
      .hero,
      .strip,
      .footer {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
      }

      .nav-inner {
        height: 68px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-weight: 900;
        font-size: 21px;
        color: var(--green);
      }

      .logo {
        width: 34px;
        height: 34px;
      }

      .nav-cta,
      .primary,
      .secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border-radius: 12px;
        font-weight: 800;
        transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
      }

      .nav-cta {
        min-height: 40px;
        padding: 0 16px;
        background: var(--green);
        color: #06140a;
        font-size: 14px;
      }

      .hero {
        flex: 1;
        display: grid;
        align-items: center;
        grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
        gap: 54px;
        padding: 72px 0 56px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        border: 1px solid rgba(29, 185, 84, 0.34);
        border-radius: 999px;
        background: rgba(29, 185, 84, 0.1);
        color: var(--green);
        padding: 7px 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .pulse {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--green);
        box-shadow: 0 0 0 8px rgba(29, 185, 84, 0.12);
      }

      h1 {
        margin: 22px 0 0;
        max-width: 820px;
        font-size: clamp(42px, 8vw, 82px);
        line-height: 0.98;
        letter-spacing: 0;
      }

      .red {
        color: var(--red);
      }

      .green {
        color: var(--green);
      }

      .lead {
        margin: 24px 0 0;
        max-width: 610px;
        color: var(--sub);
        font-size: 18px;
        line-height: 1.7;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 34px;
      }

      .primary,
      .secondary {
        min-height: 52px;
        padding: 0 22px;
      }

      .primary {
        background: var(--green);
        color: #06140a;
        box-shadow: 0 18px 42px -20px rgba(29, 185, 84, 0.9);
      }

      .secondary {
        border: 1px solid var(--border);
        background: rgba(13, 24, 41, 0.72);
      }

      .primary:hover,
      .secondary:hover,
      .nav-cta:hover {
        transform: translateY(-2px);
      }

      .secondary:hover {
        border-color: rgba(29, 185, 84, 0.45);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 34px;
        max-width: 720px;
      }

      .stat {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: rgba(13, 24, 41, 0.64);
        padding: 14px;
      }

      .stat span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.09em;
      }

      .stat strong {
        display: block;
        margin-top: 8px;
        font-size: 14px;
      }

      .preview {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(18, 32, 56, 0.92), rgba(13, 24, 41, 0.96));
        box-shadow: 0 30px 80px -40px rgba(0, 0, 0, 0.8);
        overflow: hidden;
      }

      .bar {
        display: flex;
        gap: 7px;
        border-bottom: 1px solid var(--border);
        padding: 14px;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--red);
      }

      .dot:nth-child(2) { background: #f6c659; }
      .dot:nth-child(3) { background: var(--green); }

      .card {
        padding: 22px;
      }

      .field {
        border: 1px solid var(--border);
        border-radius: 14px;
        background: rgba(8, 15, 26, 0.48);
        padding: 16px;
        margin-bottom: 14px;
      }

      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.09em;
      }

      .copy {
        margin-top: 10px;
        color: var(--sub);
        line-height: 1.55;
      }

      .fill {
        height: 9px;
        border-radius: 999px;
        margin-top: 12px;
        background: linear-gradient(90deg, var(--green), rgba(29, 185, 84, 0.16));
      }

      .strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        padding-bottom: 48px;
      }

      .feature {
        border-top: 1px solid var(--border);
        padding-top: 18px;
      }

      .feature h2 {
        margin: 0;
        font-size: 17px;
      }

      .feature p {
        margin: 9px 0 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .footer {
        border-top: 1px solid var(--border);
        color: var(--muted);
        font-size: 13px;
        padding: 22px 0 32px;
      }

      @media (max-width: 880px) {
        .hero {
          grid-template-columns: 1fr;
          padding-top: 48px;
        }

        .stats,
        .strip {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 560px) {
        .nav-inner {
          height: auto;
          padding: 14px 0;
          align-items: flex-start;
          flex-direction: column;
        }

        .nav-cta,
        .primary,
        .secondary {
          width: 100%;
        }

        .actions,
        .stats,
        .strip {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="nav">
        <div class="nav-inner">
          <a class="brand" href="/" aria-label="Aplyer.ai home">
            <svg class="logo" viewBox="0 0 88 88" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="g" x1="0" y1="44" x2="88" y2="44">
                  <stop offset="0%" stop-color="#E5373A" />
                  <stop offset="50%" stop-color="#E5373A" />
                  <stop offset="50%" stop-color="#1DB954" />
                  <stop offset="100%" stop-color="#1DB954" />
                </linearGradient>
              </defs>
              <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#g)" stroke-width="2" />
              <path d="M22 28L44 44L22 60" stroke="#E5373A" stroke-width="5" stroke-linecap="round" />
              <path d="M44 44L56 56L72 28" stroke="#1DB954" stroke-width="5" stroke-linecap="round" />
            </svg>
            Aplyer.ai
          </a>
          <a class="nav-cta" href="/aplyer-extension.zip.b64" onclick="downloadExtension(event)">Download Extension</a>
        </div>
      </header>

      <main class="hero">
        <section>
          <div class="eyebrow"><span class="pulse"></span> Early Access Open</div>
          <h1>Stop <span class="red">Skipping</span> Jobs. Apply and <span class="green">sound like yourself</span> on every one.</h1>
          <p class="lead">
            Aplyer is a Chrome extension that fills long essay questions on job applications in your own voice — using your resume. Works inside Workday, Greenhouse, Lever, and employer careers pages.
          </p>
          <div class="actions">
            <a class="primary" href="/aplyer-extension.zip.b64" onclick="downloadExtension(event)">Download Extension →</a>
            <a class="secondary" href="mailto:hello@aplyer.ai">Contact Founder</a>
          </div>
          <div class="stats" aria-label="Extension highlights">
            <div class="stat"><span>Status</span><strong>● Early Access</strong></div>
            <div class="stat"><span>Works on</span><strong>Job forms</strong></div>
            <div class="stat"><span>Input</span><strong>Your resume</strong></div>
            <div class="stat"><span>Output</span><strong>Your voice</strong></div>
          </div>
        </section>

        <aside class="preview" aria-label="Aplyer extension preview">
          <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div class="card">
            <div class="field">
              <div class="label">Application question</div>
              <p class="copy">Why are you excited about this role?</p>
            </div>
            <div class="field">
              <div class="label">Aplyer answer</div>
              <p class="copy">I’m excited because this role connects directly with my experience, my strengths, and the problems I want to solve next.</p>
              <div class="fill"></div>
            </div>
            <div class="field">
              <div class="label">Ready to paste</div>
              <p class="copy">Generated from your resume, adjusted for the job, and written like you.</p>
            </div>
          </div>
        </aside>
      </main>

      <section class="strip">
        <div class="feature"><h2>Uses your resume</h2><p>Answers are grounded in your actual work history and experience.</p></div>
        <div class="feature"><h2>Works in the browser</h2><p>Open the extension while you are filling out job applications.</p></div>
        <div class="feature"><h2>Saves application time</h2><p>Move through long forms without leaving thoughtful questions blank.</p></div>
      </section>

      <footer class="footer">© 2026 Aplyer.ai</footer>
    </div>
    <script>
      async function downloadExtension(event) {
        event.preventDefault();
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
      }
    </script>
  </body>
</html>`;

mkdirSync("dist/client", { recursive: true });
writeFileSync("dist/client/index.html", html);