/**
 * Video detector — local SDXL model on captured frames + optional remote escalation.
 *
 * Pipeline:
 * 1. Capture FRAME_COUNT frames from the video element at evenly-spaced timestamps.
 * 2. Run the Organika/sdxl-detector local ML model on each frame, then average.
 * 3. If the averaged score is uncertain (UNCERTAIN_MIN–UNCERTAIN_MAX) AND
 *    options.remoteEnabled is true, capture quality-based frames at 0.25s intervals
 *    and send them to the remote classifier, then blend: 30% local + 70% remote.
 * 4. Return a DetectionResult.
 *
 * No URL pattern matching, no temporal/frame-diff analysis — pure ML.
 * Cross-origin videos cannot have their frames read (canvas taint); in that
 * case the detector returns a neutral 0.5 score.
 *
 * Remote video frames:
 * - low quality:    5 frames at 0.25s intervals
 * - medium quality: 10 frames at 0.25s intervals
 * - high quality:   20 frames at 0.25s intervals
 */
import { DetectionResult, DetectorOptions, Detector, RemotePayload, DetectionQuality } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { runMlModelScore, getDownscaleMaxDim } from './image-detector.js';

// ── Frame capture helpers ────────────────────────────────────────────────────

/** Number of frames sampled for local SDXL averaged detection */
const FRAME_COUNT = 5;

/** Quality-based frame counts for remote video classification (sampled at 0.25s intervals) */
const REMOTE_FRAME_COUNTS: Record<DetectionQuality, number> = {
  low: 5,
  medium: 10,
  high: 20,
};

function captureFramePixels(
  video: HTMLVideoElement,
  maxDim: number
): { pixels: Uint8ClampedArray; width: number; height: number; dataUrl: string } | null {
  try {
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    return { pixels, width: w, height: h, dataUrl };
  } catch {
    return null;
  }
}

function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    if (!isFinite(video.duration) || video.duration <= 0) { resolve(); return; }
    const clamped = Math.min(time, video.duration - 0.05);
    if (clamped < 0) { resolve(); return; }
    const timer = setTimeout(resolve, timeoutMs);
    const onSeeked = () => { clearTimeout(timer); video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = clamped;
  });
}

/**
 * Capture N frames at fixed 0.25s intervals for remote classification.
 * Sampling begins at t=0.25s (not t=0) to avoid unloaded or black frames
 * that are common at the very start of a video.
 * Stops early if the video duration is exceeded.
 * Returns as many data-URL frames as were successfully captured.
 */
async function captureFramesForRemote(
  video: HTMLVideoElement,
  count: number,
  maxDim: number
): Promise<string[]> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return [];
  const frames: string[] = [];
  const savedTime = video.currentTime;
  for (let i = 0; i < count; i++) {
    const time = 0.25 * (i + 1);
    if (isFinite(video.duration) && video.duration > 0 && time > video.duration) break;
    await seekTo(video, time);
    const frame = captureFramePixels(video, maxDim);
    if (frame) frames.push(frame.dataUrl);
  }
  await seekTo(video, savedTime);
  return frames;
}

// ── Scoring helpers ──────────────────────────────────────────────────────────

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

const AI_THRESHOLD = 0.40;
const UNCERTAIN_MIN = 0.25;
const UNCERTAIN_MAX = 0.75;

// ── VideoDetector ────────────────────────────────────────────────────────────

export class VideoDetector implements Detector {
  readonly contentType = 'video' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiters: Record<string, RateLimiter> = {
    low: new RateLimiter(5, 60_000),
    medium: new RateLimiter(15, 60_000),
    high: new RateLimiter(30, 60_000),
  };

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const video = content instanceof HTMLVideoElement ? content : null;
    const src = video?.currentSrc ?? video?.src ?? (typeof content === 'string' ? content : '');
    const cacheKey = hashUrl(src);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const quality = options.detectionQuality ?? 'high';
    const maxDim = getDownscaleMaxDim(quality);

    // Step 1: SDXL local model on FRAME_COUNT evenly-spaced frames
    let localScore: number | null = null;
    let bestFrameDataUrl: string | null = null;
    let bestFrameScore = -Infinity;

    if (video && video.videoWidth > 0 && isFinite(video.duration) && video.duration > 0) {
      const savedTime = video.currentTime;
      const step = video.duration / (FRAME_COUNT + 1);
      const scores: number[] = [];

      for (let i = 1; i <= FRAME_COUNT; i++) {
        await seekTo(video, step * i);
        const frame = captureFramePixels(video, maxDim);
        if (frame) {
          const s = await runMlModelScore(frame.pixels, frame.width, frame.height);
          if (s !== null) {
            scores.push(s);
            if (s > bestFrameScore) {
              bestFrameScore = s;
              bestFrameDataUrl = frame.dataUrl;
            }
          }
        }
      }
      await seekTo(video, savedTime);

      if (scores.length > 0) {
        localScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
    }

    let score = localScore ?? 0.5;
    let source: DetectionResult['source'] = 'local';
    let details = localScore !== null
      ? `SDXL avg across ${FRAME_COUNT} frames: ${score.toFixed(3)}`
      : 'No video element or frames could not be captured (cross-origin)';

    // Step 2: Remote escalation when score is uncertain and remote is enabled.
    // Sends quality-based multi-frame batches at 0.25s intervals:
    //   low=5, medium=10, high=20 frames
    const uncertain = score >= UNCERTAIN_MIN && score <= UNCERTAIN_MAX;
    if (uncertain && options.remoteEnabled && options.remoteClassify && video) {
      const rl = this.rateLimiters[quality];
      if (rl.consume()) {
        try {
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          // Capture quality-based frames for the remote classifier
          const remoteFrames = await captureFramesForRemote(
            video,
            REMOTE_FRAME_COUNTS[quality],
            maxDim
          );
          const payload: RemotePayload = remoteFrames.length > 0
            ? {
                imageHash: hashDataUrl(remoteFrames[0]),
                videoFrames: remoteFrames,
              }
            : {
                imageHash: hashDataUrl(bestFrameDataUrl ?? src),
                imageDataUrl: bestFrameDataUrl ?? undefined,
                imageUrl: bestFrameDataUrl ? undefined : src,
              };
          const remote = await options.remoteClassify(endpoint, apiKey, 'video', payload);
          if (remote.label !== 'error') {
            const blended = score * 0.3 + remote.score * 0.7;
            score = blended;
            source = 'remote';
            details = `SDXL local: ${localScore?.toFixed(3) ?? '0.500'}, remote: ${remote.score.toFixed(3)}, blended: ${blended.toFixed(3)} (${remoteFrames.length} frames sent)`;
          }
        } catch (err) {
          rl.returnToken();
          console.warn('[RealityCheck] Remote video classification failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'video',
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
