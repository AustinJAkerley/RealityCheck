/**
 * @jest-environment jsdom
 */
import { AudioDetector } from '../src/detectors/audio-detector';

describe('AudioDetector', () => {
  const detector = new AudioDetector();
  const opts = { remoteEnabled: false, detectionQuality: 'high' as const };

  test('contentType is audio', () => {
    expect(detector.contentType).toBe('audio');
  });

  test('always returns isAIGenerated: false (audio detection not supported)', async () => {
    const result = await detector.detect('https://elevenlabs.io/audio/sample.mp3', opts);
    expect(result.isAIGenerated).toBe(false);
  });

  test('always returns score: 0', async () => {
    const result = await detector.detect('https://suno.ai/song/abc123', opts);
    expect(result.score).toBe(0);
  });

  test('source is local', async () => {
    const result = await detector.detect('https://example.com/audio.mp3', opts);
    expect(result.source).toBe('local');
  });
});
