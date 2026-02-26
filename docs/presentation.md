# RealityCheck — Extension Capabilities & Team Pitch

> **TL;DR** — RealityCheck is a cross-browser extension that automatically detects AI-generated images, videos, text, and audio as you browse, and watermarks that content in real time so you're never caught off guard by synthetic media.

---

## The Problem

AI-generated content is everywhere — synthetic profile photos, deepfake videos, AI-written articles, and voice-cloned audio all appear on mainstream platforms with zero indication of their origin. Most users cannot tell the difference, and the tools that exist today require manually uploading content to a third-party website to get an answer.

**RealityCheck brings AI-content detection directly into the browser, automatically, for everything on the page.**

---

## What RealityCheck Does

When you install RealityCheck, every page you visit is scanned for AI-generated content. Detected content gets a non-intrusive watermark badge overlaid directly on the element — no clicks required, no copy-pasting to another tab.

```
Real photo ─────────────────────────────► (no badge)
AI-generated image ──────────────────────► 🔴 "Likely AI-generated — 87% confidence"
AI-written paragraph ────────────────────► ⚠️ "Possibly AI-generated"
Deepfake / AI video ─────────────────────► 🔴 "Likely AI video"
```

---

## Supported Browsers

| Browser | Status |
|---------|--------|
| Chrome | ✅ Manifest V3 |
| Microsoft Edge | ✅ Manifest V3 |
| Firefox | ✅ Manifest V2 (WebExtensions) |
| Safari | ✅ Manifest V3 |

One shared core library (`@reality-check/core`) powers all four browsers. Browser-specific wrappers are thin and kept in sync.

---

## Content Types Detected

### 🖼 Images

- **URL / CDN pattern matching** — instant flagging of images served from known AI platforms (Midjourney, DALL-E, Stable Diffusion CDNs, etc.)
- **Dimension heuristics** — AI generators produce power-of-two pixel dimensions (512×512, 1024×1024) and standard aspect ratios
- **Visual heuristics** — saturation uniformity, luminance distribution, and channel balance analysis on a 64×64 canvas sample
- **Bundled ML model** (High quality mode) — Nonescape Mini, a lightweight on-device model that runs in WebGL without any server round-trip
- **Remote AI classifier** — full-resolution analysis via Azure OpenAI when local results are uncertain

### 🎬 Videos

- **URL pattern matching** — flags videos hosted on known AI video platforms (Sora, RunwayML, Pika, etc.)
- **Frame sampling** — periodic canvas frame capture analysed by the same visual pipeline used for images
- **Temporal inconsistency scoring** — detects flickering artefacts common in deepfakes
- **Remote frame analysis** — uncertain frames are escalated to the remote classifier

### 📝 Text

- **Burstiness analysis** — AI text has unusually uniform sentence-length distributions; human writing is more varied
- **Type-Token Ratio (TTR)** — low lexical diversity is a known AI signal
- **Filler phrase detection** — regex list of known AI output patterns ("As an AI language model…", "Certainly, here is…", etc.)
- **Average sentence length** — outlier values are scored as a secondary signal
- **Remote language model** — used when local heuristics return an inconclusive score

### 🔊 Audio

- **URL / platform heuristics** — flags audio hosted on known AI voice platforms
- **Remote analysis** — escalated for uncertain cases (on-device spectral analysis is on the roadmap)

---

## Detection Pipeline

Detection runs in a **staged cascade** — each stage is only triggered if the previous stage is inconclusive, keeping median page cost near zero.

```
Content element enters viewport
        │
        ▼
┌──────────────────────────────┐
│ 1. Photorealism pre-filter   │  < 1 ms — skip icons, cartoons, illustrations
│    (canvas 64×64)            │
└──────────┬───────────────────┘
           │ photorealistic?
           ▼
┌──────────────────────────────┐
│ 2. URL / metadata heuristics │  ~0 ms — CDN patterns, EXIF, dimensions
└──────────┬───────────────────┘
           │ uncertain?
           ▼
┌──────────────────────────────┐
│ 3. Local ML model            │  10–50 ms — Nonescape Mini, WebGL-accelerated
│    (High quality mode only)  │
└──────────┬───────────────────┘
           │ still uncertain?
           ▼
┌──────────────────────────────┐
│ 4. Remote AI classifier      │  ~200–500 ms — Azure OpenAI, rate-limited
│    (if enabled)              │
└──────────┬───────────────────┘
           ▼
     Final verdict + watermark
```

**Decision transparency** — every watermark badge displays which stage produced the verdict (`Initial`, `Local ML`, `Remote ML`) and the confidence score.

---

## Watermark Overlay

Detected content is labelled in-page using CSS-animated overlay badges — no page layout is affected.

| Mode | Behaviour |
|------|-----------|
| `static` | Always visible — best for accessibility |
| `flash` | Appears briefly, then fades |
| `pulse` | Slow fade in/out loop |
| `auto-hide` | Visible briefly, hidden on hover |

- Overlays use `pointer-events: none` — they **never block clicks** or text selection
- `prefers-reduced-motion` is respected — all animations are disabled for users who prefer it
- If a badge would cover more than 50% of the element, it automatically switches to `flash` mode to minimise obstruction

---

## User Controls (Popup)

The extension popup gives users full control:

