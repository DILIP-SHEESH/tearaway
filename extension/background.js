/**
 * TearAway — background service worker
 *
 * Handles two jobs that content scripts cannot do reliably:
 *   1. TEARAWAY_CAPTURE_TAB  — screenshot the active tab (captureVisibleTab)
 *   2. TEARAWAY_CLIPBOARD_WRITE — write text to clipboard via scripting API
 *
 * Both are invoked by content.js via chrome.runtime.sendMessage().
 */

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

// ─── captureVisibleTab ────────────────────────────────────────────────────────
/**
 * Takes a full-viewport screenshot of the tab that sent the message.
 * Returns { ok: true, dataUrl } or { ok: false, error }.
 *
 * Why this works where html2canvas doesn't:
 *   - captureVisibleTab is a background-only API (requires "tabs" permission)
 *   - it captures the composited GPU frame — CORS images, canvas, SVG, video
 *     frames all appear correctly because we're reading the rendered output,
 *     not re-drawing the DOM from JS.
 *   - it is completely unaffected by the page's CSP.
 */
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

// ─── clipboard write ──────────────────────────────────────────────────────────
/**
 * Writes `text` to the clipboard of the sender tab.
 *
 * Why the content script can't do this reliably:
 *   - navigator.clipboard.writeText() requires the document to have focus
 *     AND the page origin to have clipboard-write permission granted.
 *     On http:// it always rejects. On CSP-heavy https:// it often rejects.
 *   - execCommand("copy") is deprecated and blocked on many sites.
 *
 * This approach:
 *   - Uses chrome.scripting.executeScript() to run a tiny function in the
 *     tab's MAIN world. Because it's injected by the extension (not the page),
 *     Chrome grants it clipboard access unconditionally — the extension has
 *     "clipboardWrite" in its permissions, so the injected script inherits it.
 *   - Works on http://, https://, CSP-locked sites, keyboard-intercepting
 *     SPAs — everywhere.
 */
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

/**
 * This function is serialised and injected into the tab by executeScript.
 * It must be self-contained (no closure references).
 */
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

// ─── inject html2canvas (CSP-safe fallback for PNG) ──────────────────────────
/**
 * Injects html2canvas.min.js into the tab using chrome.scripting.executeScript.
 *
 * Why this works when <script> tag injection doesn't:
 *   - A <script> tag created by content script JS is subject to the page's
 *     Content-Security-Policy: script-src header. Even chrome-extension:// URLs
 *     get blocked if not explicitly whitelisted by the site.
 *   - chrome.scripting.executeScript() is a privileged extension API.
 *     Chrome ALWAYS allows it regardless of the page's CSP. By design in MV3.
 *
 * We inject it as a FILE, which runs in the page's MAIN world, making
 * window.html2canvas available to the content script immediately after.
 */
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

/**
 * Last-resort: use an offscreen document (Chrome 116+) to write clipboard
 * from a background context. Only reached if executeScript fails entirely
 * (e.g. restricted URLs like chrome:// or file:// without permission).
 */
async function tryOffscreenClipboard(text) {
  try {
    // Offscreen documents aren't strictly needed for clipboard in most cases,
    // but this gives us a DOM context with focus in the extension world.
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