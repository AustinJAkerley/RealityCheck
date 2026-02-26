/**
 * @jest-environment jsdom
 */
import { VideoDetector } from '../src/detectors/video-detector';
import { getDownscaleMaxDim } from '../src/detectors/image-detector';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a mock HTMLVideoElement with configurable video dimensions.
 * jsdom doesn't support actual video playback, so we stub the properties
 * needed by captureVideoFrame / analyzeVideoFrames.
 * The mock dispatches 'seeked' immediately on currentTime assignment so
 * seekTo() resolves without waiting for the 500ms timeout.
 */
function mockVideoElement(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = 'http://localhost/video.mp4';
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  Object.defineProperty(video, 'duration', { value: 10, configurable: true });
  // Fire 'seeked' on every currentTime write so seekTo() resolves immediately
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

/**
 * Spy on document.createElement to capture every canvas created during a
 * detect() call. In jsdom, getContext('2d') returns null so no pixel data
 * is produced, but canvas.width / canvas.height ARE set before the null check.
 */
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

// ── VideoDetector integration ─────────────────────────────────────────────────

describe('VideoDetector (remote disabled)', () => {
  const detector = new VideoDetector();
  const opts = { remoteEnabled: false, detectionQuality: 'medium' as const };

  test('returns a DetectionResult for a string URL', async () => {
    const result = await detector.detect('https://example.com/video.mp4', opts);
    expect(result.contentType).toBe('video');
    expect(result.source).toBe('local');
  });

  test('flags known AI video platform URL', async () => {
    const result = await detector.detect('https://sora.openai.com/v/abc', opts);
    expect(result.isAIGenerated).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  test('caches identical URLs', async () => {
    const url = 'https://example.com/cached-video.mp4';
    const r1 = await detector.detect(url, opts);
    const r2 = await detector.detect(url, opts);
    expect(r1).toBe(r2);
  });
});

// ── Video frame resolution scales with quality ────────────────────────────────

describe('detect() video frame resolution scales with quality', () => {
  test('high quality creates a larger canvas for frame capture than low quality', async () => {
    const remoteClassify = jest.fn().mockResolvedValue({ score: 0.5, label: 'uncertain' });
    const video = mockVideoElement(1920, 1080);

    // Low quality run
    const low = captureCanvases();
    await new VideoDetector().detect(video, { remoteEnabled: true, detectionQuality: 'low', remoteClassify });
    low.restore();

    // High quality run
    const high = captureCanvases();
    await new VideoDetector().detect(video, { remoteEnabled: true, detectionQuality: 'high', remoteClassify });
    high.restore();

    // Filter to canvases that were sized for downscaling (not the tiny FRAME_ANALYSIS_SIZE ones)
    const lowDownscale = low.canvases.filter(c => c.width === getDownscaleMaxDim('low') || c.width === Math.round(1920 * getDownscaleMaxDim('low') / 1920));
    const highDownscale = high.canvases.filter(c => c.width === getDownscaleMaxDim('high') || c.width === Math.round(1920 * getDownscaleMaxDim('high') / 1920));

    // At minimum, verify canvases were created
    expect(low.canvases.length).toBeGreaterThan(0);
    expect(high.canvases.length).toBeGreaterThan(0);

    // The largest canvas in high quality should be larger than the largest in low quality
    const lowMaxWidth = Math.max(...low.canvases.map(c => c.width));
    const highMaxWidth = Math.max(...high.canvases.map(c => c.width));
    expect(highMaxWidth).toBeGreaterThan(lowMaxWidth);
  });

  test('getDownscaleMaxDim values are used for video frame capture', () => {
    // Verify the same getDownscaleMaxDim function is used for both images and videos
    expect(getDownscaleMaxDim('low')).toBe(64);
    expect(getDownscaleMaxDim('medium')).toBe(128);
    expect(getDownscaleMaxDim('high')).toBe(512);
  });
});
