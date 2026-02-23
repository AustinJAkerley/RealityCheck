/**
 * @jest-environment jsdom
 */
import { computeLocalImageScore } from '../src/detectors/image-detector';
import { ImageDetector } from '../src/detectors/image-detector';

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

describe('ImageDetector (local only)', () => {
  const detector = new ImageDetector();
  const opts = { localOnly: true };

  test('returns a DetectionResult for a string URL', async () => {
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
