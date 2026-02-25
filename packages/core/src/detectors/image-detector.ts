/**
 * Image detector — photorealism pre-filter + local heuristics + optional remote classifier.
 *
 * Pipeline:
 * 1. Photorealism pre-filter (tier-dependent canvas analysis).
 *    - If the image is NOT photorealistic (icon, cartoon, text graphic), skip entirely.
 *    - If it IS photorealistic (or uncertain), continue to step 2.
 * 2. Local heuristics: CDN URL patterns, power-of-two dimensions, AI aspect ratios,
 *    EXIF metadata analysis, and C2PA/Content Credentials detection.
 * 3. If remoteEnabled: send to the hosted classifier (DEFAULT_REMOTE_ENDPOINT).
 *    Remote result is blended with local score (70% remote, 30% local).
 *
 * Pre-filter tiers:
 *   low:    Color histogram entropy + unique color count (canvas 64×64, ~zero cost)
 *   medium: Low + block noise/texture variance + saturation distribution
 *   high:   Medium + registered ML model (via registerMlModel) when available,
 *           otherwise falls back to medium-tier canvas analysis.
 *
 * Known limitations: local heuristics have low accuracy for novel AI models.
 * See docs/architecture.md for details.
 */
import { DetectionResult, DetectionQuality, DetectorOptions, PhotorealismResult, MlModelRunner, RemotePayload } from '../types.js';
import { Detector } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { parseExifFromDataUrl, getExifAIScore } from '../utils/exif-parser.js';
import { detectC2PAFromDataUrl } from '../utils/c2pa.js';

// ── Pre-filter constants ─────────────────────────────────────────────────────

/** Pre-filter canvas resolution. Small enough to be fast, large enough for analysis. */
const PREFILTER_SIZE = 64;

/**
 * Threshold below which an image is considered NOT photorealistic.
 * Kept deliberately low (0.20) to minimise false negatives —
 * we prefer to analyse too many images rather than miss real AI photos.
 */
const PHOTOREALISM_SKIP_THRESHOLD = 0.20;

// ── ML model registry ────────────────────────────────────────────────────────

/**
 * Module-level registry for a pluggable on-device ML model runner.
 * Call `registerMlModel()` at extension startup to activate High-tier inference.
 */
let _mlModelRunner: MlModelRunner | null = null;

/**
 * Register an on-device ML model runner for High-tier image analysis.
 *
 * The runner is called during High-tier photorealism scoring and can also be
 * used as an additional AI-generation signal in `detect()`.
 *
 * Example (TensorFlow.js):
 * ```ts
 * import * as tf from '@tensorflow/tfjs';
 * registerMlModel({
 *   async run(data, width, height) {
 *     const tensor = tf.tensor4d(data, [1, height, width, 4]);
 *     const [, score] = (await model.predict(tensor) as tf.Tensor).dataSync();
 *     return score;
 *   },
 * });
 * ```
 *
 * Example (ONNX Runtime Web):
 * ```ts
 * import * as ort from 'onnxruntime-web';
 * const session = await ort.InferenceSession.create('./model.onnx');
 * registerMlModel({
 *   async run(data, width, height) {
 *     const input = new ort.Tensor('uint8', data, [1, height, width, 4]);
 *     const { output } = await session.run({ input });
 *     return output.data[1] as number; // AI-class probability
 *   },
 * });
 * ```
 */
export function registerMlModel(runner: MlModelRunner): void {
  _mlModelRunner = runner;
}

/**
 * Returns true when an ML model runner has been registered.
 * Used by tests and extension startup code to check availability.
 */
export function isMlModelAvailable(): boolean {
  return _mlModelRunner !== null;
}

// ── Pre-filter helper functions ──────────────────────────────────────────────

/**
 * Count unique quantized colors in RGBA pixel data.
 * Quantizes each channel to 5 bits (32 levels) to reduce noise sensitivity.
 */
export function countUniqueColors(data: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] >> 3) & 0x1f;
    const g = (data[i + 1] >> 3) & 0x1f;
    const b = (data[i + 2] >> 3) & 0x1f;
    seen.add((r << 10) | (g << 5) | b);
  }
  return seen.size;
}

