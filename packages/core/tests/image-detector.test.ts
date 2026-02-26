/**
 * @jest-environment jsdom
 */
import { registerMlModel, isMlModelAvailable, runMlModelScore, ImageDetector } from '../src/detectors/image-detector';

const opts = { remoteEnabled: false, detectionQuality: 'high' as const };

// ── ML model registry ─────────────────────────────────────────────────────────

describe('isMlModelAvailable', () => {
  test('returns true after registerMlModel is called', () => {
    registerMlModel({ run: async () => 0.5 });
    expect(isMlModelAvailable()).toBe(true);
  });
});

describe('runMlModelScore', () => {
  test('returns the score from the registered runner', async () => {
    registerMlModel({ run: async () => 0.75 });
    const score = await runMlModelScore(new Uint8ClampedArray(4), 1, 1);
    expect(score).toBeCloseTo(0.75, 5);
  });

  test('clamps score to [0, 1] — above 1', async () => {
    registerMlModel({ run: async () => 1.5 });
    const score = await runMlModelScore(new Uint8ClampedArray(4), 1, 1);
    expect(score).toBe(1);
  });

  test('clamps score to [0, 1] — below 0', async () => {
    registerMlModel({ run: async () => -0.2 });
    const score = await runMlModelScore(new Uint8ClampedArray(4), 1, 1);
    expect(score).toBe(0);
  });

  test('returns null when the runner throws', async () => {
    registerMlModel({ run: async () => { throw new Error('model error'); } });
    const score = await runMlModelScore(new Uint8ClampedArray(4), 1, 1);
    expect(score).toBeNull();
  });
});

// ── ImageDetector ─────────────────────────────────────────────────────────────

describe('ImageDetector', () => {
  const TIMEOUT = 10_000;

  test('returns image contentType', async () => {
    const detector = new ImageDetector();
    const result = await detector.detect('https://example.com/img.png', opts);
    expect(result.contentType).toBe('image');
  }, TIMEOUT);

  test('source is local when remoteEnabled is false', async () => {
    const detector = new ImageDetector();
    const result = await detector.detect('https://example.com/img.png', opts);
    expect(result.source).toBe('local');
  }, TIMEOUT);

  test('score is in [0, 1]', async () => {
    const detector = new ImageDetector();
    const result = await detector.detect('https://example.com/img.png', opts);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  }, TIMEOUT);

  test('caches results for the same URL', async () => {
    const mockRun = jest.fn().mockResolvedValue(0.8);
    registerMlModel({ run: mockRun });
    const detector = new ImageDetector();
    const r1 = await detector.detect('https://example.com/same-img.png', opts);
    const r2 = await detector.detect('https://example.com/same-img.png', opts);
    // Same reference from cache on second call
    expect(r1).toBe(r2);
  }, TIMEOUT);

  test('does not call remoteClassify when remoteEnabled is false', async () => {
    const remoteClassify = jest.fn();
    const detector = new ImageDetector();
    await detector.detect('https://example.com/img2.png', { ...opts, remoteEnabled: false, remoteClassify });
    expect(remoteClassify).not.toHaveBeenCalled();
  }, TIMEOUT);
});
