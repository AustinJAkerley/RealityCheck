import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
import { DetectionCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { hashUrl, hashDataUrl } from '../utils/hash.js';
import { createRemoteAdapter } from '../adapters/remote-adapter.js';
// ── Pre-filter constants ─────────────────────────────────────────────────────
/** Pre-filter canvas resolution. Small enough to be fast, large enough for analysis. */
const PREFILTER_SIZE = 64;
/**
 * Threshold below which an image is considered NOT photorealistic.
 * Kept deliberately low (0.20) to minimise false negatives —
 * we prefer to analyse too many images rather than miss real AI photos.
 */
const PHOTOREALISM_SKIP_THRESHOLD = 0.20;
/**
 * Set to true when an ONNX / TF.js model is bundled with the extension.
 * Until then, High tier falls back to Medium-tier canvas analysis.
 */
const HIGH_TIER_ML_AVAILABLE = false;
// ── Pre-filter helper functions ──────────────────────────────────────────────
/**
 * Count unique quantized colors in RGBA pixel data.
 * Quantizes each channel to 5 bits (32 levels) to reduce noise sensitivity.
 */
export function countUniqueColors(data) {
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) {
        const r = (data[i] >> 3) & 0x1f;
        const g = (data[i + 1] >> 3) & 0x1f;
        const b = (data[i + 2] >> 3) & 0x1f;
        seen.add((r << 10) | (g << 5) | b);
    }
    return seen.size;
}
/**
 * Compute Shannon entropy of a single color channel (8-bit → 32 bins).
 * High entropy ≈ photorealistic; low entropy ≈ flat/cartoon.
 * Returns a value in [0, log2(32)] ≈ [0, 5].
 */
export function computeChannelEntropy(data, channelOffset) {
    const histogram = new Int32Array(32);
    const pixelCount = data.length / 4;
    for (let i = channelOffset; i < data.length; i += 4) {
        histogram[data[i] >> 3]++;
    }
    let entropy = 0;
    for (const count of histogram) {
        if (count > 0) {
            const p = count / pixelCount;
            entropy -= p * Math.log2(p);
        }
    }
    return entropy;
}
/**
 * Compute luminance-based gradient complexity using a simple first-order
 * finite difference (fast approximation of Sobel magnitude).
 * Returns the mean gradient magnitude (0–255 scale).
 * High variance / moderate mean ≈ photorealistic;
 * very low mean (flat) or very high uniform mean (vector art) ≈ non-photo.
 */
export function computeEdgeComplexity(data, width, height) {
    let total = 0;
    const n = (width - 1) * (height - 1);
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const i = (y * width + x) * 4;
            const r = (y * width + x + 1) * 4;
            const d = ((y + 1) * width + x) * 4;
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const lumR = (data[r] + data[r + 1] + data[r + 2]) / 3;
            const lumD = (data[d] + data[d + 1] + data[d + 2]) / 3;
            const gx = lumR - lum;
            const gy = lumD - lum;
            total += Math.sqrt(gx * gx + gy * gy);
        }
    }
    return total / n;
}
/**
 * Compute mean variance within small 4×4 pixel blocks (luminance).
 * High block variance ≈ photographic texture/noise.
 * Low block variance ≈ flat cartoon/illustration regions.
 */
export function computeBlockVariance(data, width, height) {
    let totalVar = 0;
    let blockCount = 0;
    for (let by = 0; by < height; by += 4) {
        for (let bx = 0; bx < width; bx += 4) {
            const lums = [];
            for (let dy = 0; dy < 4 && by + dy < height; dy++) {
                for (let dx = 0; dx < 4 && bx + dx < width; dx++) {
                    const i = ((by + dy) * width + (bx + dx)) * 4;
                    lums.push((data[i] + data[i + 1] + data[i + 2]) / 3);
                }
            }
            if (lums.length === 0)
                continue;
            const m = lums.reduce((a, b) => a + b, 0) / lums.length;
            const v = lums.reduce((a, b) => a + (b - m) ** 2, 0) / lums.length;
            totalVar += v;
            blockCount++;
        }
    }
    return blockCount > 0 ? totalVar / blockCount : 0;
}
/**
 * Compute the variance of HSV saturation values across all pixels.
 * Cartoons/illustrations tend to have high mean saturation and low variance
 * (bright flat regions). Photos have varied, lower saturation overall.
 */
