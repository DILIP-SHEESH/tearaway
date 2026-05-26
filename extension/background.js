/**
 * TearAway — background service worker
 *
 * chrome.tabs.captureVisibleTab can ONLY be called from the background/service worker.
 * Content scripts relay requests here via sendMessage.
 */

// Toggle pick mode when extension icon is clicked (for sites that eat Alt key)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__tearaway?.togglePickMode?.(); },
    });
  } catch {}
  // popup handles it normally when popup is defined
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // PNG capture — must live here, not in content script
  if (msg.type === "TEARAWAY_CAPTURE_TAB") {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: "png", quality: 100 })
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // async, keep channel open
  }

  // Clipboard write relay — content scripts on http:// can't use Clipboard API
  // We write from the offscreen/background context instead
  if (msg.type === "TEARAWAY_CLIPBOARD_WRITE") {
    // Use scripting to write from the tab context (has user gesture blessing from the click)
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return; }
    chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => {
        try {
          // Textarea trick: works on all origins including http://
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch { return false; }
      },
      args: [msg.text],
    })
    .then(results => sendResponse({ ok: results?.[0]?.result === true }))
    .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === "TEARAWAY_PING") {
    sendResponse({ ok: true });
  }
});