/**
 * @jest-environment jsdom
 */
/**
 * Tests for the AudioDetector.
 */
import { AudioDetector } from '../src/detectors/audio-detector';

describe('AudioDetector (local only)', () => {
  const detector = new AudioDetector();
  const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };

  test('contentType is audio', () => {
    expect(detector.contentType).toBe('audio');
  });

  test('returns high score for known AI audio platform URL', async () => {
    const result = await detector.detect('https://elevenlabs.io/audio/sample.mp3', opts);
    expect(result.contentType).toBe('audio');
    expect(result.isAIGenerated).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.35);
    expect(result.source).toBe('local');
  });

  test('returns high score for Suno AI URL', async () => {
    const result = await detector.detect('https://suno.ai/song/abc123', opts);
    expect(result.isAIGenerated).toBe(true);
  });

  test('returns low score for unrecognized URL', async () => {
    const result = await detector.detect('https://example.com/podcast.mp3', opts);
    expect(result.score).toBeLessThan(0.35);
    expect(result.isAIGenerated).toBe(false);
  });

  test('caches identical URLs', async () => {
    const url = 'https://example.com/audio.wav';
    const r1 = await detector.detect(url, opts);
    const r2 = await detector.detect(url, opts);
    expect(r1).toBe(r2); // same cached object
  });

  test('score is in [0, 1] range', async () => {
    const result = await detector.detect('https://murf.ai/audio/test.mp3', opts);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('result has required fields', async () => {
    const result = await detector.detect('https://example.com/audio.mp3', opts);
    expect(result).toHaveProperty('contentType');
    expect(result).toHaveProperty('isAIGenerated');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('source');
  });
});