export function computeSaturationVariance(data) {
    const sats = [];
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const delta = max - Math.min(r, g, b);
        sats.push(max === 0 ? 0 : delta / max);
    }
    const mean = sats.reduce((a, b) => a + b, 0) / sats.length;
    return sats.reduce((a, b) => a + (b - mean) ** 2, 0) / sats.length;
}
// ── Pre-filter scoring ───────────────────────────────────────────────────────
/**
 * Score the image data for photorealism using Low-tier heuristics.
 * Returns a value in [0, 1]; higher = more photorealistic.
 */
export function scoreLowTier(data) {
    const uniqueColors = countUniqueColors(data);
    const rEntropy = computeChannelEntropy(data, 0);
    const gEntropy = computeChannelEntropy(data, 1);
    const bEntropy = computeChannelEntropy(data, 2);
    const entropy = (rEntropy + gEntropy + bEntropy) / 3;
    const edgeComplexity = computeEdgeComplexity(data, PREFILTER_SIZE, PREFILTER_SIZE);
    // Unique colors: < 50 → 0, > 400 → 1
    const colorScore = Math.min(1, Math.max(0, (uniqueColors - 50) / 350));
    // Entropy: < 2 bits → 0, > 4.5 bits → 1
    const entropyScore = Math.min(1, Math.max(0, (entropy - 2) / 2.5));
    // Edge complexity: < 3 → 0, > 20 → 1
    const edgeScore = Math.min(1, Math.max(0, (edgeComplexity - 3) / 17));
    return colorScore * 0.4 + entropyScore * 0.4 + edgeScore * 0.2;
}
/**
 * Score the image data for photorealism using Medium-tier heuristics.
 * Extends Low tier with block variance and saturation distribution.
 */
export function scoreMediumTier(data) {
    const baseScore = scoreLowTier(data);
    const blockVar = computeBlockVariance(data, PREFILTER_SIZE, PREFILTER_SIZE);
    const satVar = computeSaturationVariance(data);
    // Block variance: < 20 → 0, > 200 → 1 (photos have texture noise)
    const noiseScore = Math.min(1, Math.max(0, (blockVar - 20) / 180));
    // Saturation variance: < 0.03 → 0 (flat cartoon), > 0.06 → 1 (photo variety)
    const satScore = Math.min(1, Math.max(0, (satVar - 0.03) / 0.03));
    // Blend: give medium-tier signals a 30% weight on top of the 70% base
    return baseScore * 0.7 + noiseScore * 0.15 + satScore * 0.15;
}
/**
 * Score using High-tier analysis.
 * Currently falls back to Medium-tier canvas analysis because no ML model is bundled.
 * When a bundled ML model becomes available (HIGH_TIER_ML_AVAILABLE = true):
 * 1. Bundle a TensorFlow.js / ONNX Runtime Web compatible model with the extension.
 * 2. Load it at startup and expose a `runMLModel(data: ImageData): Promise<number>` function.
 * 3. Set HIGH_TIER_ML_AVAILABLE = true and implement the async call below.
 */
async function scoreHighTier(data) {
    if (HIGH_TIER_ML_AVAILABLE) {
        // TODO: call the bundled ML model here.
        // const mlScore = await runMLModel(data);
        // return scoreMediumTier(data) * 0.3 + mlScore * 0.7;
    }
    // Fall back to Medium tier until a model is bundled
    return scoreMediumTier(data);
}
// ── Public pre-filter API ────────────────────────────────────────────────────
/**
 * Draw an HTMLImageElement into a small canvas and return the pixel data.
 * Returns null if the image is cross-origin or the canvas context is unavailable.
 */
function extractPixelData(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = PREFILTER_SIZE;
        canvas.height = PREFILTER_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return null;
        ctx.drawImage(img, 0, 0, PREFILTER_SIZE, PREFILTER_SIZE);
        return ctx.getImageData(0, 0, PREFILTER_SIZE, PREFILTER_SIZE).data;
    }
    catch {
        return null;
    }
}
/**
 * Run the photorealism pre-filter on raw RGBA pixel data (for testing, provide mock data).
 * When `data` is null (canvas unavailable / cross-origin), the image is treated as
 * potentially photorealistic (we don't skip it — conservative default).
 */
