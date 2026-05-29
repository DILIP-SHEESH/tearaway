chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TEARAWAY_CAPTURE_TAB") {
    handleCaptureTab(sender, sendResponse);
    return true; // keep channel open for async response
  }

  if (msg.type === "TEARAWAY_CLIPBOARD_WRITE") {
    handleClipboardWrite(msg.text, sender, sendResponse);
    return true;
  }

  if (msg.type === "TEARAWAY_INJECT_H2C") {
    handleInjectH2C(sender, sendResponse);
    return true;
  }
});


async function handleCaptureTab(sender, sendResponse) {
  try {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: "no tab id" });
      return;
    }

    // windowId is needed for captureVisibleTab
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 100,
    });

    sendResponse({ ok: true, dataUrl });
  } catch (err) {
    sendResponse({ ok: false, error: err?.message || "capture failed" });
  }
}


async function handleClipboardWrite(text, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: "no tab id" });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",   // run in page's JS world so document focus applies
      func: writeToClipboard,
      args: [text],
    });

    sendResponse({ ok: true });
  } catch (err) {
    // If executeScript itself fails (e.g. chrome:// URL), try offscreen strategy
    const fallback = await tryOffscreenClipboard(text);
    sendResponse({ ok: fallback, error: fallback ? null : err?.message });
  }
}


function writeToClipboard(text) {
  // Attempt 1: modern async clipboard
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => {
      // Attempt 2: legacy execCommand inside a temporary textarea
      legacyCopy(text);
    });
  }
  legacyCopy(text);

  function legacyCopy(str) {
    const ta = document.createElement("textarea");
    ta.value = str;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function handleInjectH2C(sender, sendResponse) {
  try {
    const tabId = sender.tab?.id;
    if (tabId == null) { sendResponse({ ok: false, error: "no tab id" }); return; }

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["lib/html2canvas.min.js"],
    });

    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err?.message });
  }
}

async function tryOffscreenClipboard(text) {
  try {
    const existing = await chrome.offscreen?.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!existing?.length) {
      await chrome.offscreen?.createDocument?.({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Clipboard write fallback for restricted pages",
      });
    }
    // Send to offscreen document if it exists
    await chrome.runtime.sendMessage({ type: "TEARAWAY_OFFSCREEN_CLIPBOARD", text });
    return true;
  } catch {
    return false;
  }
}