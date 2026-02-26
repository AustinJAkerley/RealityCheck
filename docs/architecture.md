# RealityCheck — Architecture Overview

## Goal

RealityCheck is a cross-browser extension that detects likely AI-generated images and videos visible in the browser viewport and watermarks or labels them in-page so users are less likely to mistake synthetic media for real content.

> **Important**: Detection is _probabilistic_. All UI language is deliberately hedged ("likely", "confidence"). The extension will produce false positives and false negatives. It is a tool to raise awareness, not a definitive classifier.

---

## Detection Architecture (SDXL-only + optional remote escalation)

All media classification uses **two ML classifiers only**:

| Classifier | What | Where |
|---|---|---|
| **Local SDXL** | `Organika/sdxl-detector` via Transformers.js (ONNX/WASM) | Background service worker |
| **Remote ML** | Azure OpenAI APIM endpoint (`/openai`) | Background service worker (bypasses CORS) |

**Everything else has been removed**: no URL-pattern heuristics, no EXIF metadata analysis, no C2PA, no nonescape-mini colour histograms, no text heuristics, no audio URL matching.

### Image Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  content script (jsdom canvas)                          │
│  1. Load img pixels via <canvas>                        │
│  2. → SDXL_CLASSIFY (background SW) → local score      │
│  3. if uncertain (0.25–0.75) AND remoteEnabled:         │
│       → REMOTE_CLASSIFY (background SW) → remote score  │
│       → final = 0.3 × local + 0.7 × remote             │
│  4. isAIGenerated = final ≥ 0.40                        │
└─────────────────────────────────────────────────────────┘
```

### Video Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  content script                                         │
│  1. Capture 5 frames at evenly-spaced timestamps        │
│  2. SDXL_CLASSIFY each frame → average score           │
│  3. if uncertain (0.25–0.75) AND remoteEnabled:         │
│       → REMOTE_CLASSIFY (best frame) → remote score     │
│       → final = 0.3 × local + 0.7 × remote             │
│  4. isAIGenerated = final ≥ 0.40                        │
└─────────────────────────────────────────────────────────┘
```

### Text Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  content script (text elements not scanned by default)  │
│  if remoteEnabled:                                      │
│    → REMOTE_CLASSIFY (text slice) → remote score        │
│  else: neutral 0 (not AI)                               │
└─────────────────────────────────────────────────────────┘
```

### Audio

Audio detection is **not supported**. The detector always returns a neutral result.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Chrome / Edge / Safari / Firefox)                      │
│                                                                  │
│  ┌────────────────────────────────────┐    ┌──────────────────┐  │
│  │  Background Service Worker         │◄──►│  Popup UI        │  │
│  │  (ES module — "type": "module")    │    │  (settings,      │  │
│  │                                    │    │   report)        │  │
│  │  • Settings sync                   │    └──────────────────┘  │
│  │  • SDXL_CLASSIFY handler           │                          │
│  │    └─ createSdxlDetectorRunner()   │                          │
│  │       Organika/sdxl-detector       │                          │
│  │       (Transformers.js + ONNX/WASM)│                          │
│  │  • REMOTE_CLASSIFY handler         │                          │
│  │    └─ fetch → Azure APIM endpoint  │                          │
│  └──────────────┬─────────────────────┘                          │
│                 │ SETTINGS_UPDATED / SDXL_CLASSIFY / REMOTE_CLASSIFY │
│                 ▼                                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Content Script  (classic script — no import.meta)         │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  DetectionPipeline                                   │  │  │
│  │  │  ├── ImageDetector  (SDXL proxy → remote escalation) │  │  │
│  │  │  ├── VideoDetector  (SDXL on frames → remote)        │  │  │
│  │  │  ├── TextDetector   (remote only)                    │  │  │
│  │  │  └── AudioDetector  (neutral — not supported)        │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  WatermarkOverlay (CSS animations, no JS timers)     │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                    │ optional (remoteEnabled)
                    ▼
  ┌───────────────────────────────────────────────────────────┐
  │  Azure OpenAI APIM Gateway                                │
  │  POST /openai/...                                         │
  │  ├── Bearer-token authentication (optional API key)       │
  │  └── Vision-capable model — classifies image/text data    │
  └───────────────────────────────────────────────────────────┘
```

### Why SDXL inference runs in the background service worker

Content scripts are loaded as classic scripts (IIFE bundle format). The Transformers.js library uses `import.meta.url` to locate the WASM binary, which is only valid in ES module context. The background service worker is an ES module (`"type": "module"` in manifest), so Transformers.js and ONNX Runtime Web load correctly there.

The content script sends a `SDXL_CLASSIFY` message to the background worker, which runs inference and replies with the score.

**Firefox exception**: Firefox MV2 background pages use classic scripts; `import.meta.url` is unavailable, so `SDXL_CLASSIFY` returns a neutral `0.5`. When `remoteEnabled` is true, the remote classifier handles uncertain images in Firefox.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `globalEnabled` | `true` | Master on/off switch |
| `detectionQuality` | `'high'` | Downscale resolution: low=64px, medium=128px, high=512px |
| `remoteEnabled` | `false` | Enable optional remote ML escalation (Azure APIM) |
| `remoteEndpoint` | `''` | Custom endpoint URL (leave blank for default) |
| `remoteApiKey` | `''` | API key for custom endpoints |
| `devMode` | `true` | Show green watermark on every image/video (bypasses detection) |

---

## Packages

| Package | Purpose |
|---|---|
| `packages/core` | Shared detection logic, adapters, watermark overlay |
| `extensions/chrome` | Chrome MV3 extension |
| `extensions/edge` | Edge MV3 extension |
| `extensions/safari` | Safari MV3 extension |
| `extensions/firefox` | Firefox MV2 extension |

---

## Removed classifiers

The following classifiers were **removed** to simplify the codebase and eliminate issues caused by conflicting signals:

- **URL/CDN heuristic patterns** — false positives on image CDN URLs that happened to contain AI-adjacent terms
- **Photorealism pre-filter** — colour histogram, unique-colour count, edge analysis
- **EXIF metadata analysis** — AI software tag detection (too easy to spoof)
- **C2PA content credentials** — dependency-heavy, unreliable on non-C2PA-aware platforms
- **Nonescape-mini** — hand-tuned logistic regression on colour/texture features
- **Text heuristics** — filler phrase detection, burstiness, type-token ratio
- **Audio URL pattern matching** — unreliable based on domain name alone
- **Temporal video analysis** — frame-diff variance, motion heuristics

The only classifiers that remain are the **Organika/sdxl-detector** (local ONNX model) and the **Azure OpenAI APIM remote endpoint** (optional escalation).
