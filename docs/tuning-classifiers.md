# RealityCheck — Tuning the Local Classifier

This guide explains every knob that controls how the local (on-device) image and video detectors decide whether content is AI-generated, and when and how to adjust them.

> **When to tune**: the default values are calibrated for general web browsing with a medium false-positive tolerance. If you find the detector flags too much (overtuned) or too little (undertuned) for your specific use case, read on.

---

## Where the thresholds live

All local scoring is in `packages/core/src/detectors/`:

| File | What it controls |
|---|---|
| `image-detector.ts` | Image scoring pipeline, visual heuristics, per-source threshold |
| `video-detector.ts` | Video scoring pipeline, temporal + visual boosts, per-source threshold |

---

## Image detector

### 1. `isAIGenerated` threshold  (`image-detector.ts` near the bottom of `detect()`)

```ts
const aiThreshold = source === 'local' ? 0.25 : 0.35;
```

| Value | Effect |
|---|---|
| Lower (e.g. `0.20`) | Flags more images — catches more AI but increases false positives |
| Higher (e.g. `0.35`) | Flags fewer images — more precise but misses borderline AI images |

The two thresholds are intentionally different:
- **`0.25` for local-only** — heuristics are weaker; a lower bar compensates.
- **`0.35` for remote** — the blended remote+local score is better calibrated.

### 2. Visual weight — `computeVisualAIScore` blend  (`image-detector.ts`, `detect()`)

```ts
const visualWeight = quality === 'high' ? 0.85 : 0.75;
combinedLocalScore = Math.max(localScore, visualScore * visualWeight);
```

`visualWeight` controls how much the pixel-level analysis contributes relative to URL/dimension heuristics. A higher weight catches more re-uploaded AI images; a lower weight reduces false positives on vivid real photos.

| Quality tier | Default `visualWeight` | Suggested range |
|---|---|---|
| medium | `0.75` | `0.60` – `0.80` |
| high   | `0.85` | `0.70` – `0.90` |

### 3. Visual heuristic weights — `computeVisualAIScore`  (`image-detector.ts`)

```ts
return uniformSatScore * 0.70 + channelUniformityScore * 0.10 + lumScore * 0.20;
```

These three sub-scores are blended to produce a 0–1 AI probability:

| Signal | Weight | What it measures | Notes |
|---|---|---|---|
| `uniformSatScore` | `0.70` | High mean saturation + low variance | Most discriminative; AI images have vivid, even colour. Increase to catch more AI; lower to reduce false positives on studio photos. |
| `channelUniformityScore` | `0.10` | R/G/B channel variances are similar | Fires for most JPEG images regardless of origin — kept low to avoid noise. Increasing it above `0.15` will cause more false positives. |
| `lumScore` | `0.20` | Mean luminance near 0.50 (well-exposed) | AI generators produce well-exposed images by default. Lower this if you're processing dark or high-key photography. |

#### How `uniformSatScore` is computed

```ts
const rawUniformSat = Math.max(0, meanSat - satVar * 3.0);
// Calibrated: rawUniformSat 0.15 → score 0, rawUniformSat 0.40 → score 1
const uniformSatScore = Math.max(0, Math.min(1, (rawUniformSat - 0.15) / 0.25));
```

- **Raise the lower bound** (`0.15`) to require higher saturation before scoring — reduces false positives on moderately saturated images.
- **Raise the upper bound** (`0.40`) to make the score ramp more steeply — makes the score less sensitive overall.
- The `satVar * 3.0` penalty discourages high-variance vivid images (e.g. sunsets with dark shadows); increase the multiplier to penalise variance more aggressively.

### 4. URL / dimension score — `computeLocalImageScore`

```ts
if (matchesAICDN(src)) score += 0.7;
if (isLikelyAIDimension(w, h)) score += 0.2;      // both dims power-of-two
else if (isLikelyAIAspectRatio(w, h)) score += 0.1;
if (w % 64 === 0 && h % 64 === 0) score += 0.1;
```

- **Add CDN patterns**: update `AI_CDN_PATTERNS` (array of `RegExp`) to cover new AI image hosting services.
- **Adjust dimension bonus**: if you're targeting older model outputs that almost always use power-of-two sizes, you can raise the `+0.2` bonus.

---

## Video detector

### 1. `isAIGenerated` threshold  (`video-detector.ts`)

```ts
const aiThreshold = source === 'local' ? 0.25 : 0.35;
```

