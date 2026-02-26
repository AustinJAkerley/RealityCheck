/**
 * @jest-environment jsdom
 */
import {
  createTransformersjsRunner,
  registerTransformersjsModel,
} from '../src/adapters/transformersjs-adapter';
import { isMlModelAvailable } from '../src/detectors/image-detector';
import type {
  TransformersjsPipeline,
  TransformersjsModelAdapterOptions,
} from '../src/adapters/transformersjs-adapter';

// ── helpers ────────────────────────────────────────────────────────────────────

function solidPixels(r: number, g: number, b: number, side = 16): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return buf;
}

/**
 * Build a mock Transformers.js pipeline that returns fixed label scores.
 * Also provides a custom `toInput` converter so we avoid needing OffscreenCanvas
 * in the Node.js / jsdom test environment.
 */
function makeMockOptions(
  artificial: number,
  real: number,
  aiLabel = 'artificial'
): TransformersjsModelAdapterOptions {
  const pipeline: TransformersjsPipeline = async () => [
    { label: 'artificial', score: artificial },
    { label: 'real',       score: real },
  ];
  return {
    pipeline,
    aiLabel,
    // Skip OffscreenCanvas in test env; return a plain string the runner can use
    toInput: async () => 'data:image/png;base64,iVBORw0KGgo=',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TransformersjsModelAdapter', () => {
  test('createTransformersjsRunner returns a valid MlModelRunner', () => {
    const runner = createTransformersjsRunner(makeMockOptions(0.9, 0.1));
    expect(typeof runner.run).toBe('function');
  });

  test('extracts AI probability from pipeline results (artificial label)', async () => {
    const runner = createTransformersjsRunner(makeMockOptions(0.85, 0.15));
    const score = await runner.run(solidPixels(200, 100, 50), 16, 16);
    expect(score).toBeCloseTo(0.85, 5);
  });

  test('returns 0 when aiLabel is absent from pipeline results', async () => {
    const pipeline: TransformersjsPipeline = async () => [
      { label: 'real', score: 1.0 },
    ];
    const runner = createTransformersjsRunner({
      pipeline,
      toInput: async () => 'stub',
    });
    const score = await runner.run(solidPixels(0, 0, 0), 4, 4);
    expect(score).toBe(0);
  });

  test('respects custom aiLabel (e.g. SDXL for Organika/sdxl-detector)', async () => {
    const pipeline: TransformersjsPipeline = async () => [
      { label: 'SDXL', score: 0.78 },
      { label: 'real', score: 0.22 },
    ];
    const runner = createTransformersjsRunner({
      pipeline,
      aiLabel: 'SDXL',
      toInput: async () => 'stub',
    });
    const score = await runner.run(solidPixels(50, 50, 50), 8, 8);
    expect(score).toBeCloseTo(0.78, 5);
  });

  test('label matching is case-insensitive', async () => {
    const pipeline: TransformersjsPipeline = async () => [
      { label: 'Artificial', score: 0.66 },
    ];
    const runner = createTransformersjsRunner({
      pipeline,
      aiLabel: 'artificial',
      toInput: async () => 'stub',
    });
    const score = await runner.run(solidPixels(100, 100, 100), 8, 8);
    expect(score).toBeCloseTo(0.66, 5);
  });

  test('clamps output score to [0, 1] when pipeline returns out-of-range value', async () => {
    const pipeline: TransformersjsPipeline = async () => [
      { label: 'artificial', score: 1.5 },
    ];
    const runner = createTransformersjsRunner({
      pipeline,
      toInput: async () => 'stub',
    });
    expect(await runner.run(solidPixels(0, 0, 0), 4, 4)).toBe(1);
  });

  test('toInput receives the correct pixel buffer and dimensions', async () => {
    const side = 16;
    let capturedData: Uint8ClampedArray | undefined;
    let capturedW = 0, capturedH = 0;

    const runner = createTransformersjsRunner({
      pipeline: async () => [{ label: 'artificial', score: 0.5 }],
      toInput: async (data, w, h) => {
        capturedData = data;
        capturedW = w; capturedH = h;
        return 'stub';
      },
    });

    const pixels = solidPixels(255, 0, 0, side);
    await runner.run(pixels, side, side);

    expect(capturedData).toBe(pixels);
    expect(capturedW).toBe(side);
    expect(capturedH).toBe(side);
  });

  test('revokes blob: URLs after inference', async () => {
    const revokedUrls: string[] = [];
    // jsdom doesn't implement URL.revokeObjectURL; install a mock
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => { revokedUrls.push(url); };

    const blobUrl = 'blob:http://extension/fake-id';
    const runner = createTransformersjsRunner({
      pipeline: async () => [{ label: 'artificial', score: 0.5 }],
      toInput: async () => blobUrl,
    });

    await runner.run(solidPixels(128, 128, 128), 8, 8);
    expect(revokedUrls).toContain(blobUrl);

    URL.revokeObjectURL = origRevoke;
  });

  test('revokes blob: URL even when pipeline throws', async () => {
    const revokedUrls: string[] = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => { revokedUrls.push(url); };

    const blobUrl = 'blob:http://extension/throws-id';
    const runner = createTransformersjsRunner({
      pipeline: async () => { throw new Error('inference failed'); },
      toInput: async () => blobUrl,
    });

    await expect(runner.run(solidPixels(0, 0, 0), 4, 4)).rejects.toThrow('inference failed');
    expect(revokedUrls).toContain(blobUrl);

    URL.revokeObjectURL = origRevoke;
  });

  test('non-blob: URLs are not revoked', async () => {
    const revokedUrls: string[] = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => { revokedUrls.push(url); };

    const dataUrl = 'data:image/png;base64,iVBOR==';
    const runner = createTransformersjsRunner({
      pipeline: async () => [{ label: 'artificial', score: 0.7 }],
      toInput: async () => dataUrl,
    });

    await runner.run(solidPixels(10, 20, 30), 8, 8);
    expect(revokedUrls).not.toContain(dataUrl);

    URL.revokeObjectURL = origRevoke;
  });

  test('registerTransformersjsModel makes isMlModelAvailable() return true', () => {
    registerTransformersjsModel(makeMockOptions(0.5, 0.5));
    expect(isMlModelAvailable()).toBe(true);
  });
});
