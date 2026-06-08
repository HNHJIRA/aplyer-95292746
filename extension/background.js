// Aplyer.ai Background Service Worker (Manifest V3)

const SESSION_KEY = "aplyer.session.v1";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[Aplyer.ai] Extension installed.");
  }
});

// Receive auth session from the web app (/extension-auth bridge page)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid payload" });
    return true;
  }

  if (message.type === "APLYER_AUTH_SET" && message.session) {
    chrome.storage.local.set({ [SESSION_KEY]: message.session }, () => {
      sendResponse({ ok: true });
    });
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

// Allow popup to query / clear session via internal messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APLYER_GET_SESSION") {
    chrome.storage.local.get(SESSION_KEY, (res) => {
      sendResponse({ session: res[SESSION_KEY] ?? null });
    });
    return true;
  }
  if (message?.type === "APLYER_SIGN_OUT") {
    chrome.storage.local.remove(SESSION_KEY, () => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
