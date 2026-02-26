import {
  createSdxlDetectorRunner,
  registerSdxlDetector,
  SDXL_DETECTOR_ENDPOINT,
} from '../src/adapters/sdxl-detector-adapter';
import { isMlModelAvailable } from '../src/detectors/image-detector';

const pixels = new Uint8ClampedArray([220, 120, 60, 255, 210, 110, 50, 255]);

/** Minimal JPEG byte sequence for use in test encoder stubs. */
const MOCK_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;

/** Returns an imageEncoder stub that always produces MOCK_JPEG bytes. */
function mockEncoder() {
  return jest.fn().mockResolvedValue(MOCK_JPEG);
}

function mockFetch(body: unknown, ok = true): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => body,
  } as unknown as Response);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SDXL Detector adapter', () => {
  test('returns 0.5 when image encoding is unavailable (no canvas)', async () => {
    // With no imageEncoder and no canvas context, the runner falls back to 0.5
    const runner = createSdxlDetectorRunner();
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('extracts artificial score from HuggingFace API response', async () => {
    const spy = mockFetch([
      { label: 'artificial', score: 0.8 },
      { label: 'real', score: 0.2 },
    ]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeCloseTo(0.8, 5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('returns 0.95 for high AI confidence (calibration)', async () => {
    mockFetch([{ label: 'artificial', score: 0.91 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.95);
  });

  test('returns 0.05 for strong non-AI confidence (calibration)', async () => {
    mockFetch([{ label: 'artificial', score: 0.08 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.05);
  });

  test('returns 0.5 on HTTP error', async () => {
    mockFetch({}, false);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('returns 0.5 on network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('includes Authorization header when apiToken is provided', async () => {
    const spy = mockFetch([{ label: 'artificial', score: 0.5 }]);
    const runner = createSdxlDetectorRunner({
      apiToken: 'hf-test-token',
      imageEncoder: mockEncoder(),
    });
    await runner.run(pixels, 2, 1);

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer hf-test-token');
  });

  test('omits Authorization header when no apiToken', async () => {
    const spy = mockFetch([{ label: 'artificial', score: 0.5 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    await runner.run(pixels, 2, 1);

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  test('POSTs to the default HuggingFace endpoint', async () => {
    const spy = mockFetch([{ label: 'artificial', score: 0.5 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    await runner.run(pixels, 2, 1);

    expect(spy.mock.calls[0][0]).toBe(SDXL_DETECTOR_ENDPOINT);
  });

  test('uses custom endpoint when provided', async () => {
    const spy = mockFetch([{ label: 'artificial', score: 0.5 }]);
    const runner = createSdxlDetectorRunner({
      endpoint: 'https://custom.endpoint.com/model',
      imageEncoder: mockEncoder(),
    });
    await runner.run(pixels, 2, 1);

    expect(spy.mock.calls[0][0]).toBe('https://custom.endpoint.com/model');
  });

  test('returns 0.5 when API response has no artificial label', async () => {
    mockFetch([{ label: 'real', score: 0.95 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBe(0.5);
  });

  test('sends Content-Type: image/jpeg', async () => {
    const spy = mockFetch([{ label: 'artificial', score: 0.6 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    await runner.run(pixels, 2, 1);

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/jpeg');
  });

  test('score is always in [0, 1]', async () => {
    mockFetch([{ label: 'artificial', score: 0.55 }]);
    const runner = createSdxlDetectorRunner({ imageEncoder: mockEncoder() });
    const score = await runner.run(pixels, 2, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('registerSdxlDetector', () => {
  test('registers a model runner so isMlModelAvailable() returns true', () => {
    registerSdxlDetector({ imageEncoder: mockEncoder() });
    expect(isMlModelAvailable()).toBe(true);
  });
});