/**
 * Compute Shannon entropy of a single color channel (8-bit → 32 bins).
 * High entropy ≈ photorealistic; low entropy ≈ flat/cartoon.
 * Returns a value in [0, log2(32)] ≈ [0, 5].
 */
export function computeChannelEntropy(data: Uint8ClampedArray, channelOffset: number): number {
  const histogram = new Int32Array(32);
  const pixelCount = data.length / 4;
  for (let i = channelOffset; i < data.length; i += 4) {
    histogram[data[i] >> 3]++;
  }
  let entropy = 0;
  for (const count of histogram) {
    if (count > 0) {
      const p = count / pixelCount;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Compute luminance-based gradient complexity using a simple first-order
 * finite difference (fast approximation of Sobel magnitude).
 * Returns the mean gradient magnitude (0–255 scale).
 * High variance / moderate mean ≈ photorealistic;
 * very low mean (flat) or very high uniform mean (vector art) ≈ non-photo.
 */
export function computeEdgeComplexity(
  data: Uint8ClampedArray,
  width: number,
  height: number
): number {
  let total = 0;
  const n = (width - 1) * (height - 1);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const r = (y * width + x + 1) * 4;
      const d = ((y + 1) * width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const lumR = (data[r] + data[r + 1] + data[r + 2]) / 3;
      const lumD = (data[d] + data[d + 1] + data[d + 2]) / 3;
      const gx = lumR - lum;
      const gy = lumD - lum;
      total += Math.sqrt(gx * gx + gy * gy);
    }
  }
  return total / n;
}

/**
 * Compute mean variance within small 4×4 pixel blocks (luminance).
 * High block variance ≈ photographic texture/noise.
 * Low block variance ≈ flat cartoon/illustration regions.
 */
export function computeBlockVariance(
  data: Uint8ClampedArray,
  width: number,
  height: number
): number {
  let totalVar = 0;
  let blockCount = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const lums: number[] = [];
      for (let dy = 0; dy < 4 && by + dy < height; dy++) {
        for (let dx = 0; dx < 4 && bx + dx < width; dx++) {
          const i = ((by + dy) * width + (bx + dx)) * 4;
          lums.push((data[i] + data[i + 1] + data[i + 2]) / 3);
        }
      }
      if (lums.length === 0) continue;
      const m = lums.reduce((a, b) => a + b, 0) / lums.length;
      const v = lums.reduce((a, b) => a + (b - m) ** 2, 0) / lums.length;
      totalVar += v;
      blockCount++;
    }
  }
  return blockCount > 0 ? totalVar / blockCount : 0;
}

/**
 * Compute the variance of HSV saturation values across all pixels.
 * Cartoons/illustrations tend to have high mean saturation and low variance
 * (bright flat regions). Photos have varied, lower saturation overall.
 */
export function computeSaturationVariance(data: Uint8ClampedArray): number {
  const sats: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    sats.push(max === 0 ? 0 : delta / max);
  }
  const mean = sats.reduce((a, b) => a + b, 0) / sats.length;
  return sats.reduce((a, b) => a + (b - mean) ** 2, 0) / sats.length;
}

// ── Visual AI-generation scoring ─────────────────────────────────────────────

/**
 * Estimate AI-generation probability from pixel data using visual heuristics
 * that are characteristic of diffusion-model outputs:
 *
 *  1. **Uniform-saturation score** — AI images have high mean saturation
 *     with LOW variance (consistent colour richness). Vivid real photos have
 *     high mean saturation but HIGH variance (vivid areas alongside shadows).
 *     **Primary signal (weight 0.70)** — the most discriminative single feature.
 *
 *  2. **Channel-variance uniformity** — AI generators produce no lens
 *     chromatic aberration, so R/G/B channels have similar variance.
 *     Real photos show channel-specific variance differences.
 *     **Minor signal (weight 0.10)** — fires for most JPEG images regardless
 *     of origin, so it is given low weight to avoid false positives.
 *
 *  3. **Luminance balance** — AI images are typically well-exposed
 *     (mean luminance near 0.50). Very dark or very bright images are
 *     more likely to be real photographs taken in challenging conditions.
 *     **Secondary signal (weight 0.20)** — useful corroborating evidence.
 *
 * Returns 0–1; higher = more likely AI-generated.
 * Expected accuracy: ~50–60% on typical AI image sets (local heuristics only).
 */
