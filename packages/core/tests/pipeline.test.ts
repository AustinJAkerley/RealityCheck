/**
 * @jest-environment jsdom
 */
import { DetectionPipeline } from '../src/pipeline/detection-pipeline';

describe('DetectionPipeline', () => {
  const pipeline = new DetectionPipeline();
  const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };

  test('analyzeText returns a result with correct content type', async () => {
    const result = await pipeline.analyzeText('Short text.', opts);
    expect(result.contentType).toBe('text');
  });

  test('analyzeImage returns a result with correct content type', async () => {
    const result = await pipeline.analyzeImage('https://example.com/img.png', opts);
    expect(result.contentType).toBe('image');
  });

  test('analyzeVideo returns a result with correct content type', async () => {
    const result = await pipeline.analyzeVideo('https://example.com/video.mp4', opts);
    expect(result.contentType).toBe('video');
  });

  test('registerDetector replaces a detector', async () => {
    const mockDetector = {
      contentType: 'text' as const,
      detect: jest.fn().mockResolvedValue({
        contentType: 'text',
        isAIGenerated: true,
        confidence: 'high',
        score: 0.9,
        source: 'local',
      }),
    };
    pipeline.registerDetector(mockDetector);
    const result = await pipeline.analyzeText('any text', opts);
    expect(mockDetector.detect).toHaveBeenCalled();
    expect(result.isAIGenerated).toBe(true);
  });
});
