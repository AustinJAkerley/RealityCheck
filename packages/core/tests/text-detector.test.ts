import { computeLocalTextScore } from '../src/detectors/text-detector';
import { TextDetector } from '../src/detectors/text-detector';

describe('computeLocalTextScore', () => {
  test('returns 0 for very short text', () => {
    expect(computeLocalTextScore('Hi there.')).toBe(0);
  });

  test('returns 0 for text that is too short for detection', () => {
    expect(computeLocalTextScore('Short text.')).toBe(0);
  });

  test('returns a low score for natural human text', () => {
    const human =
      'I went to the market yesterday. It was raining, which was annoying! I forgot my umbrella at home. ' +
      'Bought some apples and bread. The vendor was really nice though — gave me an extra apple for free. ' +
      "Kids were playing near the fountain. It's been a while since I've been there.";
    const score = computeLocalTextScore(human);
    expect(score).toBeLessThan(0.5);
  });

  test('returns a higher score for AI-like filler text', () => {
    const aiText =
      "As an AI language model, I'm happy to help. Certainly, here is a comprehensive overview. " +
      'It is worth noting that this topic has many important aspects. Ultimately, it is crucial to understand ' +
      'the broader implications. In today\'s world, we must consider all perspectives carefully. ' +
      'There are several key factors to consider here. First, we must examine the context thoroughly. ' +
      'Second, we need to analyze the evidence objectively. Third, we should synthesize our findings.';
    const score = computeLocalTextScore(aiText);
    expect(score).toBeGreaterThan(0.3);
  });

  test('scores multiple AI filler phrases cumulatively', () => {
    const manyFillers =
      "As an AI language model, I don't have feelings. Certainly, here is a summary. " +
      "I'm happy to help with that request. I do not have access to the internet. " +
      "Certainly, here's what I know. As an AI assistant, I can explain this. " +
      'It is worth noting this important detail. In today\'s world, this matters greatly.';
    const score = computeLocalTextScore(manyFillers);
    expect(score).toBeGreaterThan(0.3);
  });
});

describe('TextDetector (local only)', () => {
  const detector = new TextDetector();
  const opts = { localOnly: true };

  test('returns a DetectionResult for AI-like text', async () => {
    const aiText =
      "As an AI language model, I'm happy to help. Certainly, here is a comprehensive overview. " +
      'It is worth noting that this topic has many important aspects. Ultimately, it is crucial. ' +
      'There are several key factors to consider here. First, we must examine context carefully.';
    const result = await detector.detect(aiText, opts);
    expect(result.contentType).toBe('text');
    expect(result.source).toBe('local');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('isAIGenerated');
  });

  test('caches identical text', async () => {
    const text =
      "As an AI language model, I'm happy to help. This is a test. " +
      'There are many important things to consider about this topic today. ' +
      'It is worth noting that all perspectives should be carefully examined.';
    const r1 = await detector.detect(text, opts);
    const r2 = await detector.detect(text, opts);
    expect(r1).toBe(r2); // same object reference from cache
  });

  test('returns isAIGenerated=false for short text', async () => {
    const result = await detector.detect('Hello world.', opts);
    expect(result.isAIGenerated).toBe(false);
  });
});