export function computeVisualAIScore(
  data: Uint8ClampedArray,
  _width: number,
  _height: number
): number {
  const pixelCount = data.length / 4;
  if (pixelCount === 0) return 0;

  let satSum = 0;
  let satSqSum = 0;
  let lumSum = 0;
  let rSum = 0, gSum = 0, bSum = 0;
  let rSqSum = 0, gSqSum = 0, bSqSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r8 = data[i], g8 = data[i + 1], b8 = data[i + 2];
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;

    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    satSum += sat;
    satSqSum += sat * sat;

    lumSum += r * 0.299 + g * 0.587 + b * 0.114;

    rSum += r8; gSum += g8; bSum += b8;
    rSqSum += r8 * r8; gSqSum += g8 * g8; bSqSum += b8 * b8;
  }

  const meanSat = satSum / pixelCount;
  // Population variance of saturation
  const satVar = Math.max(0, satSqSum / pixelCount - meanSat * meanSat);
  const meanLum = lumSum / pixelCount;

  // Channel variance uniformity
  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;
  const rVar = Math.max(0, rSqSum / pixelCount - rMean * rMean);
  const gVar = Math.max(0, gSqSum / pixelCount - gMean * gMean);
  const bVar = Math.max(0, bSqSum / pixelCount - bMean * bMean);
  const varMean = (rVar + gVar + bVar) / 3;
  const channelUniformityScore =
    varMean > 0
      ? Math.max(
          0,
          Math.min(
            1,
            1 -
              (Math.abs(rVar - varMean) + Math.abs(gVar - varMean) + Math.abs(bVar - varMean)) /
                (3 * varMean)
          )
        )
      : 1;

  // Uniform-saturation score:
  //   raw = meanSat - satVar * 3   (penalises high-variance vivid photos)
  //   AI portrait/animal: meanSat≈0.40, satVar≈0.02 → raw≈0.34 → score≈0.76
  //   Real photo: meanSat≈0.27, satVar≈0.04 → raw≈0.15 → score≈0
  //   Vivid sunset: meanSat≈0.55, satVar≈0.08 → raw≈0.31 → score≈0.64
  const rawUniformSat = Math.max(0, meanSat - satVar * 3.0);
  // Calibrated: 0.15 → 0, 0.40 → 1
  const uniformSatScore = Math.max(0, Math.min(1, (rawUniformSat - 0.15) / 0.25));

  // Luminance balance: AI images tend to be well-exposed (mean lum ≈ 0.50)
  // Peaks at 0.50, falls off for dark (<0.30) or bright (>0.70) images
  const lumScore = Math.max(0, 1 - Math.abs(meanLum - 0.50) * 3.2);

  return uniformSatScore * 0.70 + channelUniformityScore * 0.10 + lumScore * 0.20;
}

// ── Pre-filter scoring ───────────────────────────────────────────────────────

/**
 * Score the image data for photorealism using Low-tier heuristics.
 * Returns a value in [0, 1]; higher = more photorealistic.
 */
export function scoreLowTier(data: Uint8ClampedArray): number {
  const uniqueColors = countUniqueColors(data);
  const rEntropy = computeChannelEntropy(data, 0);
  const gEntropy = computeChannelEntropy(data, 1);
  const bEntropy = computeChannelEntropy(data, 2);
  const entropy = (rEntropy + gEntropy + bEntropy) / 3;
  const edgeComplexity = computeEdgeComplexity(data, PREFILTER_SIZE, PREFILTER_SIZE);

  // Unique colors: < 50 → 0, > 400 → 1
  const colorScore = Math.min(1, Math.max(0, (uniqueColors - 50) / 350));
  // Entropy: < 2 bits → 0, > 4.5 bits → 1
  const entropyScore = Math.min(1, Math.max(0, (entropy - 2) / 2.5));
  // Edge complexity: < 3 → 0, > 20 → 1
  const edgeScore = Math.min(1, Math.max(0, (edgeComplexity - 3) / 17));

  return colorScore * 0.4 + entropyScore * 0.4 + edgeScore * 0.2;
}

/**
 * Score the image data for photorealism using Medium-tier heuristics.
 * Extends Low tier with block variance and saturation distribution.
 */
