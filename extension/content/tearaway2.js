(() => {
  if (window !== window.top) return;
  if (window.__tearawayLoaded) return;
  window.__tearawayLoaded = true;

  // ─── constants ────────────────────────────────────────────────────────────
  const MIN_DRAG_PX = 40;
  const IGNORE_TAGS = new Set([
    "HTML","BODY","HEAD","SCRIPT","STYLE","LINK","META","NOSCRIPT","svg","path"
  ]);

  // ─── state ────────────────────────────────────────────────────────────────
  const STATE = {
    altHeld: false,
    pickMode: false,
    dragging: false,
    dragTarget: null,
    dragStart: null,
    dragMode: null,
    hoveredEl: null,
    tearCounter: 0,
    tearsById: new Map(),
    tornElements: new WeakSet(),
  };

  // ─── overlay nodes ────────────────────────────────────────────────────────
  let overlayRoot = null;
  let highlightBox = null;
  let hud = null;
  let ghost = null;

  // ─── helpers ──────────────────────────────────────────────────────────────
  const supportsDocPiP = () => "documentPictureInPicture" in window;

  function isEditable(el) {
    if (!el || !(el instanceof Element)) return false;
    const t = el.tagName;
    return t === "INPUT" || t === "TEXTAREA" || el.isContentEditable;
  }

  function inOverlay(el) {
    return !!(el && overlayRoot?.contains(el));
  }

  function getTearable(from) {
    let el = from;
    while (el instanceof Element) {
      if (IGNORE_TAGS.has(el.tagName.toUpperCase())) { el = el.parentElement; continue; }
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) return el;
      el = el.parentElement;
    }
    return null;
  }

  function cssEscape(v) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return "";
    if (el.id) return `#${cssEscape(el.id)}`;
    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur instanceof Element; i++) {
      let p = cur.tagName.toLowerCase();
      if (cur.classList?.length)
        p += "." + [...cur.classList].slice(0, 2).map(cssEscape).join(".");
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) p += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function deriveLabel(el) {
    const explicit =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.id ||
      el.dataset?.testid ||
      el.dataset?.componentName ||
      el.dataset?.label;
    if (explicit) return explicit;

    const heading = el.querySelector("h1,h2,h3,h4,h5,h6,legend,caption");
    if (heading?.textContent?.trim()) return heading.textContent.trim().slice(0, 60);

    const btn = el.matches("button,a,[role=button]") ? el : el.querySelector("button,a,[role=button]");
    if (btn?.textContent?.trim()) return btn.textContent.trim().slice(0, 60);

    const txt = el.textContent?.trim() ?? "";
    if (txt.length > 0 && txt.length <= 60) return txt;

    const tag = el.tagName.toLowerCase();
    if (typeof el.className === "string") {
      const cls = [...el.classList].find(c =>
        c.length > 3 && !/^(comp|js-|is-|has-|ng-|v-|react-|svelte-|\d)/.test(c)
      );
      if (cls) return `${tag}.${cls}`;
    }
    return tag;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, m =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])
    );
  }

  // ─── overlay ─────────────────────────────────────────────────────────────
  function ensureOverlay() {
    if (overlayRoot?.isConnected) return;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "ta-overlay-root";
    document.documentElement.appendChild(overlayRoot);

    highlightBox = document.createElement("div");
    highlightBox.className = "ta-highlight";
    highlightBox.hidden = true;
    overlayRoot.appendChild(highlightBox);

    hud = document.createElement("div");
    hud.className = "ta-hud";
    hud.hidden = true;
    overlayRoot.appendChild(hud);
  }

  function setHud(visible, html) {
    ensureOverlay();
    hud.hidden = !visible;
    if (html != null) hud.innerHTML = html;
  }

  function updateHighlight(el) {
    ensureOverlay();
    if (!el) { highlightBox.hidden = true; return; }
    const r = el.getBoundingClientRect();
    highlightBox.hidden = false;
    Object.assign(highlightBox.style, {
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
  }

  // ─── toast ───────────────────────────────────────────────────────────────
  const _toastStack = [];
  function showToast(msg, type = "info") {
    ensureOverlay();
    const t = document.createElement("div");
    t.className = `ta-toast ta-toast--${type}`;
    t.textContent = msg;
    _toastStack.push(t);
    overlayRoot.appendChild(t);
    repositionToasts();
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("ta-toast--in")));
    setTimeout(() => {
      t.classList.remove("ta-toast--in");
      setTimeout(() => { t.remove(); _toastStack.splice(_toastStack.indexOf(t), 1); repositionToasts(); }, 300);
    }, 3200);
  }

  function repositionToasts() {
    _toastStack.forEach((t, i) => { t.style.bottom = `${20 + i * 46}px`; });
  }

  // ─── pick mode ───────────────────────────────────────────────────────────
  function enterPickMode() {
    if (STATE.pickMode) return;
    STATE.pickMode = true;
    setHud(true,
      '<kbd>Alt</kbd> pick mode &nbsp;·&nbsp; click to tear &nbsp;·&nbsp; ' +
      '<kbd>⇧</kbd> safe clone &nbsp;·&nbsp; <kbd>Esc</kbd> restore last'
    );
  }

  function exitPickMode() {
    STATE.pickMode = false;
    STATE.hoveredEl = null;
    updateHighlight(null);
    if (!STATE.dragging) setHud(false);
  }

  function togglePickMode() {
    STATE.pickMode ? exitPickMode() : enterPickMode();
  }

  // ─── style copying ───────────────────────────────────────────────────────
  function copyStylesInto(doc) {
    [...document.styleSheets].forEach(sheet => {
      try {
        if (sheet.href) {
          const l = doc.createElement("link");
          l.rel = "stylesheet"; l.href = sheet.href;
          doc.head.appendChild(l);
        } else if (sheet.cssRules) {
          const s = doc.createElement("style");
          s.textContent = [...sheet.cssRules].map(r => r.cssText).join("\n");
          doc.head.appendChild(s);
        }
      } catch {
        if (sheet.href) {
          const l = doc.createElement("link"); l.rel = "stylesheet"; l.href = sheet.href;
          doc.head.appendChild(l);
        }
      }
    });
  }

  // ─── PiP chrome ──────────────────────────────────────────────────────────
  function injectPipChrome(doc, label, tearId, mode) {
    const style = doc.createElement("style");
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: auto;
        background: #080810; font-family: 'IBM Plex Mono', monospace; color: #e2e2f0; }
      #ta-shell { min-height: 100%; display: flex; flex-direction: column; }
      #ta-bar {
        flex: 0 0 auto; display: flex; align-items: center;
        justify-content: space-between; gap: 8px; padding: 8px 12px;
        background: #0d0d18; border-bottom: 1px solid rgba(255,255,255,0.06);
        user-select: none;
      }
      #ta-bar-left { display: flex; gap: 8px; align-items: center; overflow: hidden; min-width: 0; }
      .ta-pip-badge {
        flex-shrink: 0; font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
        text-transform: uppercase; padding: 2px 8px; border-radius: 3px;
      }
      .ta-pip-badge--live { background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.4); color: #a5b4fc; }
      .ta-pip-badge--safe { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #6ee7b7; }
      .ta-pip-label { font-size: 11px; color: #6060a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ta-pip-actions { display: flex; gap: 5px; flex-shrink: 0; }
      .ta-pip-btn {
        appearance: none; border: 1px solid rgba(255,255,255,0.09);
        background: rgba(255,255,255,0.04); color: #9090c0;
        border-radius: 5px; font: 500 10px 'IBM Plex Mono', monospace;
        padding: 4px 10px; cursor: pointer; letter-spacing: 0.04em;
        transition: background .12s, border-color .12s, color .12s;
      }
      .ta-pip-btn:hover { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.45); color: #e0e0ff; }
      .ta-pip-btn--restore:hover { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #fca5a5; }
      #ta-body { flex: 1 1 auto; padding: 10px; overflow: auto; }
      #ta-body > * { max-width: 100%; }
    `;
    doc.head.appendChild(style);

    const shell = doc.createElement("div"); shell.id = "ta-shell";
    const bar = doc.createElement("div"); bar.id = "ta-bar";
    const left = doc.createElement("div"); left.id = "ta-bar-left";

    const badge = doc.createElement("span");
    badge.className = `ta-pip-badge ta-pip-badge--${mode}`;
    badge.textContent = mode;

    const lbl = doc.createElement("span");
    lbl.className = "ta-pip-label";
    lbl.title = label; lbl.textContent = label;
    left.append(badge, lbl);

    const acts = doc.createElement("div"); acts.className = "ta-pip-actions";
    const mkBtn = (text, cls, fn) => {
      const b = doc.createElement("button"); b.type = "button";
      b.className = `ta-pip-btn${cls ? " "+cls : ""}`;
      b.textContent = text; b.addEventListener("click", fn); return b;
    };
    acts.append(
      mkBtn("Restore", "ta-pip-btn--restore", () => restoreTear(tearId)),
      mkBtn("PNG",     "",                     () => downloadPng(tearId)),
      mkBtn("Copy Selector", "",               () => copySelector(tearId)),
      mkBtn("Copy HTML",     "",               () => copyHtml(tearId)),
    );

    bar.append(left, acts);
    const body = doc.createElement("div"); body.id = "ta-body";
    shell.append(bar, body);
    doc.body.appendChild(shell);
    return body;
  }

  // ─── fallback panel ──────────────────────────────────────────────────────
  function createFallbackPanel(tear) {
    const { element, label, mode, id, capture, safeClone } = tear;
    const { rect } = capture;

    const panel = document.createElement("div");
    panel.id = `ta-panel-${id}`;
    Object.assign(panel.style, {
      position: "fixed",
      left: `${Math.min(rect.left, window.innerWidth - Math.max(rect.width,320) - 16)}px`,
      top: `${Math.min(rect.top + 20, window.innerHeight - 180)}px`,
      width: `${Math.max(rect.width, 320)}px`, maxHeight: "74vh",
      zIndex: "2147483645", background: "#080810",
      border: "1px solid rgba(99,102,241,0.35)",
      borderRadius: "10px",
      boxShadow: "0 24px 72px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
      overflow: "hidden", resize: "both", pointerEvents: "auto",
    });

    // bar
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      cursor: "move", padding: "8px 12px", background: "#0d0d18",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: "8px", userSelect: "none",
    });

    const left = document.createElement("div");
    left.style.cssText = "display:flex;gap:8px;align-items:center;overflow:hidden;min-width:0";
    const badge = document.createElement("span");
    Object.assign(badge.style, {
      fontSize:"9px", fontWeight:"600", letterSpacing:"0.1em", textTransform:"uppercase",
      padding:"2px 8px", borderRadius:"3px",
      background: mode==="safe" ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.18)",
      border: mode==="safe" ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(99,102,241,0.4)",
      color: mode==="safe" ? "#6ee7b7" : "#a5b4fc",
    });
    badge.textContent = mode;
    const lbl = document.createElement("span");
    Object.assign(lbl.style,{fontSize:"11px",color:"#5050a0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"});
    lbl.textContent = label;
    left.append(badge, lbl);

    const acts = document.createElement("div");
    acts.style.cssText = "display:flex;gap:5px;flex-shrink:0";

    const mkBtn = (text, danger, fn) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text;
      Object.assign(b.style, {
        appearance:"none", border:"1px solid rgba(255,255,255,0.09)",
        background:"rgba(255,255,255,0.04)", color:"#9090c0",
        borderRadius:"5px", font:"500 10px/1 'IBM Plex Mono',monospace",
        padding:"4px 9px", cursor:"pointer", letterSpacing:"0.04em",
      });
      b.onmouseover = () => Object.assign(b.style, danger
        ? {background:"rgba(239,68,68,0.15)",borderColor:"rgba(239,68,68,0.4)",color:"#fca5a5"}
        : {background:"rgba(99,102,241,0.2)",borderColor:"rgba(99,102,241,0.45)",color:"#e0e0ff"});
      b.onmouseout = () => Object.assign(b.style, {background:"rgba(255,255,255,0.04)",borderColor:"rgba(255,255,255,0.09)",color:"#9090c0"});
      b.addEventListener("click", fn); return b;
    };
    acts.append(
      mkBtn("Restore", true,  () => restoreTear(id)),
      mkBtn("PNG",     false, () => downloadPng(id)),
      mkBtn("Selector",false, () => copySelector(id)),
      mkBtn("HTML",    false, () => copyHtml(id)),
    );
    bar.append(left, acts);

    const body = document.createElement("div");
    Object.assign(body.style, { padding:"8px", overflow:"auto", maxHeight:"calc(74vh - 42px)", pointerEvents:"auto" });

    panel.append(bar, body);
    document.documentElement.appendChild(panel);

    // drag
    let ox=0, oy=0;
    bar.addEventListener("mousedown", e => {
      ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
      const mv = ev => { panel.style.left=`${ev.clientX-ox}px`; panel.style.top=`${ev.clientY-oy}px`; };
      const up = () => { document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); };
      document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    });

    body.appendChild(mode === "live" ? element : (safeClone || element.cloneNode(true)));
    panel.addEventListener("mousedown", e => e.stopPropagation());
    tear.panel = panel;
  }

  // ─── computed style snapshot for safe clone ───────────────────────────────
  function snapshotComputedStyles(src, dst) {
    try {
      const cs = window.getComputedStyle(src);
      const keys = [
        "display","flexDirection","flexWrap","justifyContent","alignItems","gap",
        "grid","gridTemplateColumns","gridTemplateRows",
        "backgroundColor","backgroundImage","background",
        "color","fontSize","fontWeight","fontFamily","lineHeight","letterSpacing",
        "padding","paddingTop","paddingRight","paddingBottom","paddingLeft",
        "borderRadius","boxShadow","border","outline","opacity","overflow",
        "width","height","minWidth","minHeight","maxWidth","maxHeight",
      ];
      keys.forEach(k => { try { dst.style[k] = cs[k]; } catch {} });
    } catch {}
  }

  // ─── tear ─────────────────────────────────────────────────────────────────
  async function tearElement(element, mode) {
    if (!element) return;
    if (STATE.tornElements.has(element)) {
      showToast("Already torn — restore it first", "warn"); return;
    }
    ensureOverlay();
    const label = deriveLabel(element);
    const rect = element.getBoundingClientRect();
    const id = String(++STATE.tearCounter);
    const pipW = Math.min(Math.max(Math.round(rect.width), 340), 980);
    const pipH = Math.min(Math.max(Math.round(rect.height + 50), 240), 840);

    const placeholder = document.createElement("div");
    placeholder.dataset.tearawayPlaceholder = "1";
    placeholder.style.cssText =
      `min-height:${rect.height}px;` +
      `outline:1.5px dashed rgba(99,102,241,0.3);` +
      `border-radius:6px;background:rgba(99,102,241,0.04);pointer-events:none;`;
    element.parentNode?.insertBefore(placeholder, element);

    let safeClone = null, origDisplay = null;
    if (mode === "safe") {
      safeClone = element.cloneNode(true);
      snapshotComputedStyles(element, safeClone);
      try { safeClone.style.display = ""; safeClone.style.visibility = ""; } catch {}
      origDisplay = element.style.display;
      element.style.display = "none";
    }

    const tear = {
      id, mode, label, element, placeholder,
      panel: null, pipWindow: null, pipWatchdog: null,
      safeClone, exportDisplayRestore: origDisplay,
      exportSelector: buildSelector(element),
      capture: {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        scrollX: window.scrollX, scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    };
    STATE.tearsById.set(id, tear);
    STATE.tornElements.add(element);

    if (!supportsDocPiP()) {
      createFallbackPanel(tear);
      exitPickMode(); setHud(false);
      showToast(`Torn: ${label}`, "success");
      return;
    }

    try {
      const pipWin = await documentPictureInPicture.requestWindow({ width: pipW, height: pipH });
      copyStylesInto(pipWin.document);
      const body = injectPipChrome(pipWin.document, label, id, mode);
      body.appendChild(mode === "live" ? element : (safeClone || element.cloneNode(true)));
      tear.pipWindow = pipWin;

      const once = () => restoreTear(id);
      ["pagehide","unload","beforeunload"].forEach(ev => pipWin.addEventListener(ev, once));
      tear.pipWatchdog = setInterval(() => {
        const t = STATE.tearsById.get(id);
        if (!t?.pipWindow || t.pipWindow.closed) restoreTear(id);
      }, 500);

      exitPickMode(); setHud(false);
      showToast(`${mode === "safe" ? "Safe clone" : "Torn live"}: ${label}`, "success");
    } catch (err) {
      placeholder.remove();
      STATE.tornElements.delete(element);
      if (mode === "safe") element.style.display = origDisplay ?? "";
      STATE.tearsById.delete(id);
      showToast(`Tear failed: ${err?.message || "gesture required"}`, "error");
    }
  }

  // ─── restore ─────────────────────────────────────────────────────────────
  function restoreTear(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;
    clearInterval(tear.pipWatchdog);
    const { element, placeholder, pipWindow, panel, mode } = tear;

    if (mode === "live") {
      if (placeholder?.parentNode && element) {
        placeholder.parentNode.insertBefore(element, placeholder);
        placeholder.remove();
      }
    } else {
      if (element) element.style.display = tear.exportDisplayRestore ?? "";
      placeholder?.parentNode?.removeChild(placeholder);
    }

    if (pipWindow && !pipWindow.closed) try { pipWindow.close(); } catch {}
    if (panel) try { panel.remove(); } catch {}

    STATE.tornElements.delete(element);
    STATE.tearsById.delete(String(tearId));
    showToast("Restored", "info");
  }

  function restoreAll() {
    [...STATE.tearsById.keys()].forEach(id => restoreTear(id));
  }
  function restoreLast() {
    const ids = [...STATE.tearsById.keys()];
    if (ids.length) restoreTear(ids[ids.length - 1]);
  }

  // ─── clipboard ────────────────────────────────────────────────────────────
  async function writeClipboard(text) {
    // Strategy 1: relay through background.js (most reliable — works everywhere)
    try {
      const resp = await chrome.runtime.sendMessage({ type: "TEARAWAY_CLIPBOARD_WRITE", text });
      if (resp?.ok) return true;
    } catch {}

    // Strategy 2: native clipboard API (works on focused https:// pages)
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    // Strategy 3: textarea execCommand (deprecated but last resort)
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }

  function copySelector(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;
    writeClipboard(tear.exportSelector || buildSelector(tear.element)).then(ok => {
      showToast(ok ? "Selector copied ✓" : "Clipboard unavailable", ok ? "success" : "warn");
    });
  }

  function copyHtml(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;
    const el = tear.element;
    const prev = el.style.display;
    if (tear.mode === "safe") el.style.display = tear.exportDisplayRestore ?? "";
    const html = el.outerHTML || "";
    if (tear.mode === "safe") el.style.display = prev;
    writeClipboard(html).then(ok => {
      showToast(ok ? "HTML copied ✓" : "Clipboard unavailable", ok ? "success" : "warn");
    });
  }

  // ─── PNG download ────────────────────────────────────────────────────────
  //
  // PRIMARY PATH — captureVisibleTab + crop:
  //   background.js captures the live GPU frame via chrome.tabs.captureVisibleTab,
  //   we crop to the element rect. Perfect pixels, handles CORS/video/canvas.
  //
  // FALLBACK PATH — manual canvas painter (zero extension APIs):
  //   Used when chrome.runtime is gone (extension reloaded while tab is open).
  //   We walk the element's box tree and paint each node onto an OffscreenCanvas
  //   using only 2D canvas primitives — no XMLSerializer, no DOM serialisation,
  //   no chrome.* calls at all. Handles backgrounds, borders, border-radius,
  //   text, and nested children. Cross-origin images are skipped (blank).
  //
  // WHY NOT XMLSerializer / foreignObject:
  //   Chrome's XMLSerializer internally calls chrome.runtime.getURL() to resolve
  //   extension-origin resource references embedded in the DOM. When the context
  //   is invalidated chrome.runtime is undefined → "Cannot read properties of
  //   undefined (reading 'getURL')". This crash happens before we even draw
  //   anything, so there is no safe way to use XMLSerializer in this scenario.
  //

  /** True when chrome.runtime is alive and usable */
  function _runtimeAlive() {
    try { return !!(chrome?.runtime?.id); } catch { return false; }
  }

  /**
   * Temporarily move the element into the visible page DOM so
   * captureVisibleTab can see it. Returns an async undo function.
   */
  function _showForCapture(tear) {
    const { element, mode, placeholder, exportDisplayRestore, pipWindow } = tear;
    let undo = () => {};
    if (mode === "live" && pipWindow && !pipWindow.closed) {
      const parent = placeholder?.parentNode || document.body;
      parent.insertBefore(element, placeholder || null);
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      undo = () => {
        try {
          const b = pipWindow.document.querySelector("#ta-body");
          if (b) b.appendChild(element);
        } catch {}
      };
    } else if (mode === "safe") {
      const prev = element.style.display;
      element.style.display = exportDisplayRestore ?? "";
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      undo = () => { element.style.display = prev; };
    }
    return undo;
  }

  /**
   * Pure-canvas fallback PNG export.
   * Walks the element's subtree, reads getComputedStyle() for each node,
   * and paints backgrounds / borders / text onto a canvas.
   * Never touches chrome.* or XMLSerializer.
   */
  async function _canvasFallbackPng(tear) {
    showToast("Using canvas fallback…", "info");
    const { element, mode, exportDisplayRestore } = tear;

    // Un-hide if safe mode so we get real rects
    let prevDisplay = null;
    if (mode === "safe") {
      prevDisplay = element.style.display;
      element.style.display = exportDisplayRestore ?? "";
    }
    await new Promise(r => requestAnimationFrame(r));

    const rootRect = element.getBoundingClientRect();
    const w   = Math.max(Math.round(rootRect.width),  1);
    const h   = Math.max(Math.round(rootRect.height), 1);
    const dpr = window.devicePixelRatio || 1;
    const ox  = rootRect.left;   // origin x — subtract from every rect
    const oy  = rootRect.top;    // origin y

    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Fill with the nearest opaque ancestor background so we don't get
    // a transparent (looks white) canvas
    const pageBg = (() => {
      let el = element.parentElement;
      while (el && el !== document.documentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        el = el.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor || "#fff";
    })();
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, w, h);

    // ── Recursive painter ─────────────────────────────────────────────────
    function paintNode(node) {
      if (!(node instanceof Element)) return;
      const r   = node.getBoundingClientRect();
      const cs  = getComputedStyle(node);
      const x   = r.left - ox;
      const y   = r.top  - oy;
      const nw  = r.width;
      const nh  = r.height;
      if (nw <= 0 || nh <= 0) return;

      ctx.save();

      // Border-radius clip
      const radii = [
        parseFloat(cs.borderTopLeftRadius)     || 0,
        parseFloat(cs.borderTopRightRadius)    || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
        parseFloat(cs.borderBottomLeftRadius)  || 0,
      ];
      const hasRadius = radii.some(r => r > 0);
      if (hasRadius) {
        ctx.beginPath();
        ctx.moveTo(x + radii[0], y);
        ctx.lineTo(x + nw - radii[1], y);
        ctx.quadraticCurveTo(x + nw, y, x + nw, y + radii[1]);
        ctx.lineTo(x + nw, y + nh - radii[2]);
        ctx.quadraticCurveTo(x + nw, y + nh, x + nw - radii[2], y + nh);
        ctx.lineTo(x + radii[3], y + nh);
        ctx.quadraticCurveTo(x, y + nh, x, y + nh - radii[3]);
        ctx.lineTo(x, y + radii[0]);
        ctx.quadraticCurveTo(x, y, x + radii[0], y);
        ctx.closePath();
        ctx.clip();
      }

      // Background color
      const bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, nw, nh);
      }

      // Background image (solid color gradients only — skip url() to avoid taint)
      const bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== "none" && !bgImg.startsWith("url(")) {
        try {
          // linear-gradient / radial-gradient — create a temporary element
          // and read it back as a canvas fill (limited but covers common cases)
          const tmp = document.createElement("canvas");
          tmp.width = Math.round(nw); tmp.height = Math.round(nh);
          const tmpCtx = tmp.getContext("2d");
          const tmpEl = document.createElement("div");
          tmpEl.style.cssText = `position:fixed;left:-9999px;top:0;width:${nw}px;height:${nh}px;background:${bgImg}`;
          document.documentElement.appendChild(tmpEl);
          // We can't actually read pixels from a DOM element directly,
          // but we can at least not crash. Skip for now.
          tmpEl.remove();
        } catch {}
      }

      // Border
      const bw  = parseFloat(cs.borderTopWidth) || 0;
      const bc  = cs.borderTopColor;
      const bst = cs.borderTopStyle;
      if (bw > 0 && bst !== "none" && bc && bc !== "rgba(0, 0, 0, 0)") {
        ctx.strokeStyle = bc;
        ctx.lineWidth   = bw;
        if (hasRadius) {
          ctx.stroke();
        } else {
          ctx.strokeRect(x + bw/2, y + bw/2, nw - bw, nh - bw);
        }
      }

      // Box shadow (single shadow, approximate)
      const shadow = cs.boxShadow;
      if (shadow && shadow !== "none") {
        try {
          // Parse first shadow only: "Xpx Ypx Blur Spread Color"
          const m = shadow.match(/([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px(?:\s+([-\d.]+)px)?\s+(rgba?\([^)]+\)|#\S+|\w+)/);
          if (m) {
            ctx.save();
            ctx.shadowOffsetX = parseFloat(m[1]);
            ctx.shadowOffsetY = parseFloat(m[2]);
            ctx.shadowBlur    = parseFloat(m[3]);
            ctx.shadowColor   = m[5];
            ctx.fillStyle     = "transparent";
            ctx.fillRect(x, y, nw, nh);
            ctx.restore();
          }
        } catch {}
      }

      // Text nodes — paint inline text for leaf elements
      if (node.childElementCount === 0) {
        const text = node.textContent?.trim();
        if (text) {
          const fs    = cs.fontSize    || "14px";
          const fw    = cs.fontWeight  || "normal";
          const ff    = cs.fontFamily  || "sans-serif";
          const color = cs.color       || "#000";
          const align = cs.textAlign   || "left";
          const lh    = parseFloat(cs.lineHeight) || parseFloat(fs) * 1.2;
          const pt    = parseFloat(cs.paddingTop)  || 0;
          const pl    = parseFloat(cs.paddingLeft) || 0;

          ctx.font         = `${fw} ${fs} ${ff}`;
          ctx.fillStyle    = color;
          ctx.textBaseline = "top";
          ctx.textAlign    = align === "center" ? "center"
                           : align === "right"  ? "right" : "left";

          const textX = align === "center" ? x + nw / 2
                      : align === "right"  ? x + nw - pl
                      : x + pl;

          // Simple word-wrap
          const maxW = nw - pl * 2;
          const words = text.split(/\s+/);
          let line = "", lineY = y + pt;
          for (const word of words) {
            const test = line ? line + " " + word : word;
            if (ctx.measureText(test).width > maxW && line) {
              ctx.fillText(line, textX, lineY, maxW);
              line = word; lineY += lh;
            } else { line = test; }
          }
          if (line) ctx.fillText(line, textX, lineY, maxW);
        }
      }

      ctx.restore();

      // Recurse into children
      for (const child of node.children) paintNode(child);
    }

    try {
      paintNode(element);

      // Re-hide safe-mode element
      if (mode === "safe" && prevDisplay !== null) {
        element.style.display = prevDisplay;
      }

      triggerDownload(canvas.toDataURL("image/png"), tear);
      showToast(`PNG downloaded ✓ (${canvas.width}×${canvas.height}px)`, "success");
    } catch (err) {
      if (mode === "safe" && prevDisplay !== null) {
        element.style.display = prevDisplay;
      }
      showToast(`PNG fallback failed: ${err.message}`, "error");
    }
  }

  async function downloadPng(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;

    // ── Fast path: extension context is gone — go straight to canvas fallback
    if (!_runtimeAlive()) {
      showToast("Extension reloaded — using canvas fallback", "warn");
      await _canvasFallbackPng(tear);
      return;
    }

    showToast("Capturing…", "info");

    // ── Step 1: make element visible in the page for the screenshot ──────────
    const undoShow = _showForCapture(tear);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // ── Step 2: fresh bounding rect ──────────────────────────────────────────
    const liveRect = tear.element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // ── Step 3: captureVisibleTab via background ──────────────────────────────
    let dataUrl = null;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "TEARAWAY_CAPTURE_TAB" });
      if (resp?.ok && resp.dataUrl) {
        dataUrl = resp.dataUrl;
      } else {
        throw new Error(resp?.error || "capture returned no data");
      }
    } catch (err) {
      undoShow();
      // If context died between our check and the actual send, fall back
      const dead = !_runtimeAlive() ||
        (err?.message || "").toLowerCase().includes("invalidated") ||
        (err?.message || "").toLowerCase().includes("receiving end");
      if (dead) {
        showToast("Extension reloaded — using canvas fallback", "warn");
        await _canvasFallbackPng(tear);
      } else {
        showToast(`PNG failed: ${err.message}`, "error");
      }
      return;
    }

    // ── Step 4: put element back where it was ────────────────────────────────
    undoShow();

    // ── Step 5: crop the screenshot to the element rect ──────────────────────
    try {
      const img = await loadImage(dataUrl);

      const sx = Math.round(liveRect.left   * dpr);
      const sy = Math.round(liveRect.top    * dpr);
      const sw = Math.round(liveRect.width  * dpr);
      const sh = Math.round(liveRect.height * dpr);

      const csx = Math.max(0, Math.min(sx, img.naturalWidth));
      const csy = Math.max(0, Math.min(sy, img.naturalHeight));
      const csw = Math.min(sw, img.naturalWidth  - csx);
      const csh = Math.min(sh, img.naturalHeight - csy);

      if (csw <= 0 || csh <= 0) {
        showToast("Element outside viewport — scroll it into view first", "warn");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width  = csw;
      canvas.height = csh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, csx, csy, csw, csh, 0, 0, csw, csh);

      triggerDownload(canvas.toDataURL("image/png"), tear);
      showToast(`PNG downloaded ✓ (${csw}×${csh}px @${dpr}x)`, "success");
    } catch (err) {
      showToast(`PNG crop failed: ${err.message}`, "error");
    }
  }

  /** Load a data/blob URL into an HTMLImageElement */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load screenshot image"));
      img.src = src;
    });
  }

  function triggerDownload(dataUrl, tear) {
    const safe = String(tear.label || "tearaway")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "element";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `tearaway-${safe}-${tear.id}.png`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  // ─── drag ghost ──────────────────────────────────────────────────────────
  function removeGhost() { if (ghost) { ghost.remove(); ghost = null; } }

  function startGhost(el) {
    removeGhost();
    const r = el.getBoundingClientRect();
    ghost = document.createElement("div");
    ghost.className = "ta-ghost";
    Object.assign(ghost.style, {
      width: `${r.width}px`, height: `${r.height}px`,
      left: `${r.left}px`, top: `${r.top}px`,
    });
    ghost.innerHTML = `<span class="ta-ghost-label">
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style="flex-shrink:0">
        <path d="M4 4h5v2H6v8h8v-3h2v5H4V4z" fill="currentColor" opacity=".5"/>
        <path d="M11 4h5v5h-2V6.4l-5.3 5.3-1.4-1.4L12.6 5H11V3z" fill="currentColor"/>
      </svg>
      drag off-page to tear
    </span>`;
    ensureOverlay();
    overlayRoot.appendChild(ghost);
  }

  function moveGhost(cx, cy) {
    if (!ghost || !STATE.dragStart) return;
    ghost.style.left = `${STATE.dragStart.elLeft + cx - STATE.dragStart.x}px`;
    ghost.style.top  = `${STATE.dragStart.elTop  + cy - STATE.dragStart.y}px`;
  }

  const dragDist = (x, y) => STATE.dragStart ? Math.hypot(x - STATE.dragStart.x, y - STATE.dragStart.y) : 0;
  const offPage  = (x, y) => x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;

  // ─── events ──────────────────────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (e.shiftKey) { restoreAll(); return; }
      if (STATE.pickMode) { exitPickMode(); return; }
      restoreLast(); return;
    }
    if (e.key !== "Alt" || e.repeat) return;
    if (isEditable(e.target) || inOverlay(e.target)) return;
    STATE.altHeld = true; enterPickMode();
  }, true);

  document.addEventListener("keyup", e => {
    if (e.key !== "Alt") return;
    STATE.altHeld = false;
    if (!STATE.dragging) exitPickMode();
  }, true);

  document.addEventListener("blur", () => {
    STATE.altHeld = false;
    if (!STATE.dragging) exitPickMode();
  }, true);

  document.addEventListener("mousemove", e => {
    if (!STATE.pickMode && !STATE.dragging) return;
    if (STATE.dragging) { moveGhost(e.clientX, e.clientY); return; }
    const el = getTearable(document.elementFromPoint(e.clientX, e.clientY));
    if (el !== STATE.hoveredEl) { STATE.hoveredEl = el; updateHighlight(el); }
  }, true);

  document.addEventListener("mousedown", e => {
    if (!STATE.altHeld || e.button !== 0) return;
    if (isEditable(e.target) || inOverlay(e.target)) return;
    const el = getTearable(e.target);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    STATE.dragging = true; STATE.dragTarget = el;
    STATE.dragMode = e.shiftKey ? "safe" : "live";
    const r = el.getBoundingClientRect();
    STATE.dragStart = { x: e.clientX, y: e.clientY, elLeft: r.left, elTop: r.top };
    startGhost(el);
    setHud(true, "Drag past the edge — or release to cancel");
  }, true);

  document.addEventListener("mouseup", e => {
    if (STATE.dragging) {
      const target = STATE.dragTarget;
      const dist = dragDist(e.clientX, e.clientY);
      const off  = offPage(e.clientX, e.clientY);
      removeGhost();
      STATE.dragging = false; STATE.dragTarget = null;
      const mode = STATE.dragMode || "live";
      STATE.dragMode = null; STATE.dragStart = null;
      if (target && (off || dist >= MIN_DRAG_PX)) tearElement(target, mode);
      else if (!STATE.altHeld) exitPickMode();
      else setHud(true, '<kbd>Alt</kbd> — click to tear &nbsp;·&nbsp; <kbd>⇧</kbd> safe clone');
      return;
    }
    if (!STATE.pickMode || !STATE.altHeld || e.button !== 0) return;
    if (isEditable(e.target) || inOverlay(e.target)) return;
    const el = getTearable(e.target);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    tearElement(el, e.shiftKey ? "safe" : "live");
  }, true);

  document.addEventListener("click", e => {
    if (STATE.altHeld && STATE.dragging) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  window.addEventListener("resize", () => { if (STATE.hoveredEl) updateHighlight(STATE.hoveredEl); });

  // ─── public API (used by popup) ───────────────────────────────────────────
  window.__tearaway = {
    restoreAll, restoreLast, togglePickMode,
    getCount: () => STATE.tearsById.size,
  };

  console.info("[TearAway] ready — Alt=pick, Esc=restore, Shift+Esc=restore all");
})();