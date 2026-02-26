# RealityCheck — Testing Guide

This guide covers two complementary ways to test the extension:

1. **Real-world testing** — browse LinkedIn, Google Images, or any site and see watermarks appear on AI-generated photos. No accounts, no test data needed.
2. **Unit test / automated test** — run the Jest test suite against the detection pipeline.

Before starting, complete the [Setup Guide](setup.md) so the extension is built and loaded in your browser.

---

## Real-world testing (recommended first step)

### Step 1 — Disable remote classification

Remote classification is on by default, but the hosted endpoint requires the published extension. For local development testing, turn it off so you only see results from the on-device heuristics:

1. Click the RealityCheck icon in your toolbar.
2. Toggle **Remote classification** → **Off**.
3. Set **Detection Quality** → **High** (for best local accuracy without remote).
4. Set **Watermark mode** → **Static** (easiest to notice).
5. Set **Opacity** → **80%** or higher.

The popup should now show "Remote classification: Off — using local detection only."

### Step 2 — Browse sites with a mix of AI and real photos

The extension analyses images as you scroll. Try these:

#### Google Images
1. Go to [images.google.com](https://images.google.com/).
2. Search for terms known to surface AI images, for example:
   - `"AI generated portrait"` or `"midjourney woman"`
   - `"stable diffusion landscape"`
3. Scroll through the results. Images that pass the photorealism pre-filter AND score high on local heuristics should show the **"LIKELY AI GENERATED"** banner overlay.
4. Now search for clearly human-taken photos (news photos, product photos) and verify no false watermarks appear.

> **Tip**: AI-generated images tend to have very smooth skin, unnaturally perfect lighting, and often unusual background details. The extension looks for photorealistic images with those heuristic patterns.

#### LinkedIn
1. Browse your LinkedIn feed or any profile page.
2. AI-generated headshots and polished marketing images may get flagged.
3. Regular user-uploaded photos, corporate logos, and illustrations should not be flagged (the pre-filter skips non-photorealistic content automatically).

#### Facebook / Instagram (via browser)
1. Open Facebook or Instagram in the same browser where the extension is loaded.
2. Scroll through a feed. AI-generated images appear regularly in advertising and in feeds.

### Step 3 — Verify watermark behaviour

- Hover over a watermarked image — you should see the overlay with confidence label (e.g., "High confidence").
- Click the RealityCheck icon → "Report false positive" to test the reporting flow (it just logs to the console in local mode).
- Switch **Watermark mode** between Static / Flash / Pulse / Auto-hide and reload a page to see the difference.

### Step 4 — Test with the built-in demo pages

Serve the test pages locally to test each detector type in isolation:

```bash
# From the repository root
npx serve test-pages
# Open http://localhost:3000
```

Or with Python:
```bash
cd test-pages && python3 -m http.server 8080
# Open http://localhost:8080
```

| Page | What it tests |
|---|---|
| `text-demo.html` | Text detection — AI-heavy text should be highlighted with a `~AI` badge |
| `image-demo.html` | Image watermark — 512×512 photorealistic image should get an overlay |
| `video-demo.html` | Video watermark — URL-based detection demo |
| `watermark-modes-demo.html` | Visual comparison of Static / Flash / Pulse / Auto-hide modes |

#### image-demo notes

The demo images are placeholder PNGs. For the overlay to appear, the image needs to pass the photorealism pre-filter (canvas heuristics). To test with a real photo:
- Right-click the image element on the page → Inspect → change `src` to the URL of a real photorealistic image (Google Images → right-click an image → Copy image address).

#### text-demo notes

- **Sample 1** contains heavy AI filler phrases — should be highlighted yellow with a `~AI` badge.
- **Sample 2** is human narrative writing — should be clean.
- Hover over the `~AI` badge to see the tooltip explaining that the detection is probabilistic.

#### video-demo notes

URL-based heuristics fire when the `<source src>` URL contains known AI video platform domains (`runwayml.com`, `pika.art`, `luma.ai`, etc.). To test: open DevTools → Elements, find the `<source>` tag and change its `src` to a URL that contains one of those substrings.

---

## Debugging

### Chrome / Edge

| What | Where |
|---|---|
| Extension popup | Right-click popup → **Inspect** |
| Content script logs | DevTools (F12) on the page → Console tab → filter `[RealityCheck]` |
| Background worker | `chrome://extensions/` → RealityCheck → **Service Worker** → Console |

### Firefox

| What | Where |
|---|---|
| Content script + popup | F12 standard DevTools |
| Background script | `about:debugging#/runtime/this-firefox` → RealityCheck → **Inspect** |

### Useful console messages

```
[RealityCheck] Extension installed. Settings: {...}   ← on first install
[RealityCheck] Pre-filter: image skipped (non-photorealistic)  ← pre-filter rejected image
[RealityCheck] Detection result: {score: 0.82, label: "ai"}    ← flagged image
[RealityCheck] False positive reported: {...}                   ← user clicked Report
```

---

## Unit tests

Run the core detection pipeline and API service tests:

```bash
# Linux/macOS — runs both core and API tests
make test

# API tests only
make test-api

# Windows
scripts\build.bat test

# Any platform
cd packages/core && npm test
cd packages/api && npm test
```

Expected output:
```
Tests:  150 passed, 150 total  (core)
Tests:   37 passed,  37 total  (API)
```

### Local AI model (Organika/sdxl-detector) unit tests

The SDXL detector adapter ships with its own test file that runs entirely in Node.js — no model download or WASM required (uses an injectable mock classifier):

```bash
cd packages/core && npm test -- --testPathPattern=sdxl-detector-adapter
```

Expected output:
```
Tests:  8 passed, 8 total
```

To test the shell-mode model helper with a real pixel payload, set `RC_LOCAL_MODEL_RGBA_JSON` to a JSON file:

```json
{ "data": [220, 120, 60, 255, 210, 110, 50, 255], "width": 2, "height": 1 }
```

```bash
RC_LOCAL_MODEL_RGBA_JSON=/tmp/pixels.json npm test -w packages/core -- --testPathPattern=local-model-shell
```

### Watching the model download in the browser

On first use, the extension downloads the Organika/sdxl-detector weights (~90 MB) from HuggingFace Hub and caches them. To observe this:

1. Load the extension in Chrome and open DevTools → **Network** tab, filter by `huggingface.co`.
2. Browse to a page with images — the download triggers on the first image processed.
3. After the initial download, open DevTools → **Application** → **Cache Storage** to confirm the model is cached for offline use.

### Run a specific test file

```bash
cd packages/core
npx jest tests/image-detector.test.ts
```

### Run in watch mode (auto-reruns on file save)

```bash
cd packages/core
npx jest --watch
```

---

## Testing with the local API

You can run the backend API service locally to test the full remote-classification flow end-to-end without deploying to Azure.

### 1. Start the local API server

```bash
# Build and start (no env vars needed for dev mode)
make build-api
cd packages/api && npm start
# → [RealityCheck API] Listening on port 3000
```

### 2. Configure the extension

1. Click the RealityCheck icon → open settings.
2. Toggle **Remote classification** → **On**.
3. In **Advanced**, set **Remote endpoint** to `http://localhost:3000/v1/classify`.
4. Leave **API key** empty (authentication is skipped when `CLASSIFY_API_KEY` is not set).

### 3. Test the classify endpoint directly

```bash
# Health check
curl http://localhost:3000/health

# Classify — known AI CDN URL (should return high score)
curl -X POST http://localhost:3000/v1/classify \
  -H "Content-Type: application/json" \
  -H "X-RealityCheck-Request: 1" \
  -d '{"contentType":"image","imageUrl":"https://cdn.midjourney.com/photo.png"}'

# Classify — no signals (should return low score)
curl -X POST http://localhost:3000/v1/classify \
  -H "Content-Type: application/json" \
  -H "X-RealityCheck-Request: 1" \
  -d '{"contentType":"image"}'
```

### 4. Verify CSRF and auth enforcement

```bash
# Missing X-RealityCheck-Request header → 403
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/v1/classify \
  -H "Content-Type: application/json" \
  -d '{"contentType":"image"}'
# → 403

# With CLASSIFY_API_KEY set, missing Authorization → 401
CLASSIFY_API_KEY=test-key node packages/api/dist/index.js &
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/v1/classify \
  -H "Content-Type: application/json" \
  -H "X-RealityCheck-Request: 1" \
  -d '{"contentType":"image"}'
# → 401
```

See the [Setup Guide § 7](setup.md#7-run-the-api-locally-optional) for more details on environment variables and configuration.

---

## What to expect (accuracy caveats)

Local-only heuristics are intentionally conservative to minimise false positives:

- **True positives**: Obvious AI portraits (Midjourney, DALL-E style), AI landscape photos with telltale smooth gradients, AI text with heavy filler phrases.
- **False negatives**: AI images that have been re-saved, cropped, or resized multiple times (compresses out the heuristic signals), or AI text that closely mimics a specific human's writing style.
- **False positives**: Heavily edited photography (beauty filters, HDR), stock photos with uniform lighting, professional product photography.

The extension labels everything as "**likely**" — it is a probabilistic tool, not a ground-truth detector. Use it as a first-pass signal, not a definitive verdict.
