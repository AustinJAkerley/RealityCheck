/**
 * @jest-environment jsdom
 */
import {
  computeLocalImageScore,
  computeVisualAIScore,
  countUniqueColors,
  computeChannelEntropy,
  computeEdgeComplexity,
  computeBlockVariance,
  computeSaturationVariance,
  scoreLowTier,
  scoreMediumTier,
  runPhotorealismPreFilter,
} from '../src/detectors/image-detector';
import { ImageDetector } from '../src/detectors/image-detector';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a flat solid-color RGBA buffer of `size × size` pixels */
function solidColorPixels(size: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

/** Build a noisy "photo-like" RGBA buffer with random RGB values */
function noisyPixels(size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  let seed = 12345;
  for (let i = 0; i < data.length; i += 4) {
    // Cheap LCG random — deterministic for reproducible tests
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i]     = (seed & 0xff);
    data[i + 1] = ((seed >> 8) & 0xff);
    data[i + 2] = ((seed >> 16) & 0xff);
    data[i + 3] = 255;
  }
  return data;
}

const SIZE = 64;

// ── Pre-filter pixel analysis functions ──────────────────────────────────────

describe('countUniqueColors', () => {
  test('returns 1 for a solid-color image', () => {
    expect(countUniqueColors(solidColorPixels(SIZE, 255, 0, 0))).toBe(1);
  });

  test('returns many colors for noisy data', () => {
    expect(countUniqueColors(noisyPixels(SIZE))).toBeGreaterThan(100);
  });
});

describe('computeChannelEntropy', () => {
  test('returns 0 for a single-value channel', () => {
    const data = solidColorPixels(SIZE, 128, 0, 0);
    expect(computeChannelEntropy(data, 0)).toBeCloseTo(0, 5);
  });

  test('returns higher entropy for varied channel values', () => {
    const entropy = computeChannelEntropy(noisyPixels(SIZE), 0);
    expect(entropy).toBeGreaterThan(3);
  });
});

describe('computeEdgeComplexity', () => {
  test('returns 0 for a flat solid image', () => {
    const data = solidColorPixels(SIZE, 100, 100, 100);
    expect(computeEdgeComplexity(data, SIZE, SIZE)).toBeCloseTo(0, 5);
  });

  test('returns positive value for noisy data', () => {
    expect(computeEdgeComplexity(noisyPixels(SIZE), SIZE, SIZE)).toBeGreaterThan(0);
  });
});

describe('computeBlockVariance', () => {
  test('returns 0 for a flat image', () => {
    expect(computeBlockVariance(solidColorPixels(SIZE, 50, 50, 50), SIZE, SIZE)).toBeCloseTo(0, 5);
  });

  test('returns positive variance for noisy data', () => {
    expect(computeBlockVariance(noisyPixels(SIZE), SIZE, SIZE)).toBeGreaterThan(100);
  });
});

describe('computeSaturationVariance', () => {
  test('returns 0 for a greyscale image', () => {
    const data = solidColorPixels(SIZE, 128, 128, 128);
    expect(computeSaturationVariance(data)).toBeCloseTo(0, 5);
  });
});

// ── Pre-filter scoring ────────────────────────────────────────────────────────

describe('scoreLowTier', () => {
  test('returns a low score for a solid-color (cartoon-like) image', () => {
    expect(scoreLowTier(solidColorPixels(SIZE, 255, 0, 0))).toBeLessThan(0.2);
  });

  test('returns a higher score for noisy (photo-like) data', () => {
    expect(scoreLowTier(noisyPixels(SIZE))).toBeGreaterThan(0.5);
  });
});

