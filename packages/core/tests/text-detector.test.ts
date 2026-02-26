/**
 * @jest-environment jsdom
 */
import { TextDetector } from '../src/detectors/text-detector';

describe('TextDetector — remote-only architecture', () => {
  const detector = new TextDetector();

  test('returns text contentType', async () => {
    const result = await detector.detect('Hello world', { remoteEnabled: false, detectionQuality: 'high' });
    expect(result.contentType).toBe('text');
  });

  test('returns neutral score when remoteEnabled is false', async () => {
    const result = await detector.detect('Some text content here.', { remoteEnabled: false, detectionQuality: 'high' });
    expect(result.score).toBe(0);
    expect(result.isAIGenerated).toBe(false);
    expect(result.source).toBe('local');
  });

  test('calls remoteClassify when remoteEnabled is true', async () => {
    const remoteClassify = jest.fn().mockResolvedValue({ score: 0.8, label: 'ai' });
    const result = await detector.detect('Some text to classify.', {
      remoteEnabled: true,
      detectionQuality: 'high',
      remoteClassify,
    });
    expect(remoteClassify).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('remote');
    expect(result.score).toBe(0.8);
    expect(result.isAIGenerated).toBe(true);
  });

  test('falls back to neutral when remoteClassify returns error label', async () => {
    const remoteClassify = jest.fn().mockResolvedValue({ score: 0.5, label: 'error' });
    const result = await detector.detect('Some text.', {
      remoteEnabled: true,
      detectionQuality: 'high',
      remoteClassify,
    });
    expect(result.score).toBe(0);
    expect(result.source).toBe('local');
  });

  test('falls back to neutral when remoteClassify throws', async () => {
    const remoteClassify = jest.fn().mockRejectedValue(new Error('network error'));
    const result = await detector.detect('Some text.', {
      remoteEnabled: true,
      detectionQuality: 'high',
      remoteClassify,
    });
    expect(result.score).toBe(0);
  });

  test('caches results for the same text', async () => {
    const remoteClassify = jest.fn().mockResolvedValue({ score: 0.6, label: 'ai' });
    const text = 'Unique cache test text for text detector';
    await detector.detect(text, { remoteEnabled: true, detectionQuality: 'high', remoteClassify });
    await detector.detect(text, { remoteEnabled: true, detectionQuality: 'high', remoteClassify });
    expect(remoteClassify).toHaveBeenCalledTimes(1);
  });
});
