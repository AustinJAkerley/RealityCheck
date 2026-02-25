/**
 * Video detector — URL heuristics + multi-frame sampling + remote escalation.
 *
 * Flow:
 * 1. Check URL against known AI video platform patterns.
 * 2. Attempt multi-frame canvas capture (same-origin only).
 *    Captures up to 5 frames at evenly-spaced timestamps and computes:
 *    - Frame difference variance (low variance = temporal inconsistency signal)
 *    - AI visual scoring on individual frames
 * 3. If remoteEnabled: send the most-representative frame to the remote
 *    classifier and blend with URL + temporal scores.
 *
 * Frame-level deep-fake detection requires a dedicated model (e.g. FaceForensics++
 * based classifiers). In local-only mode we combine URL heuristics with
 * basic temporal analysis.
 *
 * Known limitations:
 * - Canvas frame capture is blocked for cross-origin videos (CORS taint).
 * - Frame sampling cannot reliably detect all deepfakes.
 * - Multi-frame seeking is asynchronous and may not work on all browsers/codecs.
 */
import { DetectionResult, Detector, DetectorOptions } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { createRemoteAdapter } from '../adapters/remote-adapter.js';
import { computeVisualAIScore, runMlModelScore } from './image-detector.js';

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

/**
 * Capture pixel data from the video at its current timestamp.
 * Returns null on cross-origin or canvas failure.
 */
function captureFramePixels(
  video: HTMLVideoElement,
  width: number,
  height: number
): Uint8ClampedArray | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

/**
 * Compute mean absolute difference between two RGBA pixel buffers (luminance only).
 * Returns 0–255 scale; higher = more motion / more different frames.
 */
function meanFrameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let total = 0;
  const pixelCount = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const lumA = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000;
    const lumB = (b[i] * 299 + b[i + 1] * 587 + b[i + 2] * 114) / 1000;
    total += Math.abs(lumA - lumB);
  }
  return total / pixelCount;
}

/**
 * Seek a video element to a specific time and wait for seeked event.
 * Resolves immediately if the video is not seekable or seek times out.
 */
function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    if (!isFinite(video.duration) || video.duration <= 0) {
      resolve();
      return;
    }
    const clampedTime = Math.min(time, video.duration - 0.05);
    if (clampedTime < 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = clampedTime;
  });
}

/** Number of frames to sample for temporal analysis */
const MULTI_FRAME_COUNT = 5;
/** Downscale size for temporal frame comparison */
const FRAME_ANALYSIS_SIZE = 64;
const OBVIOUS_METADATA_AI_THRESHOLD = 0.7;
const LOCAL_UNCERTAIN_MIN = 0.25;
const LOCAL_UNCERTAIN_MAX = 0.75;
const VIDEO_LOCAL_AI_THRESHOLD = 0.45;

