/**
 * Image detector — local SDXL model + optional remote escalation.
 *
 * Pipeline:
 * 1. Load the image onto a canvas and extract RGBA pixel data.
 * 2. Run the registered Organika/sdxl-detector local ML model.
 * 3. If the local score is uncertain (UNCERTAIN_MIN–UNCERTAIN_MAX) AND
 *    options.remoteEnabled is true, escalate to the remote classifier
 *    and blend: 30% local + 70% remote.
 * 4. Return a DetectionResult.
 *
 * No heuristics, no EXIF/C2PA, no URL pattern matching — pure ML.
 */
import { DetectionResult, DetectorOptions, MlModelRunner, RemotePayload, DetectionQuality } from '../types.js';
import { Detector } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';

// ── ML model registry ────────────────────────────────────────────────────────

let _mlModelRunner: MlModelRunner | null = null;

/**
 * Register the SDXL model runner.
 * Called at extension startup via `registerSdxlDetectorProxy()`.
 */
export function registerMlModel(runner: MlModelRunner): void {
  _mlModelRunner = runner;
}

/** Returns true when the SDXL model runner has been registered. */
export function isMlModelAvailable(): boolean {
  return _mlModelRunner !== null;
}

/**
 * Run the registered ML model on pixel data.
 * Returns null when no model is registered or inference fails.
 */
export async function runMlModelScore(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<number | null> {
  if (_mlModelRunner === null) return null;
  try {
    const score = await _mlModelRunner.run(data, width, height);
    return Math.max(0, Math.min(1, score));
  } catch {
    return null;
  }
}

// ── Downscale helper ─────────────────────────────────────────────────────────

/**
 * Returns the maximum image dimension (in pixels) used when downscaling for
 * local SDXL inference and remote transmission, based on the quality tier.
 *
 * - low:    64 px — fastest; minimal bandwidth usage
 * - medium: 128 px — balanced default
 * - high:   512 px — highest fidelity
 */
export function getDownscaleMaxDim(quality: DetectionQuality): number {
  if (quality === 'high') return 512;
  if (quality === 'medium') return 128;
  return 64; // low
}

// ── Image load + pixel extraction ────────────────────────────────────────────

/**
 * Load an image URL onto a canvas and return RGBA pixel data + data URL.
 * Returns null when the image is cross-origin/tainted, fails to load,
 * or does not produce a response within the timeout.
 */
async function loadImageData(
  src: string,
  maxDim: number,
  timeoutMs = 3000
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number; dataUrl: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve({ pixels: imageData.data, width: w, height: h, dataUrl });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

// ── Scoring helpers ──────────────────────────────────────────────────────────

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

/** Threshold above which the result is classified as AI-generated */
const AI_THRESHOLD = 0.40;
/** Remote escalation fires when local score is in this uncertain band */
const UNCERTAIN_MIN = 0.25;
const UNCERTAIN_MAX = 0.75;

// ── ImageDetector ────────────────────────────────────────────────────────────

export class ImageDetector implements Detector {
  readonly contentType = 'image' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiters: Record<string, RateLimiter> = {
    low: new RateLimiter(10, 60_000),
    medium: new RateLimiter(30, 60_000),
    high: new RateLimiter(60, 60_000),
  };

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const src =
      content instanceof HTMLImageElement
        ? content.currentSrc || content.src
        : typeof content === 'string'
        ? content
        : '';

    const cacheKey = hashUrl(src);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const quality = options.detectionQuality ?? 'high';
    const maxDim = getDownscaleMaxDim(quality);

    // Step 1: Run SDXL local model
    const imageData = src ? await loadImageData(src, maxDim) : null;

    let localScore: number | null = null;
    if (imageData && _mlModelRunner) {
      localScore = await runMlModelScore(imageData.pixels, imageData.width, imageData.height);
    }

    let score = localScore ?? 0.5;
    let source: DetectionResult['source'] = 'local';
    let details = localScore !== null
      ? `SDXL local score: ${localScore.toFixed(3)}`
      : 'SDXL model unavailable or image could not be loaded';

    // Step 2: Remote escalation when score is uncertain and remote is enabled
    const uncertain = score >= UNCERTAIN_MIN && score <= UNCERTAIN_MAX;
    if (uncertain && options.remoteEnabled && options.remoteClassify) {
      const rl = this.rateLimiters[quality];
      if (rl.consume()) {
        try {
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          const payload: RemotePayload = {
            imageHash: hashDataUrl(imageData?.dataUrl ?? src),
            imageDataUrl: imageData?.dataUrl,
            imageUrl: imageData?.dataUrl ? undefined : src,
          };
          const remote = await options.remoteClassify(endpoint, apiKey, 'image', payload);
          if (remote.label !== 'error') {
            const blended = score * 0.3 + remote.score * 0.7;
            score = blended;
            source = 'remote';
            details = `SDXL local: ${localScore?.toFixed(3) ?? '0.500'}, remote: ${remote.score.toFixed(3)}, blended: ${blended.toFixed(3)}`;
          }
        } catch (err) {
          rl.returnToken();
          console.warn('[RealityCheck] Remote image classification failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'image',
      isAIGenerated: score >= AI_THRESHOLD,
      confidence: scoreToConfidence(score),
      score,
      source,
      localModelScore: localScore ?? undefined,
      details,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
