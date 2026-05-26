chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ tearawayEnabled: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TEARAWAY_PIP_STATUS") {
    chrome.storage.local.set({ lastTear: message.payload });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "TEARAWAY_CAPTURE_VISIBLE_TAB") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tab = tabs && tabs[0];
        if (!tab) throw new Error("No active tab found");

        chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
          if (!dataUrl) {
            sendResponse({ ok: false, error: "captureVisibleTab returned empty dataUrl" });
            return;
          }
          sendResponse({ ok: true, dataUrl });
        });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "captureVisibleTab failed" });
      }
    })();
    return true; // keep the message channel open for async sendResponse
  }
});
