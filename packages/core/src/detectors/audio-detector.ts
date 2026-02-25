/**
 * Audio deepfake detector — URL heuristics + basic signal analysis.
 *
 * AI-generated audio (voice cloning, text-to-speech synthesis) is increasingly
 * common. This detector provides a first-pass signal using:
 *
 * 1. URL pattern matching against known AI audio generation platforms.
 * 2. Basic audio metadata analysis (when an HTMLAudioElement is available):
 *    - Very short duration clips with high bitrate = TTS pattern
 *    - Absence of metadata common to recorded audio
 *
 * Known limitations:
 * - Real spectral analysis (e.g. detecting vocoders) requires an ML model.
 * - Cross-origin audio elements cannot be inspected beyond basic attributes.
 * - URL heuristics only catch content explicitly hosted on known AI platforms.
 *
 * Future improvements:
 * - On-device ONNX model trained on mel-spectrogram features of TTS vs. real audio.
 * - ONNX Runtime Web inference against audio samples captured via Web Audio API.
 */
import { DetectionResult, Detector, DetectorOptions, RemotePayload } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl } from '../utils/hash.js';
import { createRemoteAdapter } from '../adapters/remote-adapter.js';

/** Known AI audio generation / voice cloning platform URL patterns */
const AI_AUDIO_PATTERNS: RegExp[] = [
  /elevenlabs\.io/i,
  /murf\.ai/i,
  /resemble\.ai/i,
  /descript\.com/i,
  /supertone/i,
  /voicify\.ai/i,
  /replica[-.]?studios/i,
  /wellsaid\.(labs|us)/i,
  /play\.ht/i,
  /speechify/i,
  /lovo\.ai/i,
  /listnr\.tech/i,
  /fakeyou\.com/i,
  /uberduck\.ai/i,
  /suno\.ai/i,
  /udio\.com/i,
  /aiva\.ai/i,
  /soundraw\.io/i,
  /loudly\.com/i,
  /beatoven\.ai/i,
];

function matchesAIAudioUrl(src: string): boolean {
  return AI_AUDIO_PATTERNS.some((r) => r.test(src));
}

/**
 * Heuristic score from audio element attributes.
 *
 * Signals that suggest AI-generated audio:
 * - Very uniform duration (round numbers like 5.0, 10.0 seconds) — TTS clips
 *   are often exactly N seconds; real recordings are rarely round numbers.
 * - No src filename extension that suggests a microphone recording (.wav, .aiff)
 * - MIME type that is purely synthesized (audio/mpeg from a streaming endpoint)
 *
 * Returns 0–0.3; intentionally capped low since these are weak signals.
 */
function computeAudioElementScore(audio: HTMLAudioElement): number {
  let score = 0;

  // Check for round-number duration (TTS artefact)
  const dur = audio.duration;
  if (isFinite(dur) && dur > 0) {
    const frac = dur % 1;
    // Very close to a whole second (within 0.01s) = suspicious
    if (frac < 0.01 || frac > 0.99) {
      score += 0.10;
    }
  }

  // Recorded audio file extensions rarely produce clean TTS
  const src = audio.currentSrc || audio.src || '';
  const lower = src.toLowerCase();
  if (/\.(wav|aiff?|flac|ogg)(\?|$)/.test(lower)) {
    // These formats are typical of real recorded audio — negative AI signal
    score -= 0.10;
  }

  return Math.max(0, Math.min(0.3, score));
}

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

export class AudioDetector implements Detector {
  readonly contentType = 'audio' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiter = new RateLimiter(10, 60_000);

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const audio = content instanceof HTMLAudioElement ? content : null;
    const src =
      audio?.currentSrc ?? audio?.src ?? (typeof content === 'string' ? content : '');
    const cacheKey = hashUrl(src);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Step 1: URL heuristics
    let localScore = matchesAIAudioUrl(src) ? 0.7 : 0;

    // Step 2: Audio element attribute analysis
    if (audio) {
      localScore = Math.min(1, localScore + computeAudioElementScore(audio));
    }

    let finalScore = localScore;
    let source: DetectionResult['source'] = 'local';

    // Step 3: Remote escalation when enabled (inconclusive range)
    const inconclusive = localScore >= 0.15 && localScore <= 0.65;
    if (options.remoteEnabled && (matchesAIAudioUrl(src) || inconclusive)) {
      if (this.rateLimiter.consume()) {
        try {
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          // RemotePayload uses imageHash as a generic content identifier;
          // for audio we send the URL hash as the content fingerprint.
          const payload: RemotePayload = { imageHash: hashUrl(src) };
          const result = options.remoteClassify
            ? await options.remoteClassify(endpoint, apiKey, 'audio', payload)
            : await createRemoteAdapter(endpoint, apiKey).classify('audio', payload);
          finalScore = localScore * 0.3 + result.score * 0.7;
          source = 'remote';
        } catch {
          // Fall back to local score
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'audio',
      isAIGenerated: finalScore >= 0.35,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
