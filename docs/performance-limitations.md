# RealityCheck — Performance Notes & Known Limitations

## Performance design

### Photorealism pre-filter

Before any AI-generation analysis or remote call, every image passes through a canvas-based photorealism pre-filter at 64 × 64 resolution. Non-photorealistic images (icons, cartoons, illustrations, text graphics) are **skipped entirely** — no heuristics run, no remote call is made.

The pre-filter depth is controlled by the **Detection Quality** setting:

| Tier | Analysis | Typical cost |
|---|---|---|
| Low | Colour histogram entropy + unique colour count | < 0.1 ms |
| Medium (default) | Low + block noise/texture variance + saturation distribution | < 1 ms |
| High | Medium + bundled ML model (TF.js / ONNX, WebGL-accelerated) | 10–50 ms |

### Viewport-only scanning

The content script uses an `IntersectionObserver` with `rootMargin: '200px'` to only process elements that are visible or about to become visible. Elements that have scrolled out of view are not re-analysed unless their cache entry expires.

### MutationObserver debouncing

Dynamic content additions (e.g., infinite-scroll feeds) trigger re-scans via a `MutationObserver`. Scans are debounced with a 500ms delay to avoid thrashing on rapid DOM updates.

### Result caching

All detection results are cached in memory for 5 minutes by content hash (text) or URL (images, videos). Identical content encountered multiple times in a session is only analysed once.

### Rate limiting

Remote API calls are rate-limited to:
- 10 calls/minute for text and image detectors
- 5 calls/minute for the video detector

When the rate limit is exhausted, the system falls back to local heuristics only.

### CSS animations

Watermark animations (`flash`, `pulse`) use CSS `@keyframes` rather than `setInterval`/`setTimeout`. This allows the browser to optimise animation scheduling and respects the user's `prefers-reduced-motion` preference.

---

## Known limitations

### Text detection

| Limitation | Impact | Mitigation |
|---|---|---|
| Heuristics are surface-level | High false-positive rate for academic/technical writing | Remote classifier is on by default and provides better signal |
| No access to token probabilities | Can't run true perplexity-based detection | Remote model provides better signal |
| Short texts are excluded (< 80 chars) | Very short AI replies not detected | Intentional: avoids false positives |
| Filler phrase list is fixed | Novel AI patterns not yet in list | Regularly update the pattern list |

### Image detection

| Limitation | Impact | Mitigation |
|---|---|---|
| Pre-filter may skip borderline-photorealistic images | Some photorealistic AI art may be missed | Use Medium or High quality tier |
| URL heuristics only (remote classification disabled) | Reposted/resaved images not detected | Remote classification is on by default |
| EXIF parser covers JPEG only | PNG/WebP EXIF metadata not parsed | Extend parser to additional formats |
| Remote classifier accuracy unknown | Varies by provider and model | Disclose confidence level in UI |
| C2PA signature not cryptographically verified | Full trust chain requires backend lookup | Structural presence check is conservative positive signal |

### Video detection

| Limitation | Impact | Mitigation |
|---|---|---|
| Multi-frame seeking may not work on all codecs | Some videos fall back to URL heuristics | Cross-origin CORS is an intentional privacy boundary |
| Cross-origin CORS block | Cannot frame-capture YouTube/Vimeo | Intentional privacy/security boundary |
| Multi-frame temporal analysis is heuristic | Cannot catch all deepfake artefacts | Future: dedicated deepfake ONNX model |
| No on-device deepfake model | Local detection is limited | Future: ONNX/WebGPU inference |

### Audio detection

| Limitation | Impact | Mitigation |
|---|---|---|
| URL heuristics only for local detection | Real-audio content misclassified if rehosted | Remote classification when enabled |
| No spectral/waveform analysis | Voice cloning not detected locally | Future: on-device ONNX audio model |

### General

| Limitation | Impact |
|---|---|
| All detection is probabilistic | False positives and negatives are expected. Always displayed as "likely" |
| No ground-truth evaluation | Accuracy figures cannot be cited for this implementation |
| Heuristics can be evaded | A motivated actor can avoid detection |
| Extension cannot analyse content inside iframes (cross-origin) | AI content in embedded frames is not labelled |
| No server-side component | Cannot maintain a shared blocklist or improve models |

---

## Future improvements

- Bundle a fine-tuned EfficientNet/MobileNet ONNX model for High-tier image classification; plug in via `registerMlModel()`.
- Add an ONNX-based on-device text detector (e.g., a fine-tuned distilBERT for AI detection).
- Add WebGPU-accelerated image classification for local pixel-level detection.
- Expand the filler-phrase list and use n-gram frequency scoring.
- Add per-element confidence score display with an expandable details panel.
- Support iframe analysis via `all_frames: true` in the content script (with appropriate performance guards).
- Configure a real backend endpoint for `submitFeedback()` to enable user-reported false positives.
- Implement full C2PA cryptographic signature verification via a backend trust-store lookup.