| Setting | Description |
|---------|-------------|
| **Global toggle** | Enable / disable the extension entirely |
| **Per-site toggle** | Enable / disable on the current hostname |
| **Detection quality** | Low / Medium (default) / High — trades speed for accuracy |
| **Watermark style** | Static / Flash / Pulse / Auto-hide |
| **Remote classification** | On (default) / Off — opt out of any data leaving the browser |
| **Custom endpoint** | Point to your own classifier API (advanced) |
| **Custom API key** | For custom / enterprise endpoints (advanced, stored securely) |

Settings are synced across the user's devices via `chrome.storage.sync` / `browser.storage.sync`.

---

## Privacy First

RealityCheck is designed so privacy is the default, not an opt-in.

| What is sent when remote is ON | What is sent when remote is OFF |
|-------------------------------|--------------------------------|
| Downscaled JPEG thumbnail (max 128×128 px) | Nothing — all analysis stays on-device |
| Text snippets ≤ 2,000 characters | — |
| Content hash (no URL, no cookies, no DOM) | — |

- **Browsing history is never sent** — the extension does not request `history` or `webRequest` permissions
- **Cookies and credentials are never sent**
- **No tracking or analytics** — the extension collects no usage data
- Remote calls are rate-limited (10/min for images/text, 5/min for video), so even in remote mode only a fraction of page content ever reaches the network
- A notice is shown in the popup whenever remote mode is active

---

## Performance

RealityCheck is built to be invisible at runtime:

| Optimisation | Detail |
|--------------|--------|
| Viewport-only scanning | `IntersectionObserver` — only elements near the viewport are processed |
| DOM debouncing | `MutationObserver` changes batched at 500 ms |
| In-memory result cache | LRU cache, 5-minute TTL, 200-entry cap — identical content analysed once per session |
| CSS-only animations | `@keyframes` — no `setInterval` / `setTimeout` on the main thread |
| Photorealism pre-filter | Skips icons, cartoons, and illustrations before any heavyweight analysis |
| Rate limiting | Prevents API floods; gracefully degrades to local-only when limit is reached |

In typical browsing (news, LinkedIn, Google Images) the extension adds **< 1 ms per element** at Medium quality with remote off, and **< 50 ms per photorealistic image** at High quality with the local ML model.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│                                                             │
│  ┌─────────────────┐  messages  ┌──────────────────────┐   │
│  │  Background SW  │◄──────────►│  Popup UI            │   │
│  │ (settings sync) │            │ (controls + report)  │   │
│  └────────┬────────┘            └──────────────────────┘   │
│           │ SETTINGS_UPDATED                                │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Content Script                                     │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │  DetectionPipeline                            │  │   │
│  │  │  ├── TextDetector   (heuristics + remote)     │  │   │
│  │  │  ├── ImageDetector  (metadata + ML + remote)  │  │   │
│  │  │  ├── VideoDetector  (frames + remote)         │  │   │
│  │  │  └── AudioDetector  (URL + remote)            │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │  WatermarkOverlay (CSS animations)            │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │ remote calls (background SW)
                           ▼
              ┌────────────────────────┐
              │  Azure OpenAI (APIM)   │
              │  Bearer-token auth     │
              │  Rate-limited (APIM)   │
              └────────────────────────┘
```

**Key design decisions:**
- Remote calls are always routed through the **background service worker** (not the content script), bypassing CORS restrictions
- Local ML runs in the content script via **WebGL-accelerated ONNX / TF.js** — no server round-trip
- The shared `@reality-check/core` package is framework-agnostic TypeScript; all four browser wrappers import from it

---

## Why RealityCheck?

| Competing approach | Problem | RealityCheck answer |
|-------------------|---------|---------------------|
| Manual upload tools (e.g. AI-or-Not) | Requires copy-paste; only works one image at a time | Automatic, runs on every element on every page |
| Platform-side labels | Relies on platforms to self-police; easily gamed | Client-side, independent of platform cooperation |
| Raw perplexity APIs | Server-only; no UI; developer-only tooling | User-facing UI, works out of the box |
| Full-page screenshot classifiers | Slow; can't target individual elements | Element-level precision, lightweight per-element pipeline |

---

## Roadmap Highlights

- [ ] **On-device deepfake video model** — ONNX/WebGPU accelerated, no frame upload needed
- [ ] **Audio waveform / spectral analysis** — voice-clone detection without sending audio to a server
- [ ] **C2PA cryptographic verification** — verify Content Credentials provenance signatures end-to-end
- [ ] **Per-element confidence panel** — expandable details overlay showing heuristic breakdown
- [ ] **iframe support** — detect AI content inside embedded third-party frames (`all_frames: true`)
- [ ] **False-positive reporting backend** — aggregate user feedback to improve model thresholds
- [ ] **Enterprise policy management** — MDM-deployable settings for corporate fleet rollouts

---

## Quick Facts

| | |
|-|-|
| **Supported browsers** | Chrome, Edge, Firefox, Safari |
| **Permissions requested** | `storage`, `activeTab`, `scripting`, `host_permissions: <all_urls>` |
| **Data sent off-device** | On by default (opt-out available); max 128×128 px thumbnails + ≤ 2,000 char text snippets |
| **Local ML model** | Nonescape Mini (bundled, WebGL-accelerated) |
| **Remote classifier** | Azure OpenAI via APIM gateway |
| **Content types** | Images, video, text, audio |
| **Detection stages** | Metadata heuristics → local ML → remote ML (cascade) |
| **Settings sync** | Across user devices via browser sync |
| **Open source** | Yes — `@reality-check/core` is shared across all browser targets |
