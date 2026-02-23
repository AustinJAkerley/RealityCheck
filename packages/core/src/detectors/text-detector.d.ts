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
import { DetectionResult, Detector, DetectorOptions } from '../types.js';
/**
 * Heuristic score — returns a 0–1 value indicating AI likelihood.
 * This is intentionally conservative to reduce false positives.
 */
export declare function computeLocalTextScore(text: string): number;
export declare class TextDetector implements Detector {
    readonly contentType: "text";
    private readonly cache;
    private readonly rateLimiter;
    detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult>;
}
//# sourceMappingURL=text-detector.d.ts.map