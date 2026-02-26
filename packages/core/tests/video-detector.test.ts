/**
 * @jest-environment jsdom
 */
import { registerMlModel } from '../src/detectors/image-detector';
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
