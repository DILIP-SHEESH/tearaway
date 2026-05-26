(() => {
  if (window !== window.top) return;
  if (window.__tearawayLoaded) return;
  window.__tearawayLoaded = true;

  const STATE = {
    altHeld: false,
    pickMode: false,
    dragging: false,
    dragTarget: null,
    dragStart: null,
    dragMode: null, // "live" | "safe"
    hoveredEl: null,

    tearCounter: 0,
    tearsById: new Map(),
  };

  const MIN_DRAG_PX = 48;
  const IGNORE_TAGS = new Set([
    "HTML",
    "BODY",
    "HEAD",
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "NOSCRIPT",
  ]);

  let overlayRoot = null;
  let highlightBox = null;
  let hud = null;
  let tray = null;
  let ghost = null;

  function supportsDocPiP() {
    return "documentPictureInPicture" in window;
  }

  function isEditableTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  function isWithinOverlay(el) {
    return !!(el && overlayRoot && overlayRoot.contains(el));
  }

  function getTearableElement(from) {
    let el = from;
    while (el && el instanceof Element) {
      if (IGNORE_TAGS.has(el.tagName)) {
        el = el.parentElement;
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.height >= 24) return el;
      el = el.parentElement;
    }
    return null;
  }

  function cssEscape(value) {
    // CSS.escape isn't available in every Chromium sandbox.
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function buildCssSelector(el) {
    if (!el || !(el instanceof Element)) return "";
    if (el.id) return `#${cssEscape(el.id)}`;

    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur && cur instanceof Element; i++) {
      let part = cur.tagName.toLowerCase();

      if (cur.classList && cur.classList.length) {
        const classes = [...cur.classList].slice(0, 2).filter(Boolean);
        if (classes.length) part += "." + classes.map(cssEscape).join(".");
      }

      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (c) => c.tagName === cur.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(part);
      cur = cur.parentElement;
    }

    return parts.join(" > ");
  }

  function ensureOverlay() {
    if (overlayRoot?.isConnected) return;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "tearaway-overlay-root";
    document.documentElement.appendChild(overlayRoot);

    highlightBox = document.createElement("div");
    highlightBox.className = "tearaway-highlight";
    highlightBox.hidden = true;
    overlayRoot.appendChild(highlightBox);

    hud = document.createElement("div");
    hud.className = "tearaway-hud";
    hud.hidden = true;
    overlayRoot.appendChild(hud);

    tray = document.createElement("div");
    tray.id = "tearaway-tray";
    tray.hidden = true;
    // Important: mount tray outside the click-through overlay
    // so it remains clickable while the overlay itself stays pointer-events:none.
    document.documentElement.appendChild(tray);

    tray.addEventListener("click", (e) => {
      const btn =
        e.target instanceof Element ? e.target.closest("[data-action]") : null;
      if (!btn || !tray.contains(btn)) return;
      const action = btn.dataset.action;
      const tearId = btn.dataset.tearId;
      if (!tearId) return;

      if (action === "restore") restoreTear(tearId);
      if (action === "download") downloadTearPng(tearId);
      if (action === "copy-selector") copyTearSelector(tearId);
      if (action === "copy-html") copyTearHtml(tearId);
    });
  }

  function renderTray() {
    ensureOverlay();
    if (!tray) return;

    const tears = [...STATE.tearsById.values()];
    if (tears.length === 0) {
      tray.hidden = true;
      tray.innerHTML = "";
      return;
    }

    tray.hidden = false;
    tray.innerHTML = "";

    const title = document.createElement("div");
    title.className = "tearaway-tray-title";
    title.textContent = "TearAway · Active";
    tray.appendChild(title);

    const list = document.createElement("div");
    list.className = "tearaway-tray-list";
    tray.appendChild(list);

    for (const tear of tears) {
      const item = document.createElement("div");
      item.className = "tearaway-tray-item";
      item.dataset.tearId = tear.id;

      const label = document.createElement("div");
      label.className = "tearaway-tray-label";
      label.textContent = tear.label;

      const meta = document.createElement("div");
      meta.className = "tearaway-tray-meta";
      meta.textContent = tear.mode === "safe" ? "safe (clone)" : "live (move)";

      const actions = document.createElement("div");
      actions.className = "tearaway-tray-actions";
      actions.innerHTML = `
        <button class="tearaway-tray-btn" data-action="restore" data-tear-id="${tear.id}">Restore</button>
        <button class="tearaway-tray-btn" data-action="download" data-tear-id="${tear.id}">PNG</button>
        <button class="tearaway-tray-btn" data-action="copy-selector" data-tear-id="${tear.id}">Selector</button>
        <button class="tearaway-tray-btn" data-action="copy-html" data-tear-id="${tear.id}">HTML</button>
      `;

      item.appendChild(label);
      item.appendChild(meta);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  function setHud(visible, text) {
    ensureOverlay();
    hud.hidden = !visible;
    if (text) hud.innerHTML = text;
  }

  function updateHighlight(el) {
    ensureOverlay();
    if (!el) {
      highlightBox.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    highlightBox.hidden = false;
    highlightBox.style.left = `${r.left}px`;
    highlightBox.style.top = `${r.top}px`;
    highlightBox.style.width = `${r.width}px`;
    highlightBox.style.height = `${r.height}px`;
  }

  function showToast(message) {
    ensureOverlay();
    const toast = document.createElement("div");
    toast.className = "tearaway-toast";
    toast.textContent = message;
    overlayRoot.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function enterPickMode() {
    if (STATE.pickMode) return;
    STATE.pickMode = true;
    setHud(
      true,
      '<kbd>Alt</kbd> tear mode — click or Alt+drag. <br><kbd>Alt</kbd>+<kbd>Shift</kbd> = safe (no DOM move)'
    );
    renderTray();
  }

  function exitPickMode() {
    STATE.pickMode = false;
    STATE.hoveredEl = null;
    updateHighlight(null);
    if (!STATE.dragging) setHud(false);
  }

  function copyStylesToWindow(targetWindow) {
    [...document.styleSheets].forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = targetWindow.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          targetWindow.document.head.appendChild(link);
        } else if (sheet.cssRules) {
          const style = targetWindow.document.createElement("style");
          style.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n");
          targetWindow.document.head.appendChild(style);
        }
      } catch {
        if (sheet.href) {
          const link = targetWindow.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          targetWindow.document.head.appendChild(link);
        }
      }
    });
  }

  function createPipBar(pipWindow, label, tearId, mode) {
    const right = pipWindow.document.createElement("div");
    right.className = "tearaway-pip-actions";

    function makeBtn(text, onClick) {
      const btn = pipWindow.document.createElement("button");
      btn.type = "button";
      btn.className = "tearaway-pip-btn";
      btn.textContent = text;
      btn.addEventListener("click", onClick);
      return btn;
    }

    right.append(
      makeBtn("Restore", () => restoreTear(tearId)),
      makeBtn("PNG", () => downloadTearPng(tearId)),
      makeBtn("Selector", () => copyTearSelector(tearId)),
      makeBtn("HTML", () => copyTearHtml(tearId))
    );

    const barLeft = pipWindow.document.createElement("div");
    barLeft.className = "tearaway-pip-title";
    barLeft.innerHTML = `<span class="tearaway-pip-main">TearAway · ${escapeHtml(label)}</span><span class="tearaway-pip-sub">${mode === "safe" ? "safe (clone)" : "live (move)"}</span>`;

    return { barLeft, right };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => {
      return (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        }[m] || m
      );
    });
  }

  function injectPipChrome(pipWindow, label, tearId, mode) {
    const style = pipWindow.document.createElement("style");
    style.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        background: #0f0f14;
        font-family: system-ui, sans-serif;
      }
      #tearaway-pip-shell {
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
      #tearaway-pip-bar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        background: linear-gradient(90deg, #4c1d95, #5b21b6);
        color: #fafafa;
        font-size: 11px;
        font-weight: 600;
        user-select: none;
      }
      .tearaway-pip-title {
        display: flex;
        gap: 10px;
        align-items: baseline;
        overflow: hidden;
      }
      .tearaway-pip-main {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tearaway-pip-sub {
        opacity: 0.9;
        white-space: nowrap;
      }
      #tearaway-pip-body {
        flex: 1 1 auto;
        padding: 8px;
        overflow: auto;
      }
      #tearaway-pip-body > * { max-width: 100%; }
      .tearaway-pip-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .tearaway-pip-btn {
        pointer-events: auto;
        appearance: none;
        border: 1px solid rgba(255,255,255,0.25);
        background: rgba(0,0,0,0.2);
        color: #fff;
        border-radius: 8px;
        font-size: 11px;
        padding: 4px 8px;
        cursor: pointer;
      }
      .tearaway-pip-btn:hover { background: rgba(0,0,0,0.35); }
    `;
    pipWindow.document.head.appendChild(style);

    const shell = pipWindow.document.createElement("div");
    shell.id = "tearaway-pip-shell";

    const bar = pipWindow.document.createElement("div");
    bar.id = "tearaway-pip-bar";

    const { barLeft, right } = createPipBar(pipWindow, label, tearId, mode);
    bar.append(barLeft, right);

    const body = pipWindow.document.createElement("div");
    body.id = "tearaway-pip-body";
    shell.append(bar, body);
    pipWindow.document.body.appendChild(shell);
    return body;
  }

  function createFloatingFallback(tear) {
    const { element, label, placeholder, mode, id } = tear;
    const rect = tear.capture.rect;

    const panel = document.createElement("div");
    panel.id = `tearaway-floating-panel-${id}`;

    Object.assign(panel.style, {
      position: "fixed",
      left: `${Math.min(rect.left, window.innerWidth - rect.width - 16)}px`,
      top: `${Math.min(rect.top, window.innerHeight - rect.height - 16)}px`,
      width: `${Math.max(rect.width, 320)}px`,
      maxHeight: "70vh",
      zIndex: "2147483645",
      background: "#0f0f14",
      border: "2px solid #7c3aed",
      borderRadius: "12px",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      overflow: "hidden",
      resize: "both",
      pointerEvents: "auto",
    });

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      cursor: "move",
      padding: "8px 12px",
      background: "linear-gradient(90deg,#4c1d95,#5b21b6)",
      color: "#fff",
      font: "600 11px system-ui,sans-serif",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "10px",
    });
    bar.style.userSelect = "none";

    const barLeft = document.createElement("div");
    barLeft.innerHTML = `<span>${escapeHtml(label)}</span><span style="opacity:0.9;margin-left:10px">${mode === "safe" ? "safe (clone)" : "live (move)"}</span>`;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";

    function makeBtn(text, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      Object.assign(btn.style, {
        appearance: "none",
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(0,0,0,0.2)",
        color: "#fff",
        borderRadius: "8px",
        fontSize: "11px",
        padding: "4px 8px",
        cursor: "pointer",
      });
      btn.addEventListener("click", onClick);
      return btn;
    }

    controls.append(
      makeBtn("Restore", () => restoreTear(id)),
      makeBtn("PNG", () => downloadTearPng(id)),
      makeBtn("Selector", () => copyTearSelector(id)),
      makeBtn("HTML", () => copyTearHtml(id))
    );

    bar.append(barLeft, controls);

    const body = document.createElement("div");
    Object.assign(body.style, {
      padding: "8px",
      overflow: "auto",
      maxHeight: "calc(70vh - 40px)",
      pointerEvents: "auto",
    });

    panel.append(bar, body);
    document.documentElement.appendChild(panel);

    // Drag move for fallback panel.
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    bar.addEventListener("mousedown", (e) => {
      dragOffsetX = e.clientX - panel.offsetLeft;
      dragOffsetY = e.clientY - panel.offsetTop;
      const onMove = (ev) => {
        panel.style.left = `${ev.clientX - dragOffsetX}px`;
        panel.style.top = `${ev.clientY - dragOffsetY}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    if (mode === "live") {
      body.appendChild(element);
    } else if (tear.safeClone) {
      body.appendChild(tear.safeClone);
    } else {
      // Best-effort fallback if safeClone is missing for some reason.
      body.appendChild(element.cloneNode(true));
    }

    // Ensure focus isn't stolen.
    panel.addEventListener("mousedown", (e) => e.stopPropagation());

    tear.panel = panel;
  }

  async function tearElement(element, mode) {
    if (!element) return;
    ensureOverlay();

    const label =
      element.getAttribute("aria-label") ||
      element.id ||
      element.tagName.toLowerCase();

    const rect = element.getBoundingClientRect();
    const width = Math.min(Math.max(Math.round(rect.width), 320), 900);
    const height = Math.min(Math.max(Math.round(rect.height + 48), 240), 800);

    const id = String(++STATE.tearCounter);

    const placeholder = document.createElement("div");
    placeholder.dataset.tearawayPlaceholder = "1";
    placeholder.style.minHeight = `${rect.height}px`;
    placeholder.style.outline = "2px dashed rgba(124,58,237,0.45)";
    placeholder.style.borderRadius = "8px";
    placeholder.style.background = "rgba(124, 58, 237, 0.06)";

    element.parentNode?.insertBefore(placeholder, element);

    let originalDisplay = null;
    let safeClone = null;
    if (mode === "safe") {
      // Clone first, then hide the original. Otherwise the clone may inherit `display:none`.
      safeClone = element.cloneNode(true);
      try {
        safeClone.style.display = "";
        safeClone.style.visibility = "";
      } catch {
        /* ignore */
      }

      originalDisplay = element.style.display;
      element.style.display = "none";
    }

    const tear = {
      id,
      mode,
      label,
      element,
      placeholder,
      panel: null,
      pipWindow: null,
      pipWatchdog: null,
      capture: {
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        dpr: window.devicePixelRatio || 1,
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight,
        },
      },
      safeClone,
      exportDisplayRestore: originalDisplay,
      exportSelector: buildCssSelector(element),
    };

    STATE.tearsById.set(id, tear);
    renderTray();

    if (!supportsDocPiP()) {
      createFloatingFallback(tear);
      exitPickMode();
      setHud(false);
      showToast("Torn away — fallback panel (no OS-level PiP)");
      return;
    }

    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width,
        height,
      });
      copyStylesToWindow(pipWindow);
      const body = injectPipChrome(pipWindow, label, id, mode);

      if (mode === "live") {
        body.appendChild(element);
      } else {
        body.appendChild(tear.safeClone || element.cloneNode(true));
      }

      tear.pipWindow = pipWindow;

      const restoreOnce = () => restoreTear(id);
      // Different Chromium builds fire different lifecycle events for PiP windows.
      pipWindow.addEventListener("pagehide", restoreOnce);
      pipWindow.addEventListener("unload", restoreOnce);
      pipWindow.addEventListener("beforeunload", restoreOnce);

      // Extra safety: if the user closes the PiP window and events don't fire,
      // poll `pipWindow.closed` and restore the element back.
      tear.pipWatchdog = window.setInterval(() => {
        const t = STATE.tearsById.get(id);
        if (!t) return;
        const w = t.pipWindow;
        if (!w) return;
        if (w.closed) restoreTear(id);
      }, 500);

      exitPickMode();
      setHud(false);
      showToast(
        mode === "safe"
          ? "Torn away (safe) — DOM stays stable"
          : "Torn away — live widget stays synced"
      );
    } catch (err) {
      placeholder.remove();
      if (mode === "safe") {
        element.style.display = originalDisplay ?? "";
      }
      STATE.tearsById.delete(id);
      renderTray();
      showToast(`Could not tear: ${err?.message || "user gesture required"}`);
    }
  }

  function restoreTear(tearId) {
    const tear = STATE.tearsById.get(tearId);
    if (!tear) return;

    const { element, placeholder, pipWindow, panel, mode } = tear;

    if (tear.pipWatchdog) {
      clearInterval(tear.pipWatchdog);
      tear.pipWatchdog = null;
    }

    // Restore DOM (safe mode hides via `display:none` so frameworks stay intact).
    if (mode === "live") {
      if (placeholder?.parentNode && element) {
        placeholder.parentNode.insertBefore(element, placeholder);
        placeholder.remove();
      }
    } else {
      // Safe: element stays in DOM, we only hid it.
      if (element && mode === "safe") {
        element.style.display = tear.exportDisplayRestore ?? "";
      }
      if (placeholder?.parentNode) placeholder.remove();
    }

    // Close PiP after moving/hiding so the node isn't lost.
    if (pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {
        /* ignore */
      }
    }

    if (panel) {
      try {
        panel.remove();
      } catch {
        /* ignore */
      }
    }

    STATE.tearsById.delete(tearId);
    renderTray();
    showToast("Placed back / restored");
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard might be blocked; fall back to execCommand if needed later.
      return false;
    }
  }

  function withDisplayRestored(tear, fn) {
    if (!tear) return fn();
    if (tear.mode !== "safe") return fn();
    const el = tear.element;
    const prev = el.style.display;
    try {
      el.style.display = tear.exportDisplayRestore ?? "";
      return fn();
    } finally {
      el.style.display = prev;
    }
  }

  function copyTearSelector(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;
    copyToClipboard(tear.exportSelector || buildCssSelector(tear.element)).then((ok) => {
      showToast(ok ? "Copied selector" : "Copy failed (clipboard blocked)");
    });
  }

  function copyTearHtml(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;
    withDisplayRestored(tear, () => {
      const html = tear.element?.outerHTML || "";
      copyToClipboard(html).then((ok) => {
        showToast(ok ? "Copied HTML" : "Copy failed (clipboard blocked)");
      });
    });
  }

  async function downloadTearPng(tearId) {
    const tear = STATE.tearsById.get(String(tearId));
    if (!tear) return;

    const { rect } = tear.capture;
    showToast("Capturing tab…");

    try {
      const resp = await chrome.runtime.sendMessage({
        type: "TEARAWAY_CAPTURE_VISIBLE_TAB",
      });
      if (!resp || !resp.ok || !resp.dataUrl) {
        showToast(resp?.error ? `PNG failed: ${resp.error}` : "PNG capture failed");
        return;
      }

      const img = new Image();
      img.src = resp.dataUrl;
      await new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Image load failed"));
      });

      // Crop in *viewport* coordinates. This is v1: assumes the element was visible
      // in the captured viewport at tear time.
      const scaleX = img.width / window.innerWidth;
      const scaleY = img.height / window.innerHeight;

      const sx = Math.max(0, rect.left * scaleX);
      const sy = Math.max(0, rect.top * scaleY);
      const sw = Math.min(img.width - sx, rect.width * scaleX);
      const sh = Math.min(img.height - sy, rect.height * scaleY);

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        showToast("PNG export failed (no canvas context)");
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const safeLabel = String(tear.label || "tearaway")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const filename = `tearaway-${safeLabel}-${tear.id}.png`;

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();

      showToast("PNG downloaded");
    } catch (err) {
      showToast(`PNG failed: ${err?.message || "unknown error"}`);
    }
  }

  function removeGhost() {
    if (ghost) ghost.remove();
    ghost = null;
  }

  function startDragGhost(element) {
    removeGhost();
    const rect = element.getBoundingClientRect();
    ghost = document.createElement("div");
    ghost.className = "tearaway-drag-ghost";
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;

    const clone = element.cloneNode(true);
    clone.style.pointerEvents = "none";
    clone.style.width = "100%";
    clone.style.height = "100%";
    ghost.appendChild(clone);
    overlayRoot.appendChild(ghost);
  }

  function moveDragGhost(clientX, clientY) {
    if (!ghost || !STATE.dragStart) return;
    const dx = clientX - STATE.dragStart.x;
    const dy = clientY - STATE.dragStart.y;
    ghost.style.left = `${STATE.dragStart.elLeft + dx}px`;
    ghost.style.top = `${STATE.dragStart.elTop + dy}px`;
  }

  function dragDistance(clientX, clientY) {
    if (!STATE.dragStart) return 0;
    const dx = clientX - STATE.dragStart.x;
    const dy = clientY - STATE.dragStart.y;
    return Math.hypot(dx, dy);
  }

  function isOffPage(clientX, clientY) {
    return (
      clientX < 0 ||
      clientY < 0 ||
      clientX > window.innerWidth ||
      clientY > window.innerHeight
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Alt" || e.repeat) return;
      if (isEditableTarget(e.target) || isWithinOverlay(e.target)) return;
      STATE.altHeld = true;
      enterPickMode();
    },
    true
  );

  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== "Alt") return;
      STATE.altHeld = false;
      if (!STATE.dragging) exitPickMode();
    },
    true
  );

  document.addEventListener(
    "blur",
    () => {
      STATE.altHeld = false;
      if (!STATE.dragging) exitPickMode();
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!STATE.pickMode && !STATE.dragging) return;
      if (STATE.dragging) {
        moveDragGhost(e.clientX, e.clientY);
        return;
      }
      const el = getTearableElement(document.elementFromPoint(e.clientX, e.clientY));
      if (el !== STATE.hoveredEl) {
        STATE.hoveredEl = el;
        updateHighlight(el);
      }
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!STATE.altHeld || e.button !== 0) return;
      if (isEditableTarget(e.target) || isWithinOverlay(e.target)) return;

      const el = getTearableElement(e.target);
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      STATE.dragging = true;
      STATE.dragTarget = el;
      STATE.dragMode = e.shiftKey ? "safe" : "live";

      const rect = el.getBoundingClientRect();
      STATE.dragStart = {
        x: e.clientX,
        y: e.clientY,
        elLeft: rect.left,
        elTop: rect.top,
      };

      ensureOverlay();
      startDragGhost(el);
      setHud(true, "Drag off the page edge to tear away…");
    },
    true
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (STATE.dragging) {
        const target = STATE.dragTarget;
        const dist = dragDistance(e.clientX, e.clientY);
        const off = isOffPage(e.clientX, e.clientY);

        removeGhost();
        STATE.dragging = false;
        STATE.dragTarget = null;
        const mode = STATE.dragMode || "live";
        STATE.dragMode = null;
        STATE.dragStart = null;

        if (target && (off || dist >= MIN_DRAG_PX)) {
          tearElement(target, mode);
        } else if (!STATE.altHeld) {
          exitPickMode();
        } else {
          setHud(
            true,
            '<kbd>Alt</kbd> tear mode — hover & click, or <kbd>Alt</kbd>+drag off the page'
          );
        }
        return;
      }

      if (!STATE.pickMode || !STATE.altHeld || e.button !== 0) return;
      if (isEditableTarget(e.target) || isWithinOverlay(e.target)) return;

      const el = getTearableElement(e.target);
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();
      const mode = e.shiftKey ? "safe" : "live";
      tearElement(el, mode);
    },
    true
  );

  // Prevent accidental clicks while in tear mode.
  document.addEventListener(
    "click",
    (e) => {
      if (!STATE.altHeld) return;
      if (STATE.dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    if (STATE.hoveredEl) updateHighlight(STATE.hoveredEl);
  });

  console.info(
    "[TearAway] ready — hold Alt to pick, click/Alt+drag to tear",
    supportsDocPiP() ? "(Document PiP supported)" : "(fallback panel only)"
  );
})();

