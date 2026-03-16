chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "…" });
  chrome.action.setBadgeBackgroundColor({ color: "#1976d2" });
});