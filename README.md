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

## How it works (v0.3)

Content script adds picker, highlight overlay, placeholder & tray
Opens Document PiP window with copied styles + live element or clone
Background service worker handles screenshots & clipboard

### Limitations (Current)

PNG fallback does not capture background images or gradients
Some sites may restrict PiP behavior
SVG export is planned
## License
MIT.
