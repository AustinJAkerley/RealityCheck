# RealityCheck — Setup Instructions

## Prerequisites

- **Node.js** 18+ and **npm** 9+
- A modern browser: Chrome 88+, Edge 88+, or Firefox 109+

---

## 1. Install dependencies & build

```bash
# From the repository root
npm install

# Build the shared core library
cd packages/core
npm run build
cd ../..
```

> The browser extension source files reference `packages/core/src` directly via TypeScript path aliases, so you only need to build the core if you want the compiled `.d.ts` files for IDE support.

---

## 2. Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the folder: `extensions/chrome/`

The RealityCheck icon (🔴) will appear in the toolbar.

### After making source changes

The Chrome extension loads files directly from the source tree — no bundling is required for development. If you make changes to TypeScript files, run:

```bash
cd extensions/chrome
npm run build   # compiles TS → dist/
```

Then click the **↺ Reload** button on the extension card in `chrome://extensions/`.

---

## 3. Loading in Microsoft Edge

1. Open Edge and navigate to `edge://extensions/`
2. Enable **Developer mode** (left sidebar)
3. Click **Load unpacked**
4. Select the folder: `extensions/edge/`

The process is identical to Chrome since both use Manifest V3.

---

## 4. Loading in Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to `extensions/firefox/` and select the `manifest.json` file

> **Temporary add-on**: This loads the extension for the current Firefox session only. It will be removed when Firefox restarts.

### For persistent loading during development

Use [web-ext](https://github.com/mozilla/web-ext):

```bash
npm install -g web-ext
cd extensions/firefox
web-ext run
```

---

## 5. Configuring the extension

Click the RealityCheck icon in the browser toolbar to open the popup:

- **Global toggle**: Enable/disable detection site-wide.
- **This site toggle**: Enable/disable detection for the current hostname.
- **Privacy — Local-only mode**: Default on. Turn off to enable remote detection.
- **Remote endpoint**: URL of your AI classification API (only used if local-only is off).
- **API key**: Stored in extension sync storage. Never logged or transmitted except to your configured endpoint.
- **Watermark mode**: Static / Flash / Pulse / Auto-hide.
- **Opacity / Animation settings**: Adjust to taste.

---

## 6. Running tests

```bash
cd packages/core
npm test
```

All 32 tests should pass.
