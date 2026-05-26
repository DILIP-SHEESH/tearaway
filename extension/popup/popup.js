const $ = id => document.getElementById(id);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg, cls = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${cls}`;
}

async function ensureInjected(tabId) {
  // ping first — if already injected, skip
  try {
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "TEARAWAY_PING" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 400)),
    ]);
    if (resp?.ok) return true;
  } catch {}

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/tearaway.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/tearaway2.js"] });
    return true;
  } catch (err) {
    console.warn("[TearAway popup] inject failed:", err);
    return false;
  }
}

$("btn-activate").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) { setStatus("No active tab found", "err"); return; }

  // Block chrome:// and other restricted URLs
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
    setStatus("Can't run on this page", "err"); return;
  }

  setStatus("Activating…", "info");
  const ok = await ensureInjected(tab.id);
  if (ok) {
    setStatus("Active — hold Alt to pick", "ok");
    setTimeout(() => window.close(), 1400);
  } else {
    setStatus("Injection failed (try a regular page)", "err");
  }
});

$("btn-restore").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__tearaway?.restoreLast(); return window.__tearaway?.getCount() ?? -1; },
    });
    const count = results?.[0]?.result;
    if (count === -1) setStatus("TearAway not active on this tab", "err");
    else setStatus(count === 0 ? "Nothing to restore" : "Restored last", count === 0 ? "" : "ok");
  } catch { setStatus("Not active on this tab", "err"); }
});

$("btn-restore-all").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__tearaway?.restoreAll(),
    });
    setStatus("All restored ✓", "ok");
  } catch { setStatus("Not active on this tab", "err"); }
});

$("link-demo").addEventListener("click", async e => {
  e.preventDefault();
  const url = chrome.runtime.getURL("demo/index.html");
  await chrome.tabs.create({ url });
  window.close();
});