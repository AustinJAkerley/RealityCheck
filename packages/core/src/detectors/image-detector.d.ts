/**
 * Image detector — photorealism pre-filter + local heuristics + optional remote classifier.
 *
 * Pipeline:
 * 1. Photorealism pre-filter (tier-dependent canvas analysis).
 *    - If the image is NOT photorealistic (icon, cartoon, text graphic), skip entirely.
 *    - If it IS photorealistic (or uncertain), continue to step 2.
 * 2. Local heuristics: CDN URL patterns, power-of-two dimensions, AI aspect ratios.
 * 3. If remoteEnabled: send to the hosted classifier (DEFAULT_REMOTE_ENDPOINT).
 *    Remote result is blended with local score (70% remote, 30% local).
 *
 * Pre-filter tiers:
 *   low:    Color histogram entropy + unique color count (canvas 64×64, ~zero cost)
 *   medium: Low + block noise/texture variance + saturation distribution
 *   high:   Medium + bundled ML model (stub — see HIGH_TIER_ML_AVAILABLE below)
 *
 * Known limitations: local heuristics have low accuracy for novel AI models.
 * See docs/architecture.md for details.
 */
import { DetectionResult, DetectionQuality, DetectorOptions, PhotorealismResult } from '../types.js';
import { Detector } from '../types.js';
/**
 * Count unique quantized colors in RGBA pixel data.
 * Quantizes each channel to 5 bits (32 levels) to reduce noise sensitivity.
 */
export declare function countUniqueColors(data: Uint8ClampedArray): number;
/**
 * Compute Shannon entropy of a single color channel (8-bit → 32 bins).
 * High entropy ≈ photorealistic; low entropy ≈ flat/cartoon.
 * Returns a value in [0, log2(32)] ≈ [0, 5].
 */
export declare function computeChannelEntropy(data: Uint8ClampedArray, channelOffset: number): number;
/**
 * Compute luminance-based gradient complexity using a simple first-order
 * finite difference (fast approximation of Sobel magnitude).
 * Returns the mean gradient magnitude (0–255 scale).
 * High variance / moderate mean ≈ photorealistic;
 * very low mean (flat) or very high uniform mean (vector art) ≈ non-photo.
 */
export declare function computeEdgeComplexity(data: Uint8ClampedArray, width: number, height: number): number;
/**
 * Compute mean variance within small 4×4 pixel blocks (luminance).
 * High block variance ≈ photographic texture/noise.
 * Low block variance ≈ flat cartoon/illustration regions.
 */
export declare function computeBlockVariance(data: Uint8ClampedArray, width: number, height: number): number;
/**
 * Compute the variance of HSV saturation values across all pixels.
 * Cartoons/illustrations tend to have high mean saturation and low variance
 * (bright flat regions). Photos have varied, lower saturation overall.
 */
export declare function computeSaturationVariance(data: Uint8ClampedArray): number;
/**
 * Score the image data for photorealism using Low-tier heuristics.
 * Returns a value in [0, 1]; higher = more photorealistic.
 */
export declare function scoreLowTier(data: Uint8ClampedArray): number;
/**
 * Score the image data for photorealism using Medium-tier heuristics.
 * Extends Low tier with block variance and saturation distribution.
 */
export declare function scoreMediumTier(data: Uint8ClampedArray): number;
/**
 * Run the photorealism pre-filter on raw RGBA pixel data (for testing, provide mock data).
 * When `data` is null (canvas unavailable / cross-origin), the image is treated as
 * potentially photorealistic (we don't skip it — conservative default).
 */
export declare function runPhotorealismPreFilter(data: Uint8ClampedArray | null, quality?: DetectionQuality): Promise<PhotorealismResult>;
/**
 * Returns 0–1 local AI-generation score based on URL patterns and dimensions.
 */
export declare function computeLocalImageScore(src: string, naturalWidth: number, naturalHeight: number): number;
export declare class ImageDetector implements Detector {
    readonly contentType: "image";
    private readonly cache;
    private readonly rateLimiter;
    detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult>;
}
//# sourceMappingURL=image-detector.d.ts.map