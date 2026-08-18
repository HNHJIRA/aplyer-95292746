// Aplyer.ai Background Service Worker (Manifest V3)
const SESSION_KEY = "aplyer.session.v1";
const STATUS_KEY = "aplyer.ats_status.v1";
const SELECTED_KEY = "aplyer.selected_question.v1";
const SAFETY_KEY = "aplyer.job_safety_by_tab.v1";

const API_BASE = "https://aplyer.devssh.xyz";
const SAFETY_TTL_MS = 10 * 60 * 1000;

// Tab-scoped fraud-scan state: fraudScanByTab[tabId] = { url, hostname, result, scannedAt }
async function readSafetyMap() {
  const res = await chrome.storage.local.get(SAFETY_KEY);
  return res[SAFETY_KEY] || {};
}
async function writeSafetyEntry(tabId, entry) {
  const map = await readSafetyMap();
  if (entry) map[String(tabId)] = entry;
  else delete map[String(tabId)];
  await chrome.storage.local.set({ [SAFETY_KEY]: map });
}

async function runJobSafetyCheck(tabId, url) {
  if (!tabId || typeof url !== "string" || !url) return null;
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { return null; }

  const map = await readSafetyMap();
  const prev = map[String(tabId)];
  // Invalidate whenever the URL changed (SPA navigation included).
  if (prev && prev.url === url && Date.now() - prev.scannedAt < SAFETY_TTL_MS) return prev;

  let result = null;
  try {
    const res = await fetch(`${API_BASE}/api/public/job-safety-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The server independently parses the URL; we never send trusted/provider.
      body: JSON.stringify({ url }),
    });
    const json = await res.json().catch(() => null);
    if (json?.ok && json.result) result = json.result;
  } catch (e) {
    console.warn("[Aplyer] job safety check failed", String(e));
  }

  const entry = { url, hostname, result, scannedAt: Date.now() };
  await writeSafetyEntry(tabId, entry);
  return entry;
}

chrome.tabs?.onRemoved?.addListener((tabId) => { writeSafetyEntry(tabId, null); });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") console.log("[Aplyer.ai] Extension installed.");
});

// Enable side panel to open on action click (popup will still open; we use action API for popup)
try {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
} catch (_) {}

// External messages from the web app (auth bridge)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") { sendResponse({ ok: false, error: "Invalid payload" }); return true; }
  if (message.type === "APLYER_AUTH_SET" && message.session) {
    chrome.storage.local.set({ [SESSION_KEY]: message.session }, () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_AUTH_CLEAR") {
    chrome.storage.local.remove(SESSION_KEY, () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }
  sendResponse({ ok: false, error: "Unknown message type" });
  return true;
});

// Internal messages (popup + content scripts + sidepanel)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === "APLYER_GET_SESSION") {
    chrome.storage.local.get(SESSION_KEY, (res) => sendResponse({ session: res[SESSION_KEY] ?? null }));
    return true;
  }
  if (message.type === "APLYER_SIGN_OUT") {
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_CLEAR_ALL") {
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }


  // Content-script -> background: ATS status update
  if (message.type === "APLYER_ATS_STATUS" && message.payload) {
    chrome.storage.local.set({ [STATUS_KEY]: message.payload }, () => sendResponse?.({ ok: true }));
    return true;
  }

  // Content-script -> background: open side panel for a question
  if (message.type === "APLYER_OPEN_SIDE_PANEL") {
    const tabId = sender?.tab?.id;
    const payload = message.payload || {};
    const writes = {
      [STATUS_KEY]: { platform: payload.platform, platformKey: payload.platformKey, questionsCount: payload.questions?.length || 0, questions: payload.questions || [], url: payload.url },
      [SELECTED_KEY]: payload.question || null,
    };
    chrome.storage.local.set(writes, () => {
      try {
        if (tabId && chrome.sidePanel?.open) {
          chrome.sidePanel.open({ tabId });
        }
      } catch (e) {
        console.warn("[Aplyer] sidePanel.open failed", e);
      }
      sendResponse?.({ ok: true });
    });
    return true;
  }

  return false;
});
