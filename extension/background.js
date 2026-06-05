// Aplyer.ai Background Service Worker (Manifest V3)
// Minimal foundation for future milestone features.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[Aplyer.ai] Extension installed. Welcome!");
  }
});

// Placeholder for future ATS detection and content script injection
chrome.action.onClicked.addListener((tab) => {
  // When user clicks the toolbar icon, the popup opens automatically.
  // This listener is optional for future direct-actions.
  console.log("[Aplyer.ai] Action clicked on tab:", tab.id);
});
