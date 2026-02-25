import fs from 'node:fs';
import { createNonescapeMiniRunner } from '../src/adapters/nonescape-mini-adapter';

type RgbaPayload = { width: number; height: number; data: number[] };

describe('Local model shell mode', () => {
  test('prints bundled model response for a shell-provided RGBA payload', async () => {
    const payloadPath = process.env.RC_LOCAL_MODEL_RGBA_JSON;
    if (!payloadPath) {
      console.info(
        '[RealityCheck] RC_LOCAL_MODEL_RGBA_JSON not provided. ' +
          'Set it to a JSON payload file to run manual shell-mode model checks.'
      );
      expect(true).toBe(true);
      return;
    }

    const raw = fs.readFileSync(payloadPath, 'utf8');
    const payload = JSON.parse(raw) as RgbaPayload;
    const runner = createNonescapeMiniRunner();
    const score = await runner.run(
      new Uint8ClampedArray(payload.data),
      payload.width,
      payload.height
    );
    const verdict = score >= 0.5 ? 'AI generated' : 'Not AI generated';

    console.info(
      `[RealityCheck] Local model response: ${JSON.stringify(
        {
          score,
          verdict,
          decisionStage: 'local_ml',
        },
        null,
        2
      )}`
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
