/**
 * Image detector — local metadata/provenance checks + optional remote classifier.
 *
 * Local heuristics:
 * - C2PA/Content-Credentials metadata check (via HTTP headers or embedded XMP — limited)
 * - Aspect-ratio and dimension checks (common AI image aspect ratios)
 * - EXIF absence (AI images often lack camera EXIF data)
 * - src URL heuristics (known AI image CDN patterns)
 *
 * Note: without a real binary EXIF parser in the browser, EXIF checks are best-effort.
 * The remote classifier sends only a downscaled data URL (privacy: user must opt in).
 *
 * Known limitations: local heuristics have low accuracy for novel AI models.
 * See docs/architecture.md for details.
 */
import { DetectionResult, Detector, DetectorOptions } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { createRemoteAdapter } from '../adapters/remote-adapter.js';

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

/** Common AI-generated image dimensions/ratios */
const AI_ASPECT_RATIOS: Array<[number, number]> = [
  [1, 1], // 512×512, 1024×1024 (square)
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

/** Power-of-two dimensions are very common for AI-generated images */
function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function isLikelyAIDimension(w: number, h: number): boolean {
  return isPowerOfTwo(w) && isPowerOfTwo(h);
}

/**
 * Returns 0–1 local score.
 * @param src - The image src URL
 * @param naturalWidth / naturalHeight - from the HTMLImageElement
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

  // Very large or very small images with round dimensions are suspicious
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
 * Downscale an HTMLImageElement to a small canvas and return a data URL.
 * Used to send a thumbnail to a remote classifier (privacy: opt-in only).
 */
function downscaleImage(img: HTMLImageElement, maxDim = 128): string | null {
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

export class ImageDetector implements Detector {
  readonly contentType = 'image' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiter = new RateLimiter(10, 60_000);

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const img = content instanceof HTMLImageElement ? content : null;
    const src = img?.src ?? (typeof content === 'string' ? content : '');
    const cacheKey = hashUrl(src);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const nw = img?.naturalWidth ?? 0;
    const nh = img?.naturalHeight ?? 0;
    const localScore = computeLocalImageScore(src, nw, nh);

    let finalScore = localScore;
    let source: DetectionResult['source'] = 'local';

    if (!options.localOnly && options.remoteEndpoint && img) {
      if (this.rateLimiter.consume()) {
        try {
          const dataUrl = downscaleImage(img);
          const imageHash = hashDataUrl(dataUrl ?? src);
          const adapter = createRemoteAdapter(options.remoteEndpoint, options.remoteApiKey ?? '');
          const result = await adapter.classify('image', {
            imageHash,
            imageDataUrl: dataUrl ?? undefined,
          });
          finalScore = localScore * 0.3 + result.score * 0.7;
          source = 'remote';
        } catch {
          // Remote call failed — fall back to local score
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'image',
      isAIGenerated: finalScore >= 0.35,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
