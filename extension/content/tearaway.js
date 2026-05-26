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
    activeTear: null,
    hoveredEl: null,
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
  let ghost = null;

  function supportsDocPiP() {
    return "documentPictureInPicture" in window;
  }

  function isEditableTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
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
    if (STATE.pickMode || STATE.activeTear) return;
    STATE.pickMode = true;
    setHud(
      true,
      '<kbd>Alt</kbd> tear mode — hover & click, or <kbd>Alt</kbd>+drag off the page'
    );
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

  function injectPipChrome(pipWindow, label) {
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
      #tearaway-pip-body {
        flex: 1 1 auto;
        padding: 8px;
        overflow: auto;
      }
      #tearaway-pip-body > * {
        max-width: 100%;
      }
    `;
    pipWindow.document.head.appendChild(style);

    const shell = pipWindow.document.createElement("div");
    shell.id = "tearaway-pip-shell";
    const bar = pipWindow.document.createElement("div");
    bar.id = "tearaway-pip-bar";
    bar.innerHTML = `<span>TearAway · ${label}</span><span>live · synced</span>`;
    const body = pipWindow.document.createElement("div");
    body.id = "tearaway-pip-body";
    shell.append(bar, body);
    pipWindow.document.body.appendChild(shell);
    return body;
  }

  function createFloatingFallback(element, label) {
    const rect = element.getBoundingClientRect();
    const panel = document.createElement("div");
    panel.id = "tearaway-floating-panel";
    Object.assign(panel.style, {
      position: "fixed",
      left: `${Math.min(rect.left, window.innerWidth - rect.width - 16)}px`,
      top: `${Math.min(rect.top, window.innerHeight - rect.height - 16)}px`,
      width: `${Math.max(rect.width, 280)}px`,
      maxHeight: "70vh",
      zIndex: "2147483645",
      background: "#0f0f14",
      border: "2px solid #7c3aed",
      borderRadius: "12px",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      overflow: "hidden",
      resize: "both",
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
    });
    bar.innerHTML = `<span>TearAway · ${label}</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    Object.assign(closeBtn.style, {
      border: "none",
      background: "rgba(255,255,255,0.15)",
      color: "#fff",
      borderRadius: "6px",
      width: "24px",
      height: "24px",
      cursor: "pointer",
      fontSize: "16px",
      lineHeight: "1",
    });
    closeBtn.onclick = () => restoreTear(panel);
    bar.appendChild(closeBtn);

    const body = document.createElement("div");
    Object.assign(body.style, {
      padding: "8px",
      overflow: "auto",
      maxHeight: "calc(70vh - 40px)",
    });

    panel.append(bar, body);
    document.documentElement.appendChild(panel);

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

    const placeholder = document.createElement("div");
    placeholder.dataset.tearawayPlaceholder = "1";
    placeholder.style.minHeight = `${rect.height}px`;
    placeholder.style.outline = "2px dashed rgba(124,58,237,0.5)";
    placeholder.style.borderRadius = "8px";
    placeholder.style.background = "rgba(124,58,237,0.06)";
    element.parentNode?.insertBefore(placeholder, element);

    body.appendChild(element);
    STATE.activeTear = { mode: "fallback", panel, placeholder, element };
    exitPickMode();
    setHud(false);
    showToast("Floating panel (install Chrome 116+ for OS-level PiP window)");
  }

  async function tearElement(element) {
    if (!element || STATE.activeTear) return;

    const label =
      element.getAttribute("aria-label") ||
      element.id ||
      element.tagName.toLowerCase();

    const rect = element.getBoundingClientRect();
    const width = Math.min(Math.max(Math.round(rect.width), 320), 900);
    const height = Math.min(Math.max(Math.round(rect.height + 48), 240), 800);

    const placeholder = document.createElement("div");
    placeholder.dataset.tearawayPlaceholder = "1";
    placeholder.style.minHeight = `${rect.height}px`;
    placeholder.style.outline = "2px dashed rgba(124, 58, 237, 0.45)";
    placeholder.style.borderRadius = "8px";
    placeholder.style.background = "rgba(124, 58, 237, 0.06)";
    element.parentNode?.insertBefore(placeholder, element);

    if (!supportsDocPiP()) {
      createFloatingFallback(element, label);
      return;
    }

    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width,
        height,
      });

      copyStylesToWindow(pipWindow);
      const body = injectPipChrome(pipWindow, label);
      body.appendChild(element);

      STATE.activeTear = {
        mode: "pip",
        pipWindow,
        placeholder,
        element,
      };

      pipWindow.addEventListener("pagehide", () => {
        restoreTear();
      });

      exitPickMode();
      setHud(false);
      showToast("Torn away — live widget stays synced with the page");

      chrome.runtime?.sendMessage?.({
        type: "TEARAWAY_PIP_STATUS",
        payload: { label, at: Date.now() },
      });
    } catch (err) {
      placeholder.remove();
      if (element.parentNode === placeholder.parentNode) {
        placeholder.parentNode?.insertBefore(element, placeholder.nextSibling);
      }
      showToast(`Could not tear: ${err?.message || "user gesture required"}`);
    }
  }

  function restoreTear(forcedPanel) {
    const tear = STATE.activeTear;
    if (!tear) return;

    const { element, placeholder, pipWindow, panel } = tear;

    if (placeholder?.parentNode && element) {
      placeholder.parentNode.insertBefore(element, placeholder);
      placeholder.remove();
    }

    if (pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {
        /* ignore */
      }
    }

    if (panel || forcedPanel) {
      (panel || forcedPanel).remove();
    }

    STATE.activeTear = null;
    showToast("Placed back on the page");
  }

  function removeGhost() {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
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
      if (isEditableTarget(e.target)) return;
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
      if (isEditableTarget(e.target)) return;

      const el = getTearableElement(e.target);
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      STATE.dragging = true;
      STATE.dragTarget = el;
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
        STATE.dragStart = null;

        if (target && (off || dist >= MIN_DRAG_PX)) {
          tearElement(target);
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
      if (isEditableTarget(e.target)) return;

      const el = getTearableElement(e.target);
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();
      tearElement(el);
    },
    true
  );

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
    "[TearAway] ready — hold Alt to pick, click or drag to tear",
    supportsDocPiP() ? "(Document PiP supported)" : "(fallback floating panel)"
  );
})();
