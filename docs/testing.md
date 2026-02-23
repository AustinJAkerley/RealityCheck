# RealityCheck — Local Testing Guide

## Serving the test pages

The test pages in `/test-pages/` are static HTML files. Serve them locally to avoid browser CORS restrictions:

```bash
# From the repository root
npx serve test-pages
# Open http://localhost:3000
```

Or use Python:

```bash
cd test-pages
python3 -m http.server 8080
# Open http://localhost:8080
```

---

## Test pages

| File | Tests |
|---|---|
| `text-demo.html` | Text detection and inline labelling |
| `image-demo.html` | Image detection and overlay watermarks |
| `video-demo.html` | Video detection and overlay watermarks |
| `watermark-modes-demo.html` | Visual demo of all four watermark modes |

---

## Testing text detection

1. Load `text-demo.html` with the extension active.
2. The page contains three text blocks:
   - **Sample 1**: Heavy AI filler — should be flagged with yellow highlight and `~AI` badge.
   - **Sample 2**: Human narrative — should not be flagged.
   - **Sample 3**: Neutral factual text — may or may not be flagged depending on heuristics.
3. Hover over the `~AI` badge to see the tooltip confidence explanation.

---

## Testing image detection

1. Load `image-demo.html`.
2. The 512×512 image (power-of-two dimensions) should receive a "Likely AI Generated" overlay.
3. The 1920×1200 image (non-AI dimensions) should not receive an overlay.
4. To test CDN URL detection, replace an image `src` with a real Midjourney or DALL-E URL (right-click → Inspect → edit attribute).

---

## Testing video detection

1. Load `video-demo.html`.
2. By default, the video URLs point to standard test videos — no AI overlay expected.
3. To test URL-based detection: right-click → Inspect, change the `<source src>` to a URL containing "runwayml", "pika.art", etc.
4. To test frame capture: set up a local same-origin video, enable remote detection in the popup, and configure a test endpoint.

---

## Testing watermark modes

1. Open the popup and change **Watermark mode** to each option.
2. Navigate to any page with images.
3. Observe that:
   - **Static**: overlay is always visible.
   - **Flash**: overlay appears then fades within 1–2 seconds.
   - **Pulse**: overlay fades in and out.
   - **Auto-hide**: overlay disappears after first appearance; hover to reveal.
4. Enable **reduced motion** in your OS/browser accessibility settings and verify that all animations are disabled (static overlay for all modes).

---

## Debugging

### Chrome / Edge

1. Open DevTools on the extension popup: right-click the popup → Inspect.
2. Open DevTools on the content script: open DevTools on the page → Sources → Content scripts.
3. Background worker logs: `chrome://extensions/` → RealityCheck → **Service Worker** link → Console tab.

### Firefox

1. Content script + popup: standard DevTools (F12).
2. Background script: `about:debugging#/runtime/this-firefox` → RealityCheck → **Inspect**.

### Console messages

The extension logs to the console with the `[RealityCheck]` prefix:
- `[RealityCheck] Extension installed. Settings: {...}` — on first install.
- `[RealityCheck] False positive reported: {...}` — when user clicks "Report".

---

## Running unit tests

```bash
cd packages/core
npm test
```

To run a specific test file:

```bash
npx jest tests/text-detector.test.ts
```

To run in watch mode:

```bash
npx jest --watch
```
