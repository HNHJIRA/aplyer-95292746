// Aplyer diagnostics overlay.
//
// Activates when the URL contains ?aplyer_debug=1 (or #aplyer_debug=1, or
// localStorage["aplyer_debug"] === "1"). Renders a non-intrusive floating
// panel reading from window.__aplyerDebug, which the orchestrator keeps
// up to date. Designed for manual QA against live Workday / Greenhouse /
// Lever tenants where the side panel can't easily surface internals.
(function () {
  if (window.top !== window) return; // top-frame only

  function enabled() {
    try {
      const s = location.search + " " + location.hash;
      if (/[?#&]aplyer_debug=1\b/.test(s)) return true;
      if (localStorage.getItem("aplyer_debug") === "1") return true;
    } catch {}
    return false;
  }
  if (!enabled()) return;

  // Persist so SPA route changes that drop the query still show the panel.
  try { localStorage.setItem("aplyer_debug", "1"); } catch {}

  const PANEL_ID = "aplyer-debug-panel";
  if (document.getElementById(PANEL_ID)) return;

  const css = `
    #${PANEL_ID}{position:fixed;top:12px;right:12px;z-index:2147483647;
      width:340px;max-height:80vh;overflow:auto;
      background:#0b1220;color:#e6eef8;border:1px solid #1f3050;
      border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);
      font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;}
    #${PANEL_ID} header{display:flex;align-items:center;gap:8px;
      padding:10px 12px;border-bottom:1px solid #1f3050;
      background:linear-gradient(180deg,#11203a,#0b1220);
      position:sticky;top:0;}
    #${PANEL_ID} header .ttl{font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:#1DB954;flex:1;}
    #${PANEL_ID} header button{background:#162842;color:#e6eef8;border:1px solid #1f3050;
      border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;}
    #${PANEL_ID} header button:hover{background:#1c3357;}
    #${PANEL_ID} .body{padding:10px 12px;}
    #${PANEL_ID} .row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;}
    #${PANEL_ID} .row .k{color:#7da2c8;}
    #${PANEL_ID} .row .v{color:#e6eef8;font-weight:600;text-align:right;word-break:break-word;}
    #${PANEL_ID} .v.ok{color:#1DB954;} #${PANEL_ID} .v.warn{color:#f5a524;} #${PANEL_ID} .v.err{color:#ef4444;}
    #${PANEL_ID} h4{margin:10px 0 4px;font-size:11px;color:#7da2c8;text-transform:uppercase;letter-spacing:.06em;}
    #${PANEL_ID} ul{margin:0;padding:0;list-style:none;max-height:120px;overflow:auto;border:1px solid #1f3050;border-radius:6px;}
    #${PANEL_ID} li{padding:4px 8px;border-bottom:1px solid #142239;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;}
    #${PANEL_ID} li:last-child{border-bottom:0;}
    #${PANEL_ID} .muted{color:#5b7aa3;}
    #${PANEL_ID}.min .body, #${PANEL_ID}.min h4, #${PANEL_ID}.min ul{display:none;}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <header>
      <span class="ttl">Aplyer · Diagnostics</span>
      <button data-act="copy" title="Copy diagnostics JSON">Copy</button>
      <button data-act="export" title="Download diagnostics JSON">Export</button>
      <button data-act="toggle" title="Minimize">–</button>
      <button data-act="close" title="Disable overlay">×</button>
    </header>
    <div class="body">
      <div class="row"><span class="k">Adapter</span><span class="v" data-f="adapterName">—</span></div>
      <div class="row"><span class="k">Adapter version</span><span class="v" data-f="adapterVersion">—</span></div>
      <div class="row"><span class="k">API version</span><span class="v" data-f="apiVersion">—</span></div>
      <div class="row"><span class="k">Orchestrator</span><span class="v" data-f="orchestratorVersion">—</span></div>
      <div class="row"><span class="k">Detection</span><span class="v" data-f="detection">pending</span></div>
      <div class="row"><span class="k">Detection source</span><span class="v" data-f="detectionSource">—</span></div>
      <div class="row"><span class="k">Questions detected</span><span class="v" data-f="questions">0</span></div>
      <div class="row"><span class="k">Buttons injected</span><span class="v" data-f="injections">0</span></div>
      <div class="row"><span class="k">Stable IDs</span><span class="v" data-f="stableIds">0</span></div>
      <div class="row"><span class="k">Mutation events</span><span class="v" data-f="mutations">0</span></div>
      <div class="row"><span class="k">Scans</span><span class="v" data-f="scans">0</span></div>
      <div class="row"><span class="k">Last scan</span><span class="v" data-f="lastScan">—</span></div>
      <div class="row"><span class="k">URL</span><span class="v muted" data-f="url">—</span></div>
      <h4>Stable IDs</h4><ul data-list="ids"><li class="muted">(none yet)</li></ul>
      <h4>Errors / warnings</h4><ul data-list="errors"><li class="muted">(none)</li></ul>
    </div>`;
  document.documentElement.appendChild(panel);

  function set(field, v, cls) {
    const el = panel.querySelector(`[data-f="${field}"]`);
    if (!el) return;
    el.textContent = v == null ? "—" : String(v);
    el.classList.remove("ok", "warn", "err");
    if (cls) el.classList.add(cls);
  }
  function fillList(name, items, empty) {
    const ul = panel.querySelector(`[data-list="${name}"]`);
    if (!ul) return;
    if (!items || !items.length) { ul.innerHTML = `<li class="muted">${empty}</li>`; return; }
    ul.innerHTML = items.slice(-30).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  function render() {
    const d = window.__aplyerDebug || {};
    set("adapterName", d.adapterName || "(no adapter)");
    set("adapterVersion", d.adapterVersion);
    set("apiVersion", d.apiVersion);
    set("orchestratorVersion", d.orchestratorVersion);
    const det = d.adapterName ? "detected" : "not detected";
    set("detection", det, d.adapterName ? "ok" : "warn");
    set("detectionSource", d.detectionSource || (d.adapterName ? "host+dom" : "—"));
    set("questions", d.questionsCount || 0, d.questionsCount ? "ok" : null);
    set("injections", d.injectionCount || 0);
    set("stableIds", (d.stableIds || []).length);
    set("mutations", d.mutationCount || 0);
    set("scans", d.scanCount || 0);
    set("lastScan", d.lastScanAt ? new Date(d.lastScanAt).toLocaleTimeString() : "—");
    set("url", location.href);
    fillList("ids", d.stableIds || [], "(none yet)");
    fillList("errors", (d.errors || []).map((e) => `[${e.level}] ${e.scope}: ${e.msg}`), "(none)");
  }

  function diagnosticsBlob() {
    const d = window.__aplyerDebug || {};
    return JSON.stringify({
      capturedAt: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      ...d,
    }, null, 2);
  }

  panel.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "toggle") { panel.classList.toggle("min"); e.target.textContent = panel.classList.contains("min") ? "+" : "–"; }
    if (act === "close") {
      try { localStorage.removeItem("aplyer_debug"); } catch {}
      panel.remove(); style.remove();
    }
    if (act === "copy") {
      const text = diagnosticsBlob();
      navigator.clipboard?.writeText(text).then(
        () => { e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy"), 1200); },
        () => { e.target.textContent = "Failed"; setTimeout(() => (e.target.textContent = "Copy"), 1200); },
      );
    }
    if (act === "export") {
      const blob = new Blob([diagnosticsBlob()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `aplyer-diagnostics-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });

  render();
  setInterval(render, 750);
})();
