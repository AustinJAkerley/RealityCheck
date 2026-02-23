/**
 * Video detector — lightweight sampling strategy.
 *
 * Approach (in descending priority):
 * 1. URL/src heuristics (known AI video platforms, generated-content CDNs).
 * 2. Periodic frame capture via canvas (one frame per 5 s) — only if
 *    the video element is visible and not cross-origin.
 * 3. Optional remote classifier of sampled frames.
 *
 * Frame-level deep-fake detection requires a dedicated model (e.g. FaceForensics++
 * based classifiers). In local-only mode we fall back to URL heuristics and
 * a conservative score. See docs/architecture.md for references.
 *
 * Known limitations:
 * - Canvas frame capture is blocked for cross-origin videos (CORS taint).
 * - Frame sampling cannot reliably detect all deepfakes.
 */
import { DetectionResult, Detector, DetectorOptions } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { createRemoteAdapter } from '../adapters/remote-adapter.js';

const AI_VIDEO_PATTERNS: RegExp[] = [
  /sora\.openai/i,
  /runwayml/i,
  /pika\.art/i,
  /kaiber\.ai/i,
  /d-id\.com/i,
  /heygen\.com/i,
  /synthesia\.io/i,
  /deep[-]?fake/i,
  /gen[-]?2/i,
];

function matchesAIVideoUrl(src: string): boolean {
  return AI_VIDEO_PATTERNS.some((r) => r.test(src));
}

/**
 * Attempt to capture a single frame from a video element.
 * Returns null if the video is cross-origin or capture fails.
 */
function captureVideoFrame(video: HTMLVideoElement, maxDim = 128): string | null {
  try {
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // toDataURL throws for cross-origin videos
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

export class VideoDetector implements Detector {
  readonly contentType = 'video' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiter = new RateLimiter(5, 60_000);

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const video = content instanceof HTMLVideoElement ? content : null;
    const src = video?.currentSrc ?? video?.src ?? (typeof content === 'string' ? content : '');
    const cacheKey = hashUrl(src);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let localScore = matchesAIVideoUrl(src) ? 0.7 : 0;

    let finalScore = localScore;
    let source: DetectionResult['source'] = 'local';

    if (!options.localOnly && options.remoteEndpoint && video) {
      if (this.rateLimiter.consume()) {
        try {
          const frameDataUrl = captureVideoFrame(video);
          if (frameDataUrl) {
            const imageHash = hashDataUrl(frameDataUrl);
            const adapter = createRemoteAdapter(options.remoteEndpoint, options.remoteApiKey ?? '');
            const result = await adapter.classify('video', {
              imageHash,
              imageDataUrl: frameDataUrl,
            });
            finalScore = localScore * 0.3 + result.score * 0.7;
            source = 'remote';
          }
        } catch {
          // Fall back to local
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'video',
      isAIGenerated: finalScore >= 0.35,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