export function scoreMediumTier(data: Uint8ClampedArray): number {
  const baseScore = scoreLowTier(data);
  const blockVar = computeBlockVariance(data, PREFILTER_SIZE, PREFILTER_SIZE);
  const satVar = computeSaturationVariance(data);

  // Block variance: < 20 → 0, > 200 → 1 (photos have texture noise)
  const noiseScore = Math.min(1, Math.max(0, (blockVar - 20) / 180));
  // Saturation variance: < 0.03 → 0 (flat cartoon), > 0.06 → 1 (photo variety)
  const satScore = Math.min(1, Math.max(0, (satVar - 0.03) / 0.03));

  // Blend: give medium-tier signals a 30% weight on top of the 70% base
  return baseScore * 0.7 + noiseScore * 0.15 + satScore * 0.15;
}

/**
 * Score using High-tier analysis.
 * Uses the registered ML model runner when available (see `registerMlModel`).
 * Falls back to Medium-tier canvas analysis when no model is registered.
 */
async function scoreHighTier(data: Uint8ClampedArray): Promise<number> {
  if (_mlModelRunner !== null) {
    try {
      const mlScore = await _mlModelRunner.run(data, PREFILTER_SIZE, PREFILTER_SIZE);
      // Blend: ML model result weighted 70%, canvas analysis 30%
      return scoreMediumTier(data) * 0.3 + mlScore * 0.7;
    } catch {
      // ML inference failed — fall back to medium tier
    }
  }
  // Fall back to Medium tier when no model is registered
  return scoreMediumTier(data);
}

// ── Public pre-filter API ────────────────────────────────────────────────────

/**
 * Determine whether drawing `img` to a canvas would taint it (making
 * `toDataURL` / `getImageData` throw a SecurityError).
 *
 * An image is safe to read from canvas when:
 *  - its src is a data: or blob: URI (never cross-origin), or
 *  - its src shares the current document's origin, or
 *  - it carries a crossOrigin attribute (indicates it was loaded with CORS).
 *
 * When in doubt we return `true` (assume tainted) to avoid triggering the
 * browser's console SecurityError, which appears even for caught exceptions.
 */
function wouldTaintCanvas(img: HTMLImageElement): boolean {
  const src = img.src;
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;
  try {
    const imgOrigin = new URL(src).origin;
    if (imgOrigin === self.location.origin) return false;
  } catch {
    return false; // relative URL — same origin
  }
  // Cross-origin: only safe if the element carries a crossOrigin attribute
  // (meaning it was loaded with CORS and the server returned Allow-Origin headers).
  return img.crossOrigin !== 'anonymous' && img.crossOrigin !== 'use-credentials';
}

/**
 * Draw an HTMLImageElement into a small canvas and return the pixel data.
 * Returns null if the image is cross-origin or the canvas context is unavailable.
 */
function extractPixelData(img: HTMLImageElement): Uint8ClampedArray | null {
  if (wouldTaintCanvas(img)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PREFILTER_SIZE;
    canvas.height = PREFILTER_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, PREFILTER_SIZE, PREFILTER_SIZE);
    return ctx.getImageData(0, 0, PREFILTER_SIZE, PREFILTER_SIZE).data;
  } catch {
    return null;
  }
}

/**
 * Run the photorealism pre-filter on raw RGBA pixel data (for testing, provide mock data).
 * When `data` is null (canvas unavailable / cross-origin), the image is treated as
 * potentially photorealistic (we don't skip it — conservative default).
 */
export async function runPhotorealismPreFilter(
  data: Uint8ClampedArray | null,
  quality: DetectionQuality = 'medium'
): Promise<PhotorealismResult> {
  if (data === null) {
    // Cannot analyse — treat as photorealistic to avoid missing real detections
    return { isPhotorealistic: true, score: 0.5 };
  }

  let score: number;
  if (quality === 'high') {
    score = await scoreHighTier(data);
  } else if (quality === 'medium') {
    score = scoreMediumTier(data);
  } else {
    score = scoreLowTier(data);
  }

  return {
    isPhotorealistic: score >= PHOTOREALISM_SKIP_THRESHOLD,
    score,
  };
}

