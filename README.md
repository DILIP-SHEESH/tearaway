# TearAway

**Tear live UI out of any webpage** into an always-on-top floating widget.

Hold <kbd>Alt</kbd> to pick an element. Click or drag it off-screen to “tear it away”. With Chrome 116+ this uses the **Document Picture-in-Picture API**, so the result can stay **live** (and in safe mode it stays **reliable**).

## Why TearAway

Developers constantly copy UI while iterating on components (localhost changes, styling tweaks, debugging, UI extraction). TearAway is designed to become the “go-to” workflow tool for moving UI blocks between your browser and your editor/design stack.

## Quick start (Chrome)

1. (Optional) Generate icons (only once):

   ```bash
   node scripts/generate-icons.mjs
   ```

2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the folder: `c:\projects\mike\tearaway\extension`

## Test the demo

1. Click the TearAway extension icon
2. Click **Open demo page**
3. Hold <kbd>Alt</kbd> and click the card **“Live ticker (tear this)”**
4. Prices should keep updating inside the floating widget.

## Controls

- **Alt**: tear (default = **live move**)
- **Alt + Shift**: tear in **safe mode**
  - The original DOM node stays in place (frameworks remain stable)
  - The floating widget shows a clone
- **Alt + drag**: same tear behavior, using a drag gesture

## After you tear (export + control)

You can manage the torn widget either from:

- the **PiP action bar** inside the floating window, and/or
- the **on-page tray** (“TearAway · Active”) bottom-left.

Available actions:

- **Restore**: put the element back (or unhide it in safe mode)
- **PNG**: download a cropped PNG (best-effort)
- **Selector**: copies a CSS selector for the original element
- **HTML**: copies `outerHTML`

## How it works (v0.2)

- A content script adds:
  - an Alt-mode picker + highlight overlay
  - a placeholder left behind on the page
  - a multi-tear tray for fast actions
- If supported, the widget opens in a Document PiP window and receives:
  - copied document styles
  - your selected element (live move) or a clone (safe mode)

## Limitations (current)

- **PNG export is best-effort** and assumes the element was within the captured viewport at tear time.
- Some sites may restrict clipboard or PiP behavior.
- SVG export is a planned next step (PNG download is the reliable baseline today).

## Roadmap

- [ ] **TearOS** — Electron shell for true desktop widgets + multi-tear dashboard
- [ ] Tear export upgrades (SVG where possible, drag-and-drop to design tools)
- [ ] Session persistence (history of torn widgets)
- [ ] Framework-aware “live move vs safe clone” heuristics
- [ ] TabOS / sync layer to share tear sessions across devices
- [ ] iframe + shadow-DOM aware picking
- [ ] Firefox / Safari shims

## License

MIT. Hack away.
