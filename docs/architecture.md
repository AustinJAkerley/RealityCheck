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
  Remote classifier endpoint
  (RealityCheck hosted Azure proxy — no API key required)
```

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

## Remote classifier architecture

### When remote is triggered

Remote classification is invoked only when the local classifier is **inconclusive** — i.e. the local combined score falls in the zone `[0.20, 0.65)`. Images that score below 0.20 ("clearly not AI") or 0.65 and above ("high-confidence AI") are handled locally without a network call. This keeps remote costs low and reduces latency for the majority of images.

| Local score range | Decision | Remote call? |
|---|---|---|
| < 0.20 | Not AI (confident) | No |
| 0.20 – 0.65 | Inconclusive — escalate | **Yes** |
| ≥ 0.65 | Likely AI (confident) | No |

> **Video note**: Video URL heuristics are binary (0 or 0.7). A score of 0 means the URL did not match known AI video platforms — not that the video is definitively non-AI. Videos therefore use a one-sided threshold (`score < 0.65` → inconclusive) so that unrecognised sources can still be escalated via frame capture when available.

In dev mode, the watermark badge explicitly reports `Dev · Local Inconclusive → Remote` for images that fell in the inconclusive zone, making it easy to observe which images required escalation during development.

### Remote classifier options

Two architectural paths are feasible; both are supported today via `RemoteAdapter`:

#### Option A — Hosted AI service proxy (current default)

A lightweight Azure Functions / AWS Lambda proxy forwards the downscaled image (128 × 128 px JPEG) to an upstream vision API (OpenAI GPT-4o Vision, Anthropic Claude 3 Vision, or Google Gemini Vision) and normalises the response into `{ score, label }`.

**Advantages**: No model maintenance, instantly benefits from frontier model improvements, easiest to deploy.
**Disadvantages**: Per-call cost of upstream API, latency of two hops, terms-of-service constraints.

Recommended upstream services (ranked by cost/accuracy trade-off):
1. **OpenAI GPT-4o-mini** (vision) — $0.15 / 1M input tokens; good accuracy, fast.
2. **Google Gemini 1.5 Flash** — very low cost, competitive accuracy.
3. **Anthropic Claude 3 Haiku** — competitive, good refusal behaviour for edge cases.

#### Option B — Purpose-built hosted classifier

Deploy a fine-tuned binary image classifier (e.g. a ViT-B/16 or ResNet-50 trained on synthetic vs. real datasets) on a managed GPU service. This avoids per-inference API costs after initial training and keeps data fully within our control.

**Recommended stack**: Azure Container Apps (GPU SKU) or AWS SageMaker Serverless Inference.
**Training data**: Laion-AI/LAION-5B (real) + curated AI image datasets (Midjourney, SDXL, DALL-E 3 outputs). Fine-tune on [CLIP](https://github.com/openai/CLIP) + linear head or use the CNNDetect approach (Wang et al., "CNN-generated images are surprisingly easy to spot… for now", CVPR 2020). For broader generalisation consider UnivFD (Ojha et al., "Towards Universal Fake Image Detection by Generalizing the Concept of Blending", CVPR 2023).
**Expected accuracy**: ≥ 80 % on held-out test sets from major diffusion models.

### Cloud architecture (Option B detail)

```
Browser extension
    │ POST /v1/classify
    │ { contentType, imageHash, imageDataUrl (128×128 JPEG) }
    ▼
Azure API Management (rate-limiting, auth, DDoS protection)
    │
    ▼
Azure Container Apps — classifier microservice
    ├── ONNX Runtime inference (GPU-optimised)
    ├── Redis cache layer (keyed by SHA-256 of image bytes; TTL 24 h)
    └── Returns { score: float32, label: "ai"|"human"|"uncertain", version: string }
```

### Billing model

| Tier | Monthly requests | Monthly cost estimate |
|---|---|---|
| Free (default endpoint) | ≤ 10 000 | Covered by project budget |
| Standard | 10 001 – 500 000 | $0.002 / request above free tier |
| Pro (registered extension users) | Unlimited | Flat $4.99 / month |

Rate limiting is enforced at two layers:
1. **Client-side** (`RateLimiter` token bucket): images — 10/min; videos — 5/min.
2. **Server-side** (Azure API Management): 60 requests/min per extension instance (keyed by a rotating ephemeral client token issued at install time, never tied to a user account).

### Throttling & abuse prevention

- The extension sends a short-lived (24 h) **ephemeral session token** minted at first install and rotated daily. The token is a HMAC-SHA256 of `(install_id ∥ date)` computed with a per-build shared signing key embedded in the extension package. The server verifies the HMAC without storing PII.
- Payloads are intentionally minimal: only a 128 × 128 JPEG thumbnail is sent — never the full-resolution image, user identity, or page URL.
- If the hosted endpoint becomes unavailable the extension gracefully falls back to local-only classification with no user-visible error.

### Privacy

All remote calls use HTTPS. No cookies, no user-agent fingerprinting, no page URL is transmitted. The session token is rotated daily and cannot be linked across days. The server does not log or store image thumbnails — only the resulting `score` and `label` are used.



- **DetectionCache**: LRU-like in-memory cache keyed by content hash or URL. TTL: 5 minutes, max 200 entries.
- **RateLimiter**: Token-bucket, 10 tokens per minute (text), 5 tokens per minute (video). Prevents flooding remote APIs.
- Content is re-analysed when it scrolls back into the viewport only if the cache entry has expired.
