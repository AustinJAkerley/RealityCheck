/**
 * Unit tests for the image analysis logic.
 */
import { analyzeImage } from '../src/analysis/image-analyzer';

describe('analyzeImage', () => {
  test('returns a score between 0 and 1', () => {
    const result = analyzeImage(undefined, undefined, undefined);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('scores a known AI CDN URL as ai', () => {
    const result = analyzeImage(
      undefined,
      undefined,
      'https://images.openai.com/dalle3/abc.jpg'
    );
    expect(result.score).toBeGreaterThanOrEqual(0.65);
    expect(result.label).toBe('ai');
  });

  test('scores a non-AI URL as human or uncertain', () => {
    const result = analyzeImage(undefined, undefined, 'https://example.com/photo.jpg');
    expect(['human', 'uncertain']).toContain(result.label);
  });

  test('scores a MidJourney URL as ai', () => {
    const result = analyzeImage(
      undefined,
      undefined,
      'https://cdn.midjourney.com/image.png'
    );
    expect(result.label).toBe('ai');
  });

  test('returns human label when score < 0.35', () => {
    const result = analyzeImage(undefined, 'somehash', undefined);
    expect(result.label).toBe('human');
    expect(result.score).toBeLessThan(0.35);
  });

  test('accepts a valid PNG data-URL without throwing', () => {
    // Minimal 1×1 white PNG (89 bytes, base64-encoded)
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const dataUrl = `data:image/png;base64,${pngB64}`;
    const result = analyzeImage(dataUrl, undefined, undefined);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('does not throw for a malformed data-URL', () => {
    expect(() => analyzeImage('data:image/jpeg;base64,NOT_VALID!!', undefined, undefined)).not.toThrow();
  });

  test('score does not exceed 1 even with multiple matching signals', () => {
    const result = analyzeImage(
      undefined,
      undefined,
      'https://cdn.midjourney.com/1024x1024.png'
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
