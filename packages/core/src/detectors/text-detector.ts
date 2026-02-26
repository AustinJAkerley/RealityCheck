/**
 * Text detector — remote ML classifier only.
 *
 * The Organika/sdxl-detector is an image model and cannot classify text.
 * When remoteEnabled, text is sent directly to the remote classifier.
 * When remoteEnabled is false, a neutral result is returned.
 */
import { DetectionResult, Detector, DetectorOptions, RemotePayload } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashText } from '../utils/hash.js';

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

const AI_THRESHOLD = 0.35;

export class TextDetector implements Detector {
  readonly contentType = 'text' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiters: Record<string, RateLimiter> = {
    low: new RateLimiter(10, 60_000),
    medium: new RateLimiter(30, 60_000),
    high: new RateLimiter(60, 60_000),
  };

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const text = typeof content === 'string' ? content : (content as HTMLElement).innerText ?? '';
    const key = hashText(text);

    const cached = this.cache.get(key);
    if (cached) return cached;

    let score = 0;
    let source: DetectionResult['source'] = 'local';
    let details = 'No local text model; remote classification disabled.';

    if (options.remoteEnabled && options.remoteClassify) {
      const rl = this.rateLimiters[options.detectionQuality ?? 'high'];
      if (rl.consume()) {
        try {
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          const payload: RemotePayload = { text: text.slice(0, 2000) };
          const remote = await options.remoteClassify(endpoint, apiKey, 'text', payload);
          if (remote.label !== 'error') {
            score = remote.score;
            source = 'remote';
            details = `Remote score: ${score.toFixed(3)}`;
          } else {
            details = 'Remote classification returned error; falling back to neutral.';
          }
        } catch (err) {
          rl.returnToken();
          console.warn('[RealityCheck] Remote text classification failed:', err instanceof Error ? err.message : err);
          details = 'Remote classification failed; falling back to neutral.';
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'text',
      isAIGenerated: score >= AI_THRESHOLD,
      confidence: scoreToConfidence(score),
      score,
      source,
      details,
    };

    this.cache.set(key, result);
    return result;
  }
}