function getMlFrameDimensions(
  width: number,
  height: number,
  quality: DetectorOptions['detectionQuality']
): { width: number; height: number } {
  if (quality === 'high') {
    return { width, height };
  }
  if (quality === 'medium') {
    return { width: Math.max(1, Math.round(width / 2)), height: Math.max(1, Math.round(height / 2)) };
  }
  const scale = Math.min(1, 192 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Sample multiple frames from the video and compute temporal consistency.
 *
 * Returns an object with:
 * - `frames`: data URLs of captured frames (for remote classification)
 * - `temporalScore`: 0–1 AI-generation signal from temporal analysis
 *   (higher = more temporally inconsistent = more likely deepfake)
 * - `visualScore`: average visual AI score across frames
 */
async function analyzeVideoFrames(
  video: HTMLVideoElement,
  quality: DetectorOptions['detectionQuality']
): Promise<{
  frames: string[];
  temporalScore: number;
  visualScore: number;
  modelScore: number;
  hasModelScore: boolean;
}> {
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0 || video.videoWidth === 0) {
    return { frames: [], temporalScore: 0, visualScore: 0, modelScore: 0, hasModelScore: false };
  }

  const frameDataUrls: string[] = [];
  const framePixels: Uint8ClampedArray[] = [];
  const mlFramePixels: Uint8ClampedArray[] = [];
  const mlDims = getMlFrameDimensions(video.videoWidth, video.videoHeight, quality);

  // Sample at evenly-spaced intervals, skipping the very start and end
  const step = duration / (MULTI_FRAME_COUNT + 1);
  const savedTime = video.currentTime;

  for (let i = 1; i <= MULTI_FRAME_COUNT; i++) {
    await seekTo(video, step * i);
    const pixels = captureFramePixels(video, FRAME_ANALYSIS_SIZE, FRAME_ANALYSIS_SIZE);
    if (pixels) framePixels.push(pixels);
    const mlPixels = captureFramePixels(video, mlDims.width, mlDims.height);
    if (mlPixels) mlFramePixels.push(mlPixels);
    const dataUrl = captureVideoFrame(video);
    if (dataUrl) frameDataUrls.push(dataUrl);
  }

  // Restore original time
  await seekTo(video, savedTime);

  if (framePixels.length < 2) {
    return { frames: frameDataUrls, temporalScore: 0, visualScore: 0, modelScore: 0, hasModelScore: false };
  }

  // Compute frame-to-frame differences
  const diffs: number[] = [];
  for (let i = 1; i < framePixels.length; i++) {
    diffs.push(meanFrameDifference(framePixels[i - 1], framePixels[i]));
  }
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const diffVariance =
    diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / diffs.length;

  // Deepfake temporal signal:
  // Very low mean difference across ALL frames (< 3 lum units on a 0–255 scale)
  // = nearly static content, which is unusual for real video (even a talking-head
  // video shows eye blinks and subtle motion). Threshold of 3 was chosen as the
  // lower bound of observable luminance change for a 64×64 sample of real video
  // (typical talking-head: ~5–15 lum units; looped/generated: < 3).
  // High variance in frame differences = inconsistent motion = deepfake artefact.
  const staticScore = meanDiff < 3 ? 0.25 : 0; // nearly static
  const inconsistencyScore = Math.min(0.25, diffVariance / 500);
  const temporalScore = staticScore + inconsistencyScore;

  // Average visual AI score across frames
  const visualScores = framePixels.map((px) =>
    computeVisualAIScore(px, FRAME_ANALYSIS_SIZE, FRAME_ANALYSIS_SIZE)
  );
  const visualScore =
    visualScores.reduce((a, b) => a + b, 0) / visualScores.length;

  let modelScore = 0;
  let hasModelScore = false;
  const modelScores = await Promise.all(
    mlFramePixels.map((px) => runMlModelScore(px, mlDims.width, mlDims.height))
  );
  const usableScores = modelScores.filter((s): s is number => typeof s === 'number');
  if (usableScores.length > 0) {
    modelScore = usableScores.reduce((a, b) => a + b, 0) / usableScores.length;
    hasModelScore = true;
  }

  return { frames: frameDataUrls, temporalScore, visualScore, modelScore, hasModelScore };
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

    // Step 1: URL heuristics
    const localScore = matchesAIVideoUrl(src) ? 0.7 : 0;
    const isObviousMetadataAI = localScore >= OBVIOUS_METADATA_AI_THRESHOLD;
    let decisionStage: DetectionResult['decisionStage'] = 'initial_heuristics';

    let finalScore = localScore;
    let source: DetectionResult['source'] = 'local';
    let details = isObviousMetadataAI
      ? `Initial heuristics (metadata/URL) flagged obvious AI (${localScore.toFixed(2)})`
      : `Initial heuristics score: ${localScore.toFixed(2)}`;

    if (isObviousMetadataAI) {
      finalScore = 0.95;
      const immediate: DetectionResult = {
        contentType: 'video',
        isAIGenerated: true,
        confidence: scoreToConfidence(finalScore),
        score: finalScore,
        source,
        decisionStage,
        details,
      };
      this.cache.set(cacheKey, immediate);
      return immediate;
    }

    // Step 2: Multi-frame temporal analysis (same-origin video elements only).
    // This runs before remote classification to enrich the local signal.
    let temporalScore = 0;
    let videoVisualScore = 0;
    let videoModelScore = 0;
    let hasVideoModelScore = false;
    let localModelScore: number | undefined = undefined;
    let capturedFrames: string[] = [];
    if (video) {
      try {
        const analysis = await analyzeVideoFrames(video, options.detectionQuality);
        temporalScore = analysis.temporalScore;
        videoVisualScore = analysis.visualScore;
        videoModelScore = analysis.modelScore;
        hasVideoModelScore = analysis.hasModelScore;
        if (hasVideoModelScore) localModelScore = videoModelScore;
        capturedFrames = analysis.frames;

        // Blend temporal and visual signals into local score.
        // Visual boost increased from 0.2 to 0.35 to give pixel analysis
        // meaningful weight when there is no URL match.
        const temporalBoost = Math.min(0.3, temporalScore);
        const visualBoost = videoVisualScore * 0.35;
        const heuristicComposite = Math.min(1, localScore + temporalBoost + visualBoost);
        if (hasVideoModelScore) {
          // Use local ML first. Escalate to remote only if uncertain.
          if (videoModelScore >= LOCAL_UNCERTAIN_MAX) {
            const corroboratedByHeuristics = localScore >= 0.7 || temporalScore >= 0.2;
            finalScore = corroboratedByHeuristics ? 0.95 : 0.35;
          } else if (videoModelScore <= LOCAL_UNCERTAIN_MIN) {
            finalScore = 0.05;
          } else {
            finalScore = Math.min(LOCAL_UNCERTAIN_MAX, heuristicComposite * 0.6 + videoModelScore * 0.4);
          }
          decisionStage = 'local_ml';
          details = `Local ML frame verdict: ${videoModelScore >= 0.5 ? 'AI generated' : 'Not AI generated'} (${videoModelScore.toFixed(2)}), temporal=${temporalScore.toFixed(2)}`;
        } else {
          const modelBoost = videoModelScore * 0.45;
          finalScore = Math.min(1, localScore + temporalBoost + visualBoost + modelBoost);
          details = `Initial+temporal+visual score: ${finalScore.toFixed(2)}`;
        }
      } catch {
        // Frame analysis failed — continue with URL score only
      }
    }

    // Step 3: Remote classification — send best available frame.
    const shouldEscalateRemote =
      finalScore > LOCAL_UNCERTAIN_MIN && finalScore < LOCAL_UNCERTAIN_MAX;

    if (options.remoteEnabled && video && shouldEscalateRemote) {
      if (this.rateLimiter.consume()) {
        try {
          // Prefer frames from multi-frame analysis; fall back to a fresh single-frame
          // capture only when multi-frame analysis returned no frames (e.g. video not
          // yet loaded, zero dimensions). Both paths can return null on cross-origin.
          const frameDataUrl =
            capturedFrames.length > 0 ? capturedFrames[0] : captureVideoFrame(video);
          if (frameDataUrl) {
            const imageHash = hashDataUrl(frameDataUrl);
            const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
            const adapter = createRemoteAdapter(endpoint);
            const result = await adapter.classify('video', {
              imageHash,
              imageDataUrl: frameDataUrl,
            });
            finalScore = finalScore * 0.3 + result.score * 0.7;
            source = 'remote';
            decisionStage = 'remote_ml';
            details = `Remote ML score: ${result.score.toFixed(2)} (blended ${finalScore.toFixed(2)})`;
          }
        } catch {
          // Fall back to local
        }
      }
    }

    // Use a lower threshold for local-only results (same rationale as image detector).
    const aiThreshold = source === 'local' ? VIDEO_LOCAL_AI_THRESHOLD : 0.35;
    const result: DetectionResult = {
      contentType: 'video',
      isAIGenerated: finalScore >= aiThreshold,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
      decisionStage,
      localModelScore,
      details,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
