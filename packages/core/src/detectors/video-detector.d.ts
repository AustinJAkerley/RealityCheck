/**
 * Video detector — URL heuristics + frame sampling + remote escalation.
 *
 * Flow:
 * 1. Check URL against known AI video platform patterns.
 * 2. Attempt canvas frame capture (same-origin only).
 * 3. If remoteEnabled: send frame to remote classifier and blend with URL score.
 *    If no frame was captured and the URL score is 0, only escalate to remote
 *    when the result is inconclusive locally.
 *
 * Frame-level deep-fake detection requires a dedicated model (e.g. FaceForensics++
 * based classifiers). In local-only mode we fall back to URL heuristics only.
 *
 * Known limitations:
 * - Canvas frame capture is blocked for cross-origin videos (CORS taint).
 * - Frame sampling cannot reliably detect all deepfakes.
 */
import { DetectionResult, Detector, DetectorOptions } from '../types.js';
export declare class VideoDetector implements Detector {
    readonly contentType: "video";
    private readonly cache;
    private readonly rateLimiter;
    detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult>;
}
//# sourceMappingURL=video-detector.d.ts.map