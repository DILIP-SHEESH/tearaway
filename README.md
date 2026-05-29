# TearAway
**Tear live UI out of any webpage** into an always-on-top floating widget.
Hold <kbd>Alt</kbd> to pick an element. Click or drag it off-screen to "tear it away". With Chrome 116+ this uses the **Document Picture-in-Picture API**, so the result can stay **live** (and in safe mode it stays **reliable**).

<p align="center">
  <img src="https://github.com/DILIP-SHEESH/dump/blob/main/tearaway.gif?raw=true" alt="TearAway demo" />
</p>

## Why TearAway
Developers constantly copy UI while iterating on components (localhost changes, styling tweaks, debugging, UI extraction). TearAway is designed to become the "go-to" workflow tool for moving UI blocks between your browser and your editor/design stack.
## Quick start (Chrome)
1. (Optional) Generate icons (only once):
   ```bash
   node scripts/generate-icons.mjs
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `extension` folder
## Test the demo
1. Click the TearAway extension icon
2. Click **Open demo page**
3. Hold <kbd>Alt</kbd> and click the card **"Live ticker (tear this)"**
4. Prices should keep updating inside the floating widget.
## Controls
- **Alt**: tear (default = **live move**)
- **Alt + Shift**: tear in **safe mode**
  - The original DOM node stays in place (frameworks remain stable)
  - The floating widget shows a clone
- **Alt + drag**: same tear behavior, using a drag gesture
## After you tear (export + control)
You can manage the torn widget from:
- the **PiP action bar** inside the floating window, and/or
- the **on-page tray** ("TearAway · Active") bottom-left.
Available actions:
- **Restore**: put the element back (or unhide it in safe mode)
- **PNG**: download a cropped PNG (see below)
- **Selector**: copies a CSS selector for the original element
- **HTML**: copies `outerHTML`
## PNG export
PNG capture uses two paths depending on the state of the extension context:
**Primary — `captureVisibleTab` + crop**
The background service worker takes a full GPU screenshot of the tab via `chrome.tabs.captureVisibleTab`, then the content script crops it to the element's bounding rect. This captures exactly what you see — CORS images, canvas, video, CSS variables, everything — at full device pixel ratio.
**Fallback — canvas painter**
If the extension context has been invalidated (e.g. you reloaded the extension from `chrome://extensions` without reloading the tab), the primary path is unavailable. TearAway automatically falls back to a pure in-page canvas renderer that walks the element's subtree and paints backgrounds, borders, border-radius, and text directly onto a canvas using `getComputedStyle`. No `chrome.*` APIs are used. Cross-origin images are skipped to avoid canvas taint; everything else renders correctly.
> **Note:** If you reload the extension during development, reload the target tab too to restore the primary (GPU screenshot) path.
## How it works (v0.3)
- A content script adds:
  - an Alt-mode picker + highlight overlay
  - a placeholder left behind on the page
  - a multi-tear tray for fast actions
- If supported, the widget opens in a Document PiP window and receives:
  - copied document styles
  - your selected element (live move) or a clone (safe mode)
- The background service worker handles:
  - `captureVisibleTab` for GPU-accurate PNG export
  - clipboard writes that bypass page CSP restrictions
## Limitations (current)
- PNG fallback (canvas painter) does not capture background images or gradients — only solid colors, borders, and text.
- Some sites may restrict PiP behavior.
- SVG export is a planned next step.
## Roadmap
- [ ] **TearOS** — Electron shell for true desktop widgets + multi-tear dashboard
- [ ] Tear export upgrades (SVG where possible, drag-and-drop to design tools)
- [ ] Session persistence (history of torn widgets)
- [ ] Framework-aware "live move vs safe clone" heuristics
- [ ] TabOS / sync layer to share tear sessions across devices
- [ ] iframe + shadow-DOM aware picking
- [ ] Firefox / Safari shims
## License
MIT.