// ── AI-generation local heuristics ──────────────────────────────────────────

/** Known AI image hosting patterns */
const AI_CDN_PATTERNS: RegExp[] = [
  /midjourney/i,
  /dalle[_-]?(2|3)?/i,
  /stability\.ai/i,
  /runwayml/i,
  /novelai/i,
  /civitai/i,
  /dreamstudio/i,
  /images\.openai\.com/i,
  /cdn\.leonardo\.ai/i,
  /firefly\.adobe\.com/i,
];

function matchesAICDN(src: string): boolean {
  return AI_CDN_PATTERNS.some((r) => r.test(src));
}

const AI_ASPECT_RATIOS: Array<[number, number]> = [
  [1, 1],
  [4, 3],
  [3, 4],
  [16, 9],
  [9, 16],
  [3, 2],
  [2, 3],
];

function isLikelyAIAspectRatio(w: number, h: number): boolean {
  if (w === 0 || h === 0) return false;
  const ratio = w / h;
  return AI_ASPECT_RATIOS.some(([rw, rh]) => Math.abs(ratio - rw / rh) < 0.02);
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function isLikelyAIDimension(w: number, h: number): boolean {
  return isPowerOfTwo(w) && isPowerOfTwo(h);
}

/**
 * Returns 0–1 local AI-generation score based on URL patterns and dimensions.
 */
export function computeLocalImageScore(
  src: string,
  naturalWidth: number,
  naturalHeight: number
): number {
  let score = 0;

  if (matchesAICDN(src)) score += 0.7;

  if (isLikelyAIDimension(naturalWidth, naturalHeight)) score += 0.2;
  else if (isLikelyAIAspectRatio(naturalWidth, naturalHeight)) score += 0.1;

  if (naturalWidth > 0 && naturalWidth % 64 === 0 && naturalHeight % 64 === 0) {
    score += 0.1;
  }

  return Math.min(1, score);
}

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

/**
 * Downscale an HTMLImageElement for remote transmission.
 * Returns null for cross-origin images (would taint the canvas).
 */
function downscaleImage(img: HTMLImageElement, maxDim = 128): string | null {
  if (wouldTaintCanvas(img)) return null;
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

// ── Detector class ───────────────────────────────────────────────────────────

export class ImageDetector implements Detector {
  readonly contentType = 'image' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiter = new RateLimiter(60, 60_000);

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const img = content instanceof HTMLImageElement ? content : null;
    const src = img?.src ?? (typeof content === 'string' ? content : '');
    const cacheKey = hashUrl(src);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // ── Step 1: Photorealism pre-filter ───────────────────────────────────────
    // Only runs on actual HTMLImageElement instances; string URLs skip the canvas step.
    const pixelData = img ? extractPixelData(img) : null;
    const quality = options.detectionQuality ?? 'medium';
    const preFilter = await runPhotorealismPreFilter(pixelData, quality);

    if (!preFilter.isPhotorealistic) {
      // Not photorealistic — skip AI detection entirely
      const skipped: DetectionResult = {
        contentType: 'image',
        isAIGenerated: false,
        confidence: 'low',
        score: 0,
        source: 'local',
        skippedByPreFilter: true,
        details: `Pre-filter score ${preFilter.score.toFixed(2)} below threshold — not photorealistic`,
      };
      this.cache.set(cacheKey, skipped);
      return skipped;
    }

    // ── Step 2: Local AI-generation heuristics ────────────────────────────────
    const nw = img?.naturalWidth ?? 0;
    const nh = img?.naturalHeight ?? 0;
    const localScore = computeLocalImageScore(src, nw, nh);

    // ── Step 2b: Visual AI scoring (medium / high tiers) ─────────────────────
    // Uses per-pixel statistics from the pre-filter canvas sample to detect
    // diffusion-model characteristics (uniform saturation, balanced channels,
    // well-exposed luminance). Improves detection of AI images that don't
    // match known CDN patterns or dimension heuristics.
    let combinedLocalScore = localScore;
    if (pixelData && quality !== 'low') {
      const visualScore = computeVisualAIScore(pixelData, PREFILTER_SIZE, PREFILTER_SIZE);
      // Give visual pixel analysis equal standing with URL/dimension heuristics.
      // Take the higher of the URL/dimension score or the visual score (after discount).
      // The previous *0.6 double-discount when localScore>=0.3 made visual analysis
      // nearly irrelevant for the most common case (re-uploaded AI images with some
      // dimension match but no CDN URL match). Removed that double-discount.
      const visualWeight = quality === 'high' ? 0.85 : 0.75;
      combinedLocalScore = Math.max(localScore, visualScore * visualWeight);
    }

    // ── Step 2c: EXIF metadata analysis ──────────────────────────────────────
    // EXIF and C2PA metadata reside in the original image binary.
    // Canvas re-encoding strips all metadata. Direct fetch() from a content
    // script hits CORS restrictions for cross-origin images.
    // When options.fetchBytes is provided (e.g. via a background service worker
    // that is not CORS-restricted), use it. Otherwise fall back to direct fetch.
    let metadataDataUrl: string | null = null;
    if (src && /^https?:\/\//.test(src)) {
      try {
        if (options.fetchBytes) {
          // Extension-provided fetch: bypasses CORS (background SW context)
          metadataDataUrl = await options.fetchBytes(src);
        } else {
          // Direct fetch: only works for same-origin / CORS-enabled images
          const resp = await fetch(src, { cache: 'force-cache' });
          if (resp.ok) {
            const blob = await resp.blob();
            metadataDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch {
        // CORS block, network error, or unsupported environment — skip
      }
    } else if (src && src.startsWith('data:')) {
      // Already a data URL — use directly
      metadataDataUrl = src;
    }

    let exifScore = 0;
    if (metadataDataUrl) {
      const exifData = parseExifFromDataUrl(metadataDataUrl);
      exifScore = getExifAIScore(exifData);
    }

    // ── Step 2d: C2PA / Content Credentials detection ─────────────────────────
    // C2PA presence is a positive authenticity signal (reduces AI score).
    let c2paAdjustment = 0;
    if (metadataDataUrl) {
      const c2pa = detectC2PAFromDataUrl(metadataDataUrl);
      c2paAdjustment = c2pa.scoreAdjustment;
    }

    // Blend EXIF signal into combined local score (EXIF is a 15% weight)
    if (exifScore > 0) {
      combinedLocalScore = Math.min(1, combinedLocalScore * 0.85 + exifScore * 0.15);
    }
    // Apply C2PA adjustment (negative = more authentic → reduce score)
    combinedLocalScore = Math.max(0, combinedLocalScore + c2paAdjustment);

    let finalScore = combinedLocalScore;
    let source: DetectionResult['source'] = 'local';

    // ── Step 3: Remote classification ─────────────────────────────────────────
    // Always send to remote when enabled and the image passed the pre-filter.
    if (options.remoteEnabled && img) {
      if (this.rateLimiter.consume()) {
        try {
          const dataUrl = downscaleImage(img);
          const imageHash = hashDataUrl(dataUrl ?? src);
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          const payload: RemotePayload = {
            imageHash,
            imageDataUrl: dataUrl ?? undefined,
            // Fall back to the source URL for vision-capable adapters when
            // canvas is unavailable (e.g. cross-origin image, no CORS headers).
            imageUrl: dataUrl ? undefined : src,
          };
          // Remote classification must go through the remoteClassify callback
          // (provided by extension content scripts to route via the CORS-free
          // background service worker). Skip remote if callback is not set.
          if (!options.remoteClassify) throw new Error('remoteClassify callback required');
          const result = await options.remoteClassify(endpoint, apiKey, 'image', payload);
          finalScore = combinedLocalScore * 0.3 + result.score * 0.7;
          source = 'remote';
        } catch (err) {
          // Remote call failed — return the token so it can be used for other content
          this.rateLimiter.returnToken();
          console.warn('[RealityCheck] Remote image classification failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    // Use a lower threshold for local-only results: heuristics alone are weaker
    // than the remote classifier, so a lower bar catches more AI images while
    // accepting some false positives. The remote classifier (when enabled) uses
    // a calibrated 0.35 threshold against the blended remote+local score.
    const aiThreshold = source === 'local' ? 0.25 : 0.35;
    const result: DetectionResult = {
      contentType: 'image',
      isAIGenerated: finalScore >= aiThreshold,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
