/**
 * @jest-environment jsdom
 */
import { createNonescapeMiniRunner } from '../src/adapters/nonescape-mini-adapter';

describe('Nonescape mini adapter', () => {
  test('posts pixel payload to local endpoint and returns score', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ score: 0.78 }),
    });

    const runner = createNonescapeMiniRunner({
      endpoint: 'http://127.0.0.1:8765',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const score = await runner.run(pixels, 2, 1);

    expect(score).toBeCloseTo(0.78, 5);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/classify/image',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
});
