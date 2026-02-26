# Tuning the Classifiers

RealityCheck uses two classifiers:

1. **Local SDXL** (`Xenova/ai-image-detector`) — always runs, no configuration needed.
2. **Remote ML** (Azure OpenAI APIM) — optional, opt-in via the popup settings.

---

## Detection thresholds

| Threshold | Value | Meaning |
|---|---|---|
| `AI_THRESHOLD` | 0.40 | Final score ≥ 0.40 → watermarked as AI |
| `UNCERTAIN_MIN` | 0.25 | Below this → confident it is NOT AI (no remote call) |
| `UNCERTAIN_MAX` | 0.75 | Above this → confident it IS AI (no remote call) |

When `remoteEnabled` is true and the local SDXL score falls in [0.25, 0.75], the image/frame is sent to the remote endpoint. The final score is a weighted blend:

```
final = 0.30 × localScore + 0.70 × remoteScore
```

---

## Detection quality

The `detectionQuality` setting controls the canvas downscale resolution before SDXL inference and remote transmission:

| Quality | Max dimension | Notes |
|---|---|---|
| `low` | 64 px | Fastest; lower accuracy |
| `medium` | 128 px | Balanced |
| `high` | 512 px | Most accurate; higher memory/bandwidth use |

---

## Remote endpoint

By default the extension posts to:

```
https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai
```

You can override this in the popup under **Advanced → Remote endpoint**. Leave blank to use the default.

---

## Rate limits

| Detector | low | medium | high |
|---|---|---|---|
| Image | 10/min | 30/min | 60/min |
| Video | 5/min | 15/min | 30/min |
| Text | 10/min | 30/min | 60/min |

Rate limits apply to **remote calls only**. Local SDXL inference has no rate limit.

---

## Firefox limitations

Firefox MV2 background pages run as classic scripts (IIFE format). The Transformers.js / ONNX Runtime WASM loader requires `import.meta.url`, which is unavailable in this context. As a result:

- `SDXL_CLASSIFY` always returns a neutral score of `0.5` on Firefox.
- When `remoteEnabled` is true, the neutral score falls in the uncertain band [0.25, 0.75], so the remote classifier is always invoked for Firefox images and videos.
- When `remoteEnabled` is false, Firefox will not watermark anything (all scores are 0.5, below the 0.40 AI threshold).

To get accurate detection on Firefox, enable **Remote classification** in the popup settings.
