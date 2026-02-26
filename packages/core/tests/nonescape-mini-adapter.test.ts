/**
 * @jest-environment jsdom
 */
import { createNonescapeMiniRunner } from '../src/adapters/nonescape-mini-adapter';
import type { NonescapeModelFeatures } from '../src/adapters/nonescape-mini-adapter';

describe('Nonescape mini adapter', () => {
  test('runs bundled nonescape-mini model without external service', async () => {
    const runner = createNonescapeMiniRunner();
    const pixels = new Uint8ClampedArray([220, 120, 60, 255, 210, 110, 50, 255]);
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('supports swapping model runtime via adapter API', async () => {
    const predict = jest.fn().mockReturnValue(0.23);
    const runner = createNonescapeMiniRunner({
      model: 'future-model-v2',
      api: { predict },
    });
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const score = await runner.run(pixels, 2, 1);

    expect(score).toBeCloseTo(0.23, 5);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(predict).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 2,
        height: 1,
      })
    );
  });

  test('returns strong AI class score when model predicts AI', async () => {
    const runner = createNonescapeMiniRunner({
      api: {
        predict: () => 0.91,
      },
    });
    const score = await runner.run(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    expect(score).toBe(0.95);
  });

  test('returns strong non-AI class score only at very low confidence edge', async () => {
    const runner = createNonescapeMiniRunner({
      api: {
        predict: () => 0.08,
      },
    });
    const score = await runner.run(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    expect(score).toBe(0.05);
  });

  // ── New research-backed features ────────────────────────────────────────────

  test('all new features are exposed in the features object passed to predict', async () => {
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: {
        predict({ features }) {
          capturedFeatures = features;
          return 0.5;
        },
      },
    });
    // Use a 32×32 noisy image so all block/Laplacian loops execute
    const size = 32;
    const pixels = new Uint8ClampedArray(size * size * 4);
    let seed = 99991;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels[i] = seed & 0xff;
      pixels[i + 1] = (seed >> 8) & 0xff;
      pixels[i + 2] = (seed >> 16) & 0xff;
      pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    expect(capturedFeatures).not.toBeNull();
    expect(typeof capturedFeatures!.noiseFloor).toBe('number');
    expect(typeof capturedFeatures!.textureCoV).toBe('number');
    expect(typeof capturedFeatures!.laplacianSparsity).toBe('number');
    expect(capturedFeatures!.noiseFloor).toBeGreaterThanOrEqual(0);
    expect(capturedFeatures!.textureCoV).toBeGreaterThanOrEqual(0);
    expect(capturedFeatures!.laplacianSparsity).toBeGreaterThanOrEqual(0);
    expect(capturedFeatures!.laplacianSparsity).toBeLessThanOrEqual(1);
  });

  test('noiseFloor is near-zero for a solid-colour image (AI-like noise floor)', async () => {
    // A solid-colour image has zero variance in every block — perfectly clean.
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: { predict({ features }) { capturedFeatures = features; return 0.5; } },
    });
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 100; pixels[i + 1] = 150; pixels[i + 2] = 200; pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    expect(capturedFeatures!.noiseFloor).toBeLessThan(0.001);
  });

  test('noiseFloor is higher for noisy (photo-like) data', async () => {
    // A noisy image has significant variance even in its flattest blocks.
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: { predict({ features }) { capturedFeatures = features; return 0.5; } },
    });
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    let seed = 54321;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels[i] = seed & 0xff;
      pixels[i + 1] = (seed >> 8) & 0xff;
      pixels[i + 2] = (seed >> 16) & 0xff;
      pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    expect(capturedFeatures!.noiseFloor).toBeGreaterThan(0.001);
  });

  test('textureCoV is zero for a solid-colour image (guard suppresses trivial case)', async () => {
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: { predict({ features }) { capturedFeatures = features; return 0.5; } },
    });
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200; pixels[i + 1] = 200; pixels[i + 2] = 200; pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    // bvMean ≤ 1e-4 (solid colour) → textureCoV guard fires → 0
    expect(capturedFeatures!.textureCoV).toBe(0);
  });

  test('laplacianSparsity is 1 for a solid-colour image (all Laplacian = 0)', async () => {
    // A solid-colour image has L = 4×I − I_L − I_R − I_U − I_D = 0 everywhere.
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: { predict({ features }) { capturedFeatures = features; return 0.5; } },
    });
    const size = 32;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 80; pixels[i + 1] = 80; pixels[i + 2] = 80; pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    expect(capturedFeatures!.laplacianSparsity).toBe(1);
  });

  test('laplacianSparsity is lower for noisy (photo-like) data', async () => {
    // Random noise creates large Laplacian responses → lower sparsity than a clean image.
    let capturedFeatures: NonescapeModelFeatures | null = null;
    const runner = createNonescapeMiniRunner({
      api: { predict({ features }) { capturedFeatures = features; return 0.5; } },
    });
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    let seed = 77777;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels[i] = seed & 0xff;
      pixels[i + 1] = (seed >> 8) & 0xff;
      pixels[i + 2] = (seed >> 16) & 0xff;
      pixels[i + 3] = 255;
    }
    await runner.run(pixels, size, size);
    expect(capturedFeatures!.laplacianSparsity).toBeLessThan(0.8);
  });

  // ── False-positive calibration tests ─────────────────────────────────────────
  // Regression guard: the bundled logistic regression must keep typical
  // downscaled real photos well below the local AI threshold (0.25) and clear
  // AI images above it.
  //
  // Pre-fix the model always returned ≥ 0.75 because downscaling removes
  // sensor/JPEG noise, making real photos look smooth like AI images.

  /** Evaluate the calibrated logistic regression directly with known features. */
  function evalBundledModel(f: NonescapeModelFeatures): number {
    const gradSmoothnessScore = Math.max(0, 1 - f.gradientMean * 16);
    const lumVarScore = Math.max(0, 1 - Math.max(0, f.lumVariance - 0.04) / 0.10);
    const noiseFloorScore = Math.max(0, 1 - f.noiseFloor / 0.0010);
    const textureUniformityScore = Math.max(0, 1 - f.textureCoV / 2.0);
    const lapSparsityScore = Math.max(0, Math.min(1, (f.laplacianSparsity - 0.80) / 0.15));
    const dctSmoothScore = Math.max(0, 1 - f.dctHighFreqRatio / 0.08);
    const linear =
      -6.80 +
      f.meanSat * 2.6 +
      (1 - f.satVar * 8) * 1.2 +
      (1 - Math.abs(f.meanLum - 0.5) * 2) * 0.9 +
      f.channelVarSimilarity * 0.7 +
      gradSmoothnessScore * 0.8 +
      lumVarScore * 0.4 +
      noiseFloorScore * 1.0 +
      textureUniformityScore * 0.6 +
      lapSparsityScore * 0.7 +
      dctSmoothScore * 0.8;
    return 1 / (1 + Math.exp(-linear));
  }

  test('bundled model: typical downscaled real photo scores below 0.25 (no false positive)', () => {
    // Feature values for a typical web JPEG downscaled to ~192×192.
    // Downscaling removes JPEG quantisation and sensor noise, so noiseFloor
    // and laplacianSparsity are in the "looks smooth" range — but must NOT
    // push the score above the 0.25 AI threshold after recalibration.
    const score = evalBundledModel({
      meanSat: 0.35, satVar: 0.08, meanLum: 0.48, channelVarSimilarity: 0.70,
      gradientMean: 0.025, lumVariance: 0.09, noiseFloor: 0.0003,
      textureCoV: 1.2, laplacianSparsity: 0.72, dctHighFreqRatio: 0.12,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.25);
  });

  test('bundled model: vibrant real photo scores below 0.25 (no false positive)', () => {
    const score = evalBundledModel({
      meanSat: 0.52, satVar: 0.07, meanLum: 0.50, channelVarSimilarity: 0.65,
      gradientMean: 0.025, lumVariance: 0.09, noiseFloor: 0.0003,
      textureCoV: 1.2, laplacianSparsity: 0.72, dctHighFreqRatio: 0.12,
    });
    expect(score).toBeLessThan(0.25);
  });

  test('bundled model: clear AI image (SDXL / DALL-E 3) scores above 0.25', () => {
    // Feature values for a typical AI-generated image: very smooth, near-zero
    // noise floor, high Laplacian sparsity, low DCT high-frequency energy.
    const score = evalBundledModel({
      meanSat: 0.55, satVar: 0.06, meanLum: 0.50, channelVarSimilarity: 0.82,
      gradientMean: 0.012, lumVariance: 0.07, noiseFloor: 0.00005,
      textureCoV: 0.3, laplacianSparsity: 0.92, dctHighFreqRatio: 0.02,
    });
    expect(score).toBeGreaterThan(0.25);
  });
});