export async function runPhotorealismPreFilter(data, quality = 'medium') {
    if (data === null) {
        // Cannot analyse — treat as photorealistic to avoid missing real detections
        return { isPhotorealistic: true, score: 0.5 };
    }
    let score;
    if (quality === 'high') {
        score = await scoreHighTier(data);
    }
    else if (quality === 'medium') {
        score = scoreMediumTier(data);
    }
    else {
        score = scoreLowTier(data);
    }
    return {
        isPhotorealistic: score >= PHOTOREALISM_SKIP_THRESHOLD,
        score,
    };
}
// ── AI-generation local heuristics ──────────────────────────────────────────
/** Known AI image hosting patterns */
const AI_CDN_PATTERNS = [
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
function matchesAICDN(src) {
    return AI_CDN_PATTERNS.some((r) => r.test(src));
}
const AI_ASPECT_RATIOS = [
    [1, 1],
    [4, 3],
    [3, 4],
    [16, 9],
    [9, 16],
    [3, 2],
    [2, 3],
];
function isLikelyAIAspectRatio(w, h) {
    if (w === 0 || h === 0)
        return false;
    const ratio = w / h;
    return AI_ASPECT_RATIOS.some(([rw, rh]) => Math.abs(ratio - rw / rh) < 0.02);
}
function isPowerOfTwo(n) {
    return n > 0 && (n & (n - 1)) === 0;
}
function isLikelyAIDimension(w, h) {
    return isPowerOfTwo(w) && isPowerOfTwo(h);
}
/**
 * Returns 0–1 local AI-generation score based on URL patterns and dimensions.
 */
export function computeLocalImageScore(src, naturalWidth, naturalHeight) {
    let score = 0;
    if (matchesAICDN(src))
        score += 0.7;
    if (isLikelyAIDimension(naturalWidth, naturalHeight))
        score += 0.2;
    else if (isLikelyAIAspectRatio(naturalWidth, naturalHeight))
        score += 0.1;
    if (naturalWidth > 0 && naturalWidth % 64 === 0 && naturalHeight % 64 === 0) {
        score += 0.1;
    }
    return Math.min(1, score);
}
function scoreToConfidence(score) {
    if (score >= 0.65)
        return 'high';
    if (score >= 0.35)
        return 'medium';
    return 'low';
}
/**
 * Downscale an HTMLImageElement for remote transmission.
 */
function downscaleImage(img, maxDim = 128) {
    try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return null;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
    }
    catch {
        return null;
    }
}
// ── Detector class ───────────────────────────────────────────────────────────
export class ImageDetector {
    constructor() {
        this.contentType = 'image';
        this.cache = new DetectionCache();
        this.rateLimiter = new RateLimiter(10, 60000);
    }
    async detect(content, options) {
        const img = content instanceof HTMLImageElement ? content : null;
        const src = img?.src ?? (typeof content === 'string' ? content : '');
        const cacheKey = hashUrl(src);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        // ── Step 1: Photorealism pre-filter ───────────────────────────────────────
        // Only runs on actual HTMLImageElement instances; string URLs skip the canvas step.
        const pixelData = img ? extractPixelData(img) : null;
        const quality = options.detectionQuality ?? 'medium';
        const preFilter = await runPhotorealismPreFilter(pixelData, quality);
        if (!preFilter.isPhotorealistic) {
            // Not photorealistic — skip AI detection entirely
            const skipped = {
                contentType: 'image',
                isAIGenerated: false,
                confidence: 'low',
                score: 0,
                source: 'local',
                skippedByPreFilter: true,
                details: `Pre-filter score ${preFilter.score.toFixed(2)} below threshold — not photorealistic`,
            };
            this.cache.set(cacheKey, skipped);
            return skipped;
        }
        // ── Step 2: Local AI-generation heuristics ────────────────────────────────
        const nw = img?.naturalWidth ?? 0;
        const nh = img?.naturalHeight ?? 0;
        const localScore = computeLocalImageScore(src, nw, nh);
        let finalScore = localScore;
        let source = 'local';
        // ── Step 3: Remote classification ─────────────────────────────────────────
        // Always send to remote when enabled and the image passed the pre-filter.
        if (options.remoteEnabled && img) {
            if (this.rateLimiter.consume()) {
                try {
                    const dataUrl = downscaleImage(img);
                    const imageHash = hashDataUrl(dataUrl ?? src);
                    const endpoint = options.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT;
                    const adapter = createRemoteAdapter(endpoint);
                    const result = await adapter.classify('image', {
                        imageHash,
                        imageDataUrl: dataUrl ?? undefined,
                    });
                    finalScore = localScore * 0.3 + result.score * 0.7;
                    source = 'remote';
                }
                catch {
                    // Remote call failed — fall back to local score
                }
            }
        }
        const result = {
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
//# sourceMappingURL=image-detector.js.map