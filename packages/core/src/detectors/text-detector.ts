/**
 * Text detector — local heuristic scoring + remote escalation when inconclusive.
 *
 * Flow:
 * 1. Run local heuristics (burstiness, TTR, filler phrases).
 * 2. If local score is conclusive (< 0.15 clearly human, or > 0.65 clearly AI),
 *    return local result without a remote call.
 * 3. If local score is inconclusive (0.15–0.65) AND remoteEnabled,
 *    escalate to the hosted remote classifier and blend the result.
 *
 * This keeps remote calls to a minimum while still getting the benefit of
 * remote classification for ambiguous cases.
 *
 * These heuristics have known limitations (false positives/negatives).
 * See docs/architecture.md for accuracy discussion and mitigation strategies.
 */
import { DetectionResult, DetectionQuality, Detector, DetectorOptions, RemotePayload } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashText } from '../utils/hash.js';

/** Known AI filler phrases — extend as needed */
const AI_FILLER_PHRASES: RegExp[] = [
  /as an ai language model/i,
  /as an ai assistant/i,
  /i (don'?t|do not) have (personal )?feelings/i,
  /i (don'?t|do not) have (the ability|access) to/i,
  /certainly[,!]?\s+here('s| is)/i,
  /i'?m happy to (help|assist)/i,
  /of course[,!]?\s+here('s| is)/i,
  /it('s| is) worth noting that/i,
  /in (today'?s|the modern) (world|age|era|society)/i,
  /ultimately[,.]?\s+it'?s (important|crucial|essential)/i,
  // Additional AI-generation indicators
  /that'?s (a )?(great|excellent|wonderful|fantastic) (question|point)/i,
  /i would be (happy|glad|delighted) to (help|assist|explain)/i,
  /let me (break this down|walk you through|explain)/i,
  /there are (several|a (few|number of)) (key|important|main) (aspects|factors|points|considerations)/i,
  /it'?s important to (note|understand|recognize|remember) that/i,
  /in (conclusion|summary|closing)[,.]?\s/i,
  /to (summarize|recap|wrap up)[,:]?\s/i,
  /i hope (this|that) (helps|clarifies|answers)/i,
  /please (note|be aware) that/i,
  /it should be noted that/i,
  /moving forward[,.]?\s/i,
  /at the end of the day[,.]?\s/i,
  /when it comes to\b/i,
  /feel free to (ask|reach out|let me know)/i,
  /without further ado[,.]?\s/i,
  /dive (deep|deeper) into\b/i,
  /delve into\b/i,
  /leverage\b.*\b(capabilities|strengths|opportunities)/i,
  /unlock (the full |the )?(potential|power|value)\b/i,
  /game[- ]?changer\b/i,
  /paradigm shift\b/i,
  /here'?s a (comprehensive|detailed|step-by-step) (guide|overview|breakdown)/i,
];

function countFillerPhrases(text: string): number {
  return AI_FILLER_PHRASES.filter((r) => r.test(text)).length;
}

function getSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function typeTokenRatio(text: string): number {
  const tokens = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (tokens.length === 0) return 1;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

/**
 * Heuristic score — returns a 0–1 value indicating AI likelihood.
 * This is intentionally conservative to reduce false positives.
 */
export function computeLocalTextScore(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length < 80) {
    // Too short for reliable detection
    return 0;
  }

  const sentences = getSentences(trimmed);
  if (sentences.length < 3) return 0;

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const sd = stddev(lengths);
  const avgLen = mean(lengths);

  // Low burstiness (uniform sentence length) is characteristic of AI
  const burstinessScore = sd < 3 ? 0.3 : sd < 6 ? 0.15 : 0;

  // Very high average sentence length also suggests AI
  const lengthScore = avgLen > 25 ? 0.15 : 0;

  // Low TTR can indicate repetitive AI vocabulary
  const ttr = typeTokenRatio(trimmed);
  const ttrScore = ttr < 0.45 ? 0.2 : 0;

  // Filler phrases are strong signal
  const fillerCount = countFillerPhrases(trimmed);
  const fillerScore = Math.min(0.4, fillerCount * 0.2);

  const totalScore = burstinessScore + lengthScore + ttrScore + fillerScore;
  return Math.min(1, totalScore);
}

function scoreToConfidence(score: number): DetectionResult['confidence'] {
  if (score >= 0.65) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

/**
 * Local score range in which the result is considered inconclusive —
 * escalate to remote when remoteEnabled.
 */
const INCONCLUSIVE_LOW = 0.15;
const INCONCLUSIVE_HIGH = 0.65;

export class TextDetector implements Detector {
  readonly contentType = 'text' as const;
  private readonly cache = new DetectionCache<DetectionResult>();
  private readonly rateLimiters: Record<DetectionQuality, RateLimiter> = {
    low: new RateLimiter(10, 60_000),
    medium: new RateLimiter(30, 60_000),
    high: new RateLimiter(60, 60_000),
  };

  async detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult> {
    const text = typeof content === 'string' ? content : (content as HTMLElement).innerText ?? '';
    const key = hashText(text);

    const cached = this.cache.get(key);
    if (cached) return cached;

    const localScore = computeLocalTextScore(text);

    let finalScore = localScore;
    let source: DetectionResult['source'] = 'local';

    // Escalate to remote only when the local score is inconclusive
    const inconclusive = localScore >= INCONCLUSIVE_LOW && localScore <= INCONCLUSIVE_HIGH;
    if (options.remoteEnabled && inconclusive) {
      const rl = this.rateLimiters[options.detectionQuality ?? 'medium'];
      if (rl.consume()) {
        try {
          const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
          const apiKey = options.remoteApiKey || '';
          const payload: RemotePayload = { text: text.slice(0, 2000) };
          if (!options.remoteClassify) throw new Error('remoteClassify callback required');
          const result = await options.remoteClassify(endpoint, apiKey, 'text', payload);
          // Blend local + remote scores (weight remote more heavily)
          finalScore = localScore * 0.3 + result.score * 0.7;
          source = 'remote';
        } catch (err) {
          // Remote call failed — return the token so it can be used for other content
          rl.returnToken();
          console.warn('[RealityCheck] Remote text classification failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    const result: DetectionResult = {
      contentType: 'text',
      isAIGenerated: finalScore >= 0.35,
      confidence: scoreToConfidence(finalScore),
      score: finalScore,
      source,
    };

    this.cache.set(key, result);
    return result;
  }
}
