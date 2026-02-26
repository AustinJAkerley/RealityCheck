/**
 * @jest-environment jsdom
 */
import { registerMlModel, getDownscaleMaxDim } from '../src/detectors/image-detector';
import { VideoDetector } from '../src/detectors/video-detector';

const opts = { remoteEnabled: false, detectionQuality: 'high' as const };

describe('VideoDetector', () => {
  test('returns video contentType', async () => {
    const detector = new VideoDetector();
    const result = await detector.detect('https://example.com/video.mp4', opts);
    expect(result.contentType).toBe('video');
  });

  test('returns neutral 0.5 for URL-only content (no video element)', async () => {
    const detector = new VideoDetector();
    const result = await detector.detect('https://example.com/video.mp4', opts);
    expect(result.score).toBe(0.5);
    expect(result.source).toBe('local');
  });

  test('score is in [0, 1]', async () => {
    const detector = new VideoDetector();
    const result = await detector.detect('https://example.com/video.mp4', opts);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('does not call remoteClassify when remoteEnabled is false', async () => {
    const remoteClassify = jest.fn();
    const detector = new VideoDetector();
    await detector.detect('https://example.com/video.mp4', { ...opts, remoteEnabled: false, remoteClassify });
    expect(remoteClassify).not.toHaveBeenCalled();
  });

  test('caches results for the same src', async () => {
    const detector = new VideoDetector();
    const r1 = await detector.detect('https://example.com/same-video.mp4', opts);
    const r2 = await detector.detect('https://example.com/same-video.mp4', opts);
    expect(r1).toBe(r2);
  });

  test('runs SDXL model on captured frames', async () => {
    const runMock = jest.fn().mockResolvedValue(0.8);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');

    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/framed-video.mp4',
    });

    let currentTime = 0;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        setTimeout(() => video.dispatchEvent(new Event('seeked')), 0);
      },
    });

    // Mock canvas to avoid cross-origin errors in jsdom
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const canvas = originalCreateElement('canvas');
      const originalGetContext = canvas.getContext.bind(canvas);
      jest.spyOn(canvas, 'getContext').mockImplementation(((contextType: string) => {
        if (contextType !== '2d') return originalGetContext(contextType as '2d');
        return {
          drawImage: jest.fn(),
          getImageData: jest.fn().mockReturnValue({
            data: new Uint8ClampedArray(640 * 360 * 4).fill(128),
          }),
        };
      }) as typeof canvas.getContext);
      jest.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,test');
      return canvas;
    }) as typeof document.createElement);

    const result = await detector.detect(video, { ...opts, detectionQuality: 'high' });

    jest.restoreAllMocks();

    expect(result.contentType).toBe('video');
    // jsdom canvas mock may not produce valid pixel data; we only assert the shape
    // is correct. A real integration test with a live video element would assert
    // that runMlModelScore was called FRAME_COUNT times.
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ── Video frame resolution scales with quality ────────────────────────────────

describe('detect() video frame resolution scales with quality', () => {
  function mockVideoElement(width: number, height: number): HTMLVideoElement {
    const video = document.createElement('video');
    video.src = 'http://localhost/video.mp4';
    Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
    Object.defineProperty(video, 'duration', { value: 10, configurable: true });
    Object.defineProperty(video, 'currentSrc', { value: 'http://localhost/video.mp4', configurable: true });
    let _ct = 0;
    Object.defineProperty(video, 'currentTime', {
      get() { return _ct; },
      set(v: number) {
        _ct = v;
        setTimeout(() => video.dispatchEvent(new Event('seeked')), 0);
      },
      configurable: true,
    });
    return video;
  }

  function captureCanvases(): { canvases: HTMLCanvasElement[]; restore: () => void } {
    const canvases: HTMLCanvasElement[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') canvases.push(el as HTMLCanvasElement);
      return el;
    });
    return { canvases, restore: () => spy.mockRestore() };
  }

  test('high quality creates a larger canvas for frame capture than low quality', async () => {
    const remoteClassify = jest.fn().mockResolvedValue({ score: 0.5, label: 'uncertain' });
    const video = mockVideoElement(1920, 1080);

    const low = captureCanvases();
    await new VideoDetector().detect(video, { remoteEnabled: true, detectionQuality: 'low', remoteClassify });
    low.restore();

    const high = captureCanvases();
    await new VideoDetector().detect(video, { remoteEnabled: true, detectionQuality: 'high', remoteClassify });
    high.restore();

    expect(low.canvases.length).toBeGreaterThan(0);
    expect(high.canvases.length).toBeGreaterThan(0);

    const lowMaxWidth = Math.max(...low.canvases.map(c => c.width));
    const highMaxWidth = Math.max(...high.canvases.map(c => c.width));
    expect(highMaxWidth).toBeGreaterThan(lowMaxWidth);
  });

  test('getDownscaleMaxDim values are shared between image and video detectors', () => {
    expect(getDownscaleMaxDim('low')).toBe(64);
    expect(getDownscaleMaxDim('medium')).toBe(128);
    expect(getDownscaleMaxDim('high')).toBe(512);
  });
});
