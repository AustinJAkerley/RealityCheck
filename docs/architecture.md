# RealityCheck — Architecture Overview

## Goal

RealityCheck is a cross-browser extension that detects likely AI-generated content visible in the browser viewport (images, videos, text) and watermarks or labels it in-page so users are less likely to mistake synthetic media for real content.

> **Important**: Detection is _probabilistic_. All UI language is deliberately hedged ("likely", "confidence"). The extension will produce false positives and false negatives. It is a tool to raise awareness, not a definitive classifier.

---

## High-level architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (Chrome / Edge / Firefox)                             │
│                                                                │
│  ┌──────────────────┐    messages    ┌─────────────────────┐  │
│  │  Background SW   │◄──────────────►│  Popup UI           │  │
│  │  (settings sync) │                │  (settings, report) │  │
│  └────────┬─────────┘                └─────────────────────┘  │
│           │ SETTINGS_UPDATED                                   │
│           ▼                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Content Script                                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  DetectionPipeline                               │   │  │
│  │  │  ├── TextDetector  (local heuristics + remote)   │   │  │
│  │  │  ├── ImageDetector (metadata + remote)           │   │  │
│  │  │  └── VideoDetector (frame sample + remote)       │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  WatermarkOverlay (CSS animations, no JS timers) │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
           │ (on by default; user can disable in popup)
           ▼
  ┌─────────────────────────────────────────────────────────┐
  │  @reality-check/api  (packages/api — Azure-hosted)      │
  │                                                         │
  │  POST /v1/classify                                      │
  │  ├── Bearer-token authentication (CLASSIFY_API_KEY)     │
  │  ├── CSRF protection (Origin + X-RealityCheck-Request)  │
  │  ├── Rate limiting (60 req/min per IP)                  │
  │  └── Image analysis (CDN patterns, dimensions, bytes)   │
  │                                                         │
  │  GET  /health  (Azure liveness probe)                   │
  └─────────────────────────────────────────────────────────┘
```

---

## Backend API service — `/packages/api`

The `@reality-check/api` package is a Node.js / Express service designed to be
deployed to Azure App Service or Azure Container Apps.  It exposes the
`POST /v1/classify` endpoint consumed by the browser extension's
`GenericHttpAdapter` (see `packages/core/src/adapters/remote-adapter.ts`).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/classify` | Classify an image (or other content type). Returns `{ score, label }`. |
| `GET`  | `/health` | Liveness probe for Azure health checks. Returns `{ status: "ok" }`. |

### Security layers

1. **Helmet** — sets secure HTTP response headers (CSP, HSTS, etc.).
2. **CORS** — only browser-extension origins and origins listed in `ALLOWED_ORIGINS` are permitted for browser-originated requests; server-to-server calls (no `Origin` header) are allowed.
3. **Bearer-token authentication** — when the `CLASSIFY_API_KEY` environment variable is set, every request must supply `Authorization: Bearer <key>`.  When unset the check is skipped (development mode).
4. **CSRF protection** — every request to `/v1/*` must include the `X-RealityCheck-Request: 1` header and (if an `Origin` header is present) must originate from a trusted origin.  This makes CSRF attacks impossible even without session cookies.
5. **Rate limiting** — 60 requests per minute per IP (configurable).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | TCP port the server listens on. |
| `CLASSIFY_API_KEY` | _(unset)_ | Shared secret sent as `Authorization: Bearer <key>` by the extension. Set in production to prevent unauthorised access. |
| `ALLOWED_ORIGINS` | _(unset)_ | Comma-separated list of trusted web origins (in addition to all browser-extension origins). |

---

## Shared core library — `/packages/core`

All browser wrappers import from `@reality-check/core`. The core is pure TypeScript with no browser-extension-specific APIs.

### Modules

| Module | Responsibility |
|---|---|
| `types.ts` | All shared TypeScript types and interfaces |
| `detectors/text-detector.ts` | Local heuristic + remote text classification |
| `detectors/image-detector.ts` | URL/dimension heuristics + remote image classification |
| `detectors/video-detector.ts` | URL heuristics + frame sampling + remote |
| `pipeline/detection-pipeline.ts` | Orchestrates detectors; pluggable via `registerDetector` |
| `overlay/watermark-overlay.ts` | CSS-animated overlays for media and text |
| `storage/settings-storage.ts` | Extension storage abstraction (chrome/browser/localStorage) |
| `utils/cache.ts` | LRU-like in-memory result cache |
| `utils/rate-limiter.ts` | Token-bucket rate limiter for remote calls |
| `utils/hash.ts` | Lightweight djb2 hash for cache keys |
| `adapters/remote-adapter.ts` | Pluggable remote provider (OpenAI, Generic HTTP) |

---

## Detection pipeline

### Text detection

**Local heuristics (always run):**
- **Burstiness**: AI-generated text tends to have unusually uniform sentence lengths (low standard deviation). Human text has more "burstiness" — mixing short and long sentences.
- **Type-Token Ratio (TTR)**: Low lexical diversity can indicate AI output.
- **Filler phrase matching**: Regex list of known AI output patterns ("As an AI language model…", "Certainly, here is…", etc.).
- **Average sentence length**: Extremely long average sentence length is slightly suspicious.

**Limitations**: These heuristics have significant false-positive rates for technical writing, academic text, or well-edited prose. They should not be used as definitive evidence.

