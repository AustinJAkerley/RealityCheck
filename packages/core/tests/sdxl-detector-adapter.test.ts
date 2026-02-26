import {
  createSdxlDetectorRunner,
  registerSdxlDetector,
  SDXL_MODEL_ID,
} from '../src/adapters/sdxl-detector-adapter';
import { isMlModelAvailable } from '../src/detectors/image-detector';

const pixels = new Uint8ClampedArray([220, 120, 60, 255, 210, 110, 50, 255]);

/** Returns a classifier stub that always resolves with the given labels. */
function mockClassifier(labels: Array<{ label: string; score: number }>) {
  return jest.fn().mockResolvedValue(labels);
}

/** Returns a classifier stub that always rejects with an error. */
function failingClassifier() {
  return jest.fn().mockRejectedValue(new Error('classifier error'));
}

describe('SDXL Detector adapter — local inference', () => {
  test('extracts artificial score from classifier output', async () => {
    const classify = mockClassifier([
      { label: 'artificial', score: 0.8 },
      { label: 'real', score: 0.2 },
    ]);
    const runner = createSdxlDetectorRunner({ classifier: classify });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeCloseTo(0.8, 5);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  test('returns 0.95 for high AI confidence (calibration ≥ 0.9)', async () => {
    const runner = createSdxlDetectorRunner({
      classifier: mockClassifier([{ label: 'artificial', score: 0.91 }]),
    });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.95);
  });

  test('returns 0.05 for strong non-AI confidence (calibration ≤ 0.1)', async () => {
    const runner = createSdxlDetectorRunner({
      classifier: mockClassifier([{ label: 'artificial', score: 0.08 }]),
    });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.05);
  });

  test('returns 0.5 when artificial label is absent from results', async () => {
    const runner = createSdxlDetectorRunner({
      classifier: mockClassifier([{ label: 'real', score: 0.95 }]),
    });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('returns 0.5 when the classifier throws', async () => {
    const runner = createSdxlDetectorRunner({ classifier: failingClassifier() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('score is always in [0, 1]', async () => {
    const runner = createSdxlDetectorRunner({
      classifier: mockClassifier([{ label: 'artificial', score: 0.55 }]),
    });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('passes pixel data to the classifier', async () => {
    const classify = mockClassifier([{ label: 'artificial', score: 0.6 }]);
    const runner = createSdxlDetectorRunner({ classifier: classify });
    await runner.run(pixels, 2, 1);

    const arg = classify.mock.calls[0][0] as { data: Uint8ClampedArray; width: number; height: number };
    expect(arg.data).toBe(pixels);
    expect(arg.width).toBe(2);
    expect(arg.height).toBe(1);
  });

  test('uses Organika/sdxl-detector as the default model ID', () => {
    expect(SDXL_MODEL_ID).toBe('Organika/sdxl-detector');
  });
});

describe('registerSdxlDetector', () => {
  test('registers a model runner so isMlModelAvailable() returns true', () => {
    registerSdxlDetector({
      classifier: mockClassifier([{ label: 'artificial', score: 0.5 }]),
    });
    expect(isMlModelAvailable()).toBe(true);
  });
});
