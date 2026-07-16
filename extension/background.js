// Aplyer.ai Background Service Worker (Manifest V3)
const SESSION_KEY = "aplyer.session.v1";
const STATUS_KEY = "aplyer.ats_status.v1";
const SELECTED_KEY = "aplyer.selected_question.v1";

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