**References**:
- Gehrmann et al., "GLTR: Statistical Detection and Visualization of Generated Text" (2019)
- Tian & Cui, "Multiscale Positive-Unlabeled Detection of AI-Generated Texts" (2023)
- Mitchell et al., "DetectGPT: Zero-Shot Machine-Generated Text Detection" (2023)
- OpenAI AI Text Classifier (retired 2023) — documented limitations of text classifiers

### Image detection

**Local heuristics:**
- **URL/CDN pattern matching**: Known AI image services (Midjourney, DALL-E, Stable Diffusion, etc.)
- **Power-of-two dimensions**: AI image generators typically produce 512×512, 1024×1024, etc.
- **Aspect ratio**: Standard AI output ratios (1:1, 4:3, 16:9)

**Limitations**: These heuristics are trivially evaded by resaving or cropping images. Pixel-level detection requires a dedicated model (e.g., CNNDetect, UnivFD). The remote classifier path is the recommended route for higher accuracy.

**References**:
- Wang et al., "CNN-generated images are surprisingly easy to spot… for now" (2020)
- C2PA Content Credentials — https://c2pa.org (open standard for provenance metadata)
- Sha et al., "DE-FAKE: Detection and Attribution of Fake Images" (2023)

### Video detection

**Local heuristics:**
- **URL pattern matching**: Known AI video platforms (RunwayML, Sora, Pika, etc.)

**Frame-level analysis (remote mode):**
- Periodic frame capture via HTML Canvas (one frame per detection cycle)
- Blocked for cross-origin videos due to browser CORS/taint policies
- Captured frame downscaled to 128×128 before sending

**Limitations**: Frame-level deepfake detection is a hard, rapidly-evolving problem. Local-only mode has very low detection coverage for novel deepfakes. This is deliberately disclosed to users.

**References**:
- Rossler et al., "FaceForensics++: Learning to Detect Manipulated Facial Images" (2019)
- Chai et al., "What Makes Fake Images Detectable?" (2020)
- Dolhansky et al., "The DeepFake Detection Challenge Dataset" (2020)

---

## Watermark overlay

Watermarks are rendered as absolutely-positioned `<div>` elements layered over media/text elements.

### Modes

| Mode | Behaviour | CSS mechanism |
|---|---|---|
| `static` | Always visible | `opacity: var(--rc-opacity)` |
| `flash` | Appears briefly, then fades | `@keyframes rc-flash` |
| `pulse` | Slow fade in/out loop | `@keyframes rc-pulse` |
| `auto-hide` | Visible briefly, hidden on hover | CSS `transition` + JS class toggle |

### Accessibility

- All animations use CSS `@keyframes` rather than JS timers where possible.
- `prefers-reduced-motion: reduce` disables all animations and forces static display.
- Overlays use `pointer-events: none` so they never intercept user interaction.

### Obstruction auto-fallback

If the watermark would cover more than `obstructionThreshold` (default 50%) of the element area, the mode automatically falls back from `static` to `flash` to minimise obstruction.

---

## Privacy model

Remote classification is **enabled by default**. The extension calls our hosted Azure classifier (`https://api.realitycheck.ai/v1/classify`) for any image that passes the local photorealism pre-filter. No API key is required from the user — authentication to downstream AI services is handled server-side by the proxy. Users can turn remote classification off at any time in the popup.

| Setting | Behaviour |
|---|---|
| Remote classification ON (default) | Photorealistic images, inconclusive text, and video frames are sent to our hosted endpoint. Payloads are minimal: text snippet ≤ 2 000 chars, downscaled image thumbnail (128 × 128 px, JPEG). A notice is shown in the popup whenever remote mode is active. |
| Remote classification OFF | No network calls. All analysis is on-device using local heuristics only. The popup suggests using Medium or High detection quality for best accuracy in this mode. |

API keys are never required for the default endpoint. For custom/development endpoints, an optional API key can be configured in the **Advanced** section (collapsed by default) of the popup. Keys are stored exclusively in `chrome.storage.sync` / `browser.storage.sync` — never hardcoded or logged.

### Photorealism pre-filter

Before any content is analysed or sent off-device, every image passes through a canvas-based photorealism pre-filter. Non-photorealistic images (icons, cartoons, illustrations, text graphics) are **skipped entirely** — they generate no local heuristic result and are never sent to the remote endpoint. This keeps both processing cost and data transmission minimal.

The pre-filter depth is controlled by the **Detection Quality** setting:

| Tier | Analysis | Cost |
|---|---|---|
| Low | Colour histogram entropy + unique colour count (64 × 64 canvas) | ~0 ms |
| Medium (default) | Low + block noise/texture variance + saturation distribution | < 1 ms |
| High | Medium + bundled ML model (TF.js / ONNX, WebGL-accelerated) | 10–50 ms |

---

## Settings persistence

Settings are stored in `chrome.storage.sync` (Chrome/Edge) or `browser.storage.sync` (Firefox) and synced across the user's devices. The background script broadcasts `SETTINGS_UPDATED` messages to all active content scripts when settings change.

---

## Rate limiting & caching

- **DetectionCache**: LRU-like in-memory cache keyed by content hash or URL. TTL: 5 minutes, max 200 entries.
- **RateLimiter**: Token-bucket, 10 tokens per minute (text), 5 tokens per minute (video). Prevents flooding remote APIs.
- Content is re-analysed when it scrolls back into the viewport only if the cache entry has expired.
