/**
 * @jest-environment jsdom
 */
import { createOnnxModelRunner, registerOnnxModel } from '../src/adapters/onnx-model-adapter';
import { isMlModelAvailable } from '../src/detectors/image-detector';
import type { OnnxInferenceSession, OnnxTensorLike } from '../src/adapters/onnx-model-adapter';

// ── helpers ────────────────────────────────────────────────────────────────────

function solidPixels(r: number, g: number, b: number, side = 16): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return buf;
}

function makeSession(aiScore: number): OnnxInferenceSession {
  return {
    async run(): Promise<Record<string, OnnxTensorLike>> {
      return {
        output: { data: [1 - aiScore, aiScore], dims: [1, 2] },
      };
    },
  };
}

// ── ONNX adapter ───────────────────────────────────────────────────────────────

describe('OnnxModelAdapter', () => {
  test('createOnnxModelRunner returns a valid MlModelRunner', () => {
    const runner = createOnnxModelRunner({ session: makeSession(0.9) });
    expect(typeof runner.run).toBe('function');
  });

  test('passes through model output score (aiClassIndex=1 default)', async () => {
    const runner = createOnnxModelRunner({ session: makeSession(0.85) });
    const score = await runner.run(solidPixels(200, 100, 50), 16, 16);
    expect(score).toBeCloseTo(0.85, 5);
  });

  test('respects aiClassIndex=0 for single-output sigmoid layout', async () => {
    const session: OnnxInferenceSession = {
      async run() {
        return { output: { data: [0.72], dims: [1, 1] } };
      },
    };
    const runner = createOnnxModelRunner({ session, aiClassIndex: 0 });
    const score = await runner.run(solidPixels(100, 100, 100), 16, 16);
    expect(score).toBeCloseTo(0.72, 5);
  });

  test('clamps output to [0, 1]', async () => {
    const session: OnnxInferenceSession = {
      async run() {
        return { output: { data: [-0.5, 1.8], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({ session });
    const score = await runner.run(solidPixels(0, 0, 0), 4, 4);
    expect(score).toBe(1);
  });

  test('applies scoreTransform (logit → sigmoid)', async () => {
    const logit = 2.0;
    const expectedSigmoid = 1 / (1 + Math.exp(-logit));
    const session: OnnxInferenceSession = {
      async run() {
        return { output: { data: [-logit, logit], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({
      session,
      scoreTransform: (x: number) => 1 / (1 + Math.exp(-x)),
    });
    const score = await runner.run(solidPixels(128, 128, 128), 8, 8);
    expect(score).toBeCloseTo(expectedSigmoid, 5);
  });

  test('uses custom input/output tensor names', async () => {
    const capturedFeeds: Record<string, OnnxTensorLike>[] = [];
    const session: OnnxInferenceSession = {
      async run(feeds) {
        capturedFeeds.push(feeds);
        return { my_out: { data: [0.3, 0.7], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({
      session,
      inputName: 'my_in',
      outputName: 'my_out',
    });
    await runner.run(solidPixels(50, 100, 150), 16, 16);
    expect(capturedFeeds.length).toBe(1);
    expect(capturedFeeds[0]).toHaveProperty('my_in');
    expect(capturedFeeds[0]).not.toHaveProperty('input');
  });

  test('produces CHW tensor shape [1, 3, H, W] by default', async () => {
    let capturedDims: readonly number[] = [];
    const session: OnnxInferenceSession = {
      async run(feeds) {
        capturedDims = feeds['input'].dims;
        return { output: { data: [0, 1], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({
      session,
      inputWidth: 32,
      inputHeight: 32,
    });
    await runner.run(solidPixels(200, 200, 200, 64), 64, 64);
    expect(capturedDims).toEqual([1, 3, 32, 32]);
  });

  test('produces HWC tensor shape [1, H, W, 3] when layout=HWC', async () => {
    let capturedDims: readonly number[] = [];
    const session: OnnxInferenceSession = {
      async run(feeds) {
        capturedDims = feeds['input'].dims;
        return { output: { data: [0, 1], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({
      session,
      inputWidth: 16,
      inputHeight: 16,
      inputLayout: 'HWC',
    });
    await runner.run(solidPixels(10, 20, 30, 16), 16, 16);
    expect(capturedDims).toEqual([1, 16, 16, 3]);
  });

  test('input Float32Array length matches tensor dims product (CHW)', async () => {
    let capturedData: Float32Array | undefined;
    const session: OnnxInferenceSession = {
      async run(feeds) {
        capturedData = feeds['input'].data as Float32Array;
        return { output: { data: [0, 1], dims: [1, 2] } };
      },
    };
    const runner = createOnnxModelRunner({ session, inputWidth: 8, inputHeight: 8 });
    await runner.run(solidPixels(255, 0, 0, 8), 8, 8);
    // 1 × 3 × 8 × 8 = 192
    expect(capturedData?.length).toBe(192);
  });

  test('registerOnnxModel makes isMlModelAvailable() return true', async () => {
    registerOnnxModel({ session: makeSession(0.5) });
    expect(isMlModelAvailable()).toBe(true);
  });
});

// ── dctHighFreqRatio feature ──────────────────────────────────────────────────

import { createNonescapeMiniRunner } from '../src/adapters/nonescape-mini-adapter';
import type { NonescapeModelFeatures } from '../src/adapters/nonescape-mini-adapter';

describe('nonescape-mini dctHighFreqRatio feature', () => {
  function captureFeatures(pixels: Uint8ClampedArray, w: number, h: number): Promise<NonescapeModelFeatures> {
    return new Promise((resolve) => {
      const runner = createNonescapeMiniRunner({
        api: {
          predict({ features }) {
            resolve(features);
            return 0.5;
          },
        },
      });
      runner.run(pixels, w, h);
    });
  }

  test('dctHighFreqRatio is exposed in the features object', async () => {
    const pixels = solidPixels(120, 80, 40, 32);
    const features = await captureFeatures(pixels, 32, 32);
    expect(typeof features.dctHighFreqRatio).toBe('number');
    expect(features.dctHighFreqRatio).toBeGreaterThanOrEqual(0);
    expect(features.dctHighFreqRatio).toBeLessThanOrEqual(1);
  });

  test('dctHighFreqRatio is near-zero for a solid-colour image (no meaningful AC energy)', async () => {
    // A constant block has DC coefficient only; AC coefficients are near-zero
    // due to floating-point rounding → ratio should be essentially 0.
    const pixels = solidPixels(200, 200, 200, 64);
    const features = await captureFeatures(pixels, 64, 64);
    expect(features.dctHighFreqRatio).toBeCloseTo(0, 10);
  });

  test('dctHighFreqRatio is higher for random noise than for a smooth gradient', async () => {
    const side = 64;

    // Smooth horizontal gradient — mostly low-frequency content
    const gradientPixels = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const v = Math.round((x / (side - 1)) * 255);
        const i = (y * side + x) * 4;
        gradientPixels[i] = gradientPixels[i + 1] = gradientPixels[i + 2] = v;
        gradientPixels[i + 3] = 255;
      }
    }

    // Random noise — energy spread across all frequencies, high-freq ratio larger
    // Use a fixed LCG seed for reproducibility across platforms
    let seed = 44444;
    const noisePixels = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < noisePixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = seed & 0xff;
      noisePixels[i] = noisePixels[i + 1] = noisePixels[i + 2] = v;
      noisePixels[i + 3] = 255;
    }

    const gradFeatures  = await captureFeatures(gradientPixels, side, side);
    const noiseFeatures = await captureFeatures(noisePixels, side, side);

    expect(noiseFeatures.dctHighFreqRatio).toBeGreaterThan(gradFeatures.dctHighFreqRatio);
  });

  test('bundled model runs with dctHighFreqRatio included', async () => {
    const runner = createNonescapeMiniRunner();
    const side = 32;
    // Fixed LCG seed for reproducible random pixels
    let seed = 99;
    const pixels = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels[i] = seed & 0xff; pixels[i + 1] = (seed >> 8) & 0xff;
      pixels[i + 2] = (seed >> 16) & 0xff; pixels[i + 3] = 255;
    }
    const score = await runner.run(pixels, side, side);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
