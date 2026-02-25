/**
 * @jest-environment jsdom
 */
import { createNonescapeMiniRunner } from '../src/adapters/nonescape-mini-adapter';

describe('Nonescape mini adapter', () => {
  test('runs bundled nonescape-mini model without external service', async () => {
    const runner = createNonescapeMiniRunner();
    const pixels = new Uint8ClampedArray([220, 120, 60, 255, 210, 110, 50, 255]);
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('supports swapping model runtime via adapter API', async () => {
    const predict = jest.fn().mockReturnValue(0.23);
    const runner = createNonescapeMiniRunner({
      model: 'future-model-v2',
      api: { predict },
    });
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const score = await runner.run(pixels, 2, 1);

    expect(score).toBeCloseTo(0.23, 5);
    expect(predict).toHaveBeenCalledTimes(1);
    expect(predict).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 2,
        height: 1,
      })
    );
  });
});