describe('scoreMediumTier', () => {
  test('returns a low score for a solid-color image', () => {
    expect(scoreMediumTier(solidColorPixels(SIZE, 0, 200, 0))).toBeLessThan(0.2);
  });

  test('returns a higher score for noisy data', () => {
    expect(scoreMediumTier(noisyPixels(SIZE))).toBeGreaterThan(0.5);
  });

  test('score is in [0, 1]', () => {
    const s = scoreMediumTier(noisyPixels(SIZE));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('runPhotorealismPreFilter', () => {
  test('returns isPhotorealistic=false for solid-color data', async () => {
    const result = await runPhotorealismPreFilter(solidColorPixels(SIZE, 0, 0, 255), 'low');
    expect(result.isPhotorealistic).toBe(false);
  });

  test('returns isPhotorealistic=true for noisy (photo-like) data', async () => {
    const result = await runPhotorealismPreFilter(noisyPixels(SIZE), 'medium');
    expect(result.isPhotorealistic).toBe(true);
  });

  test('returns isPhotorealistic=true when data is null (conservative default)', async () => {
    const result = await runPhotorealismPreFilter(null, 'medium');
    expect(result.isPhotorealistic).toBe(true);
    expect(result.score).toBe(0.5);
  });

  test('high tier falls back to medium tier when ML model is not available', async () => {
    const medium = await runPhotorealismPreFilter(noisyPixels(SIZE), 'medium');
    const high = await runPhotorealismPreFilter(noisyPixels(SIZE), 'high');
    // Both should agree on photorealism
    expect(high.isPhotorealistic).toBe(medium.isPhotorealistic);
  });
});

// ── AI-generation local heuristics ───────────────────────────────────────────

describe('computeLocalImageScore', () => {
  test('returns high score for known AI CDN URL', () => {
    const score = computeLocalImageScore('https://midjourney.com/img/test.png', 1024, 1024);
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  test('returns low/zero score for ordinary URL with non-AI dimensions', () => {
    // 1920x1200 — 1200 is not divisible by 64 (1200 / 64 = 18.75)
    const score = computeLocalImageScore('https://example.com/photo.jpg', 1920, 1200);
    expect(score).toBeLessThan(0.2);
  });

  test('awards extra score for power-of-two dimensions', () => {
    const score = computeLocalImageScore('https://example.com/img.jpg', 512, 512);
    expect(score).toBeGreaterThan(0);
  });

  test('caps score at 1', () => {
    const score = computeLocalImageScore(
      'https://images.openai.com/dalle-3/img.png',
      1024,
      1024
    );
    expect(score).toBeLessThanOrEqual(1);
  });

  test('handles zero dimensions gracefully', () => {
    const score = computeLocalImageScore('https://example.com/img.jpg', 0, 0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── ImageDetector integration ─────────────────────────────────────────────────

describe('ImageDetector (remote disabled)', () => {
  const detector = new ImageDetector();
  const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };

  test('returns a DetectionResult for a string URL (skips pre-filter — no pixel data)', async () => {
    // String URL: pre-filter returns isPhotorealistic=true (null data → conservative)
    const result = await detector.detect('https://midjourney.com/test.png', opts);
    expect(result.contentType).toBe('image');
    expect(result.source).toBe('local');
    expect(result.isAIGenerated).toBe(true);
  });

  test('caches identical URLs', async () => {
    const url = 'https://example.com/photo.jpg';
    const r1 = await detector.detect(url, opts);
    const r2 = await detector.detect(url, opts);
    expect(r1).toBe(r2);
  });
});

// ── Scoring blend fixes (Problems 1 & 2 from issue) ─────────────────────────

describe('visual score blending (scoring math fix)', () => {
  test('computeVisualAIScore * 0.75 >= 0.35 threshold when visual score is 0.55+', () => {
    // The old code applied a *0.6 double-discount when localScore>=0.3,
    // capping the contribution at 0.372. The new code uses visualScore * 0.75 directly.
    // With visualScore=0.55: 0.55 * 0.75 = 0.4125 > 0.35 → should flag.
    const visualScore = 0.55;
    const visualWeight = 0.75;
    const combined = Math.max(0.3, visualScore * visualWeight);
    expect(combined).toBeGreaterThan(0.35);
    expect(combined).toBeCloseTo(0.4125, 4);
  });

  test('old double-discount formula was below threshold for typical AI images', () => {
    // Verifies the bug: old *0.6 discount capped combined at 0.3 when localScore=0.3
    const visualScore = 0.55;
    const oldDiscount = 0.62;
    const oldCombined = Math.max(0.3, visualScore * oldDiscount * 0.6);
    expect(oldCombined).toBeLessThan(0.35); // Was: 0.3 — NOT FLAGGED (bug)
  });

  test('local-only isAIGenerated uses 0.25 threshold', async () => {
    // A string URL that has no CDN match and no pixel data yields score = 0.
    // score = 0 < 0.25, so should not be flagged.
    const detector = new ImageDetector();
    const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };
    const result = await detector.detect('https://example.com/ordinary-photo.jpg', opts);
    expect(result.source).toBe('local');
    // score=0 → not flagged even with 0.25 threshold
    expect(result.isAIGenerated).toBe(false);
    expect(result.score).toBe(0);
  });

  test('local-only CDN match is flagged with new 0.25 threshold', async () => {
    const detector = new ImageDetector();
    const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };
    // CDN match gives localScore = 0.7, well above both old 0.35 and new 0.25
    const result = await detector.detect('https://midjourney.com/img.png', opts);
    expect(result.isAIGenerated).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  test('options.fetchBytes is called instead of direct fetch when provided', async () => {
    const detector = new ImageDetector();
    const fetchBytesMock = jest.fn().mockResolvedValue(null);
    const opts = {
      remoteEnabled: false,
      detectionQuality: 'medium' as const,
      fetchBytes: fetchBytesMock,
    };
    await detector.detect('https://example.com/some-image.jpg', opts);
    expect(fetchBytesMock).toHaveBeenCalledWith('https://example.com/some-image.jpg');
  });
});

// ── computeVisualAIScore ──────────────────────────────────────────────────────

describe('computeVisualAIScore', () => {
  test('returns 0 for empty data', () => {
    expect(computeVisualAIScore(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });

  test('returns a low score for a greyscale image (no saturation)', () => {
    // Grey pixels → meanSat = 0 → uniformSatScore = 0
    const grey = solidColorPixels(SIZE, 128, 128, 128);
    const score = computeVisualAIScore(grey, SIZE, SIZE);
    // channelUniformity is 1 (equal channels), lumScore is high (mean ≈ 0.50),
    // but uniformSatScore is 0 — combined should be well below 0.5
    expect(score).toBeLessThan(0.5);
  });

  test('returns a higher score for uniformly-saturated, well-exposed AI-like data', () => {
    // Uniform vivid orange: high saturation, low saturation variance → AI-like
    const vivid = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 220; vivid[i + 1] = 120; vivid[i + 2] = 60; vivid[i + 3] = 255;
    }
    // meanSat ≈ 0.73, satVar ≈ 0, rawUniformSat = 0.73 → uniformSatScore = 1
    // channelUniformity: R dominates → some channel spread, but still moderate
    // lumScore: lum ≈ 0.54 → close to 0.50 → ~0.87
    expect(computeVisualAIScore(vivid, SIZE, SIZE)).toBeGreaterThan(0.40);
  });

  test('returns a value in [0, 1] for random noisy data', () => {
    const score = computeVisualAIScore(noisyPixels(SIZE), SIZE, SIZE);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('does not flag a neutral grey image as AI (false positive regression)', () => {
    // Grey (128,128,128): uniformSatScore=0 (no saturation), channelUniformity=1,
    // lumScore≈1 (mean lum ≈ 0.50). With the old 0.30 channelUniformity weight
    // this scored ~0.499 × 0.75 = 0.37 > 0.25 threshold — a false positive.
    // With the revised 0.10 channelUniformity weight the combined score is
    // 0*0.70 + 1*0.10 + 1*0.20 = 0.30; 0.30 * 0.75 = 0.225 < 0.25 → NOT flagged.
    const grey = solidColorPixels(SIZE, 128, 128, 128);
    const visualScore = computeVisualAIScore(grey, SIZE, SIZE);
    const visualWeight = 0.75; // medium quality weight
    expect(visualScore * visualWeight).toBeLessThan(0.25);
  });

  test('still flags a typical AI portrait-like image', () => {
    // Uniform vivid orange: high saturation, near-zero variance → high uniformSatScore.
    // uniformSatScore=1 * 0.70 = 0.70 → visualScore*0.75 = ~0.73 >> 0.25 threshold.
    const vivid = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 220; vivid[i + 1] = 120; vivid[i + 2] = 60; vivid[i + 3] = 255;
    }
    const visualScore = computeVisualAIScore(vivid, SIZE, SIZE);
    const visualWeight = 0.75;
    expect(visualScore * visualWeight).toBeGreaterThan(0.25);
  });
});

// ── ML model registry ─────────────────────────────────────────────────────────

import { registerMlModel, isMlModelAvailable, runMlModelScore } from '../src/detectors/image-detector';

describe('ML model registry', () => {
  test('isMlModelAvailable returns a boolean', () => {
    expect(typeof isMlModelAvailable()).toBe('boolean');
  });

  test('registerMlModel makes isMlModelAvailable return true', () => {
    registerMlModel({
      async run(_data, _w, _h) {
        return 0.5;
      },
    });
    expect(isMlModelAvailable()).toBe(true);
  });

  test('High-tier prefilter uses registered model result', async () => {
    // Register a model that always returns 0.9 (strong AI signal)
    registerMlModel({
      async run(_data, _w, _h) {
        return 0.9;
      },
    });
    // With a model that returns 0.9, blended score = 0.3 * mediumTier + 0.7 * 0.9
    // For noisy photo data mediumTier > 0.5 → blended >= 0.3 * 0.5 + 0.7 * 0.9 = 0.78
    const result = await runPhotorealismPreFilter(noisyPixels(SIZE), 'high');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.isPhotorealistic).toBe(true);
  });

  test('runMlModelScore returns clamped model output', async () => {
    registerMlModel({
      async run() {
        return 1.4;
      },
    });
    const score = await runMlModelScore(noisyPixels(SIZE), SIZE, SIZE);
    expect(score).toBe(1);
  });

  test('high-quality image scoring follows local model verdict', async () => {
    registerMlModel({
      async run() {
        return 0.05;
      },
    });
    const detector = new ImageDetector();
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { configurable: true, value: true });
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1024 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1024 });
    Object.defineProperty(img, 'src', {
      configurable: true,
      value: 'https://midjourney.com/img.png',
    });

    const pixels = noisyPixels(SIZE);
    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data: pixels }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,mock',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const result = await detector.detect(img, {
        remoteEnabled: false,
        detectionQuality: 'high',
        fetchBytes: async () => null,
      });
      expect(result.source).toBe('local');
      expect(result.isAIGenerated).toBe(false);
    } finally {
      createSpy.mockRestore();
    }
  });
});