Same logic as images. Without frame capture (cross-origin video), the score is almost always `0` unless the URL matches a known AI platform. Lowering this below `0.20` will produce many false positives.

### 2. Visual and temporal boosts  (`video-detector.ts`, `detect()`)

```ts
const temporalBoost = Math.min(0.3, temporalScore);   // capped
const visualBoost   = videoVisualScore * 0.35;
finalScore = Math.min(1, localScore + temporalBoost + visualBoost);
```

| Constant | Default | Effect of increasing |
|---|---|---|
| `temporalBoost` cap (`0.3`) | Hard cap | Raise to allow stronger temporal signal for very inconsistent videos |
| `visualBoost` multiplier (`0.35`) | 35% of frame visual score | Increase to give per-frame pixel analysis more weight |

---

## Photorealism pre-filter

Before any AI scoring runs, the image goes through a fast pre-filter that discards non-photorealistic content (icons, cartoons, illustrations). The threshold:

```ts
const PHOTOREALISM_SKIP_THRESHOLD = 0.20;   // image-detector.ts
```

- **Lower** (e.g. `0.10`): run AI detection on more images — catches AI-generated flat-style illustrations but increases processing cost.
- **Higher** (e.g. `0.35`): skip more images — faster on icon-heavy pages but may miss AI-generated artwork.

The pre-filter itself has three quality tiers (controlled by `detectionQuality` in extension settings):

| Tier | Signals | Cost |
|---|---|---|
| `low` | Colour entropy + unique colour count | ~0 ms |
| `medium` (default) | Low + block variance + saturation distribution | < 1 ms |
| `high` | Medium + registered ML model (if any) | 10–200 ms |

---

## Remote vs local blend

When remote classification is enabled, the final score is blended:

```ts
finalScore = combinedLocalScore * 0.3 + result.score * 0.7;
```

The `0.7` weight on the remote result means local heuristics contribute 30% even when remote succeeds. This can be adjusted if your remote classifier is less reliable than the local heuristics for your deployment.

---

## Registering a custom ML model

The `high` quality tier can use an on-device ML model for much better accuracy (85–95% vs ~50% for heuristics alone):

```ts
import { registerMlModel } from '@reality-check/core';

// ONNX Runtime Web example
import * as ort from 'onnxruntime-web';
const session = await ort.InferenceSession.create('/models/ai-image-detector.onnx');

registerMlModel({
  async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
    // data is a 64×64 RGBA flat buffer; width=64, height=64
    const input = new ort.Tensor('uint8', data, [1, height, width, 4]);
    const { output } = await session.run({ input });
    return output.data[1] as number; // probability of AI class
  },
});
```

Recommended open models trained on real-vs-AI datasets:

| Model | Size | Dataset | Notes |
|---|---|---|---|
| [CIFAKE](https://huggingface.co/datasets/gcervantes8/cifake) fine-tune | ~5 MB | CIFAKE (CIFAR-10 + AI) | Dataset for training — fine-tune a MobileNetV3 or EfficientNet-Lite0 on it |
| [GenImage](https://github.com/GenImage-Dataset/GenImage) classifier | ~10 MB | GenImage (diverse generators) | Better generalisation across generators |
| EfficientNet-Lite0 fine-tune | ~5 MB | Any of the above | Fastest on CPU; ~50 ms per image |

The model receives a **64×64 RGBA pixel buffer** (the same canvas sample used for pre-filtering) and must return a **0–1 AI probability**. ONNX Runtime Web with the WASM backend runs without GPU and works inside browser extensions.

---

## Quickstart: reducing false positives

If you see too many real images flagged as AI-generated:

1. **Raise the local threshold** to `0.30` — biggest immediate impact.
2. **Lower `visualWeight`** from `0.75` to `0.65` — makes pixel heuristics more conservative.
3. **Raise the `rawUniformSat` lower bound** from `0.15` to `0.20` — requires higher saturation before the sat signal fires.
4. Enable **remote classification** (it is far more accurate than local heuristics alone).
5. For site-specific suppression, disable the extension on that site via the popup's per-site toggle.

## Quickstart: increasing recall (catching more AI images)

If real AI images are not being flagged:

1. **Lower the local threshold** to `0.20`.
2. **Raise `visualWeight`** to `0.80` (medium) or `0.90` (high).
3. **Register an ML model** — this is the only reliable path to 85%+ accuracy.
4. Enable **remote classification** if you haven't already.
