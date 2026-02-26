/**
 * @jest-environment jsdom
 */
import { registerMlModel, getDownscaleMaxDim } from '../src/detectors/image-detector';
import { VideoDetector } from '../src/detectors/video-detector';

describe('VideoDetector', () => {
  test('remote-enabled mode bypasses local URL and local ML', async () => {
    const runMock = jest.fn().mockResolvedValue(0.05);
    registerMlModel({ run: runMock });

    try {
      const detector = new VideoDetector();
      const result = await detector.detect('https://sora.openai/videos/foo.mp4', {
        remoteEnabled: true,
        detectionQuality: 'high',
        remoteClassify: async () => ({ score: 0.9, label: 'ai' }),
      });

      expect(result.isAIGenerated).toBe(true);
      expect(result.source).toBe('remote');
      expect(result.decisionStage).toBe('remote_ml');
      expect(runMock).not.toHaveBeenCalled();
      expect(result.heuristicScores?.metadataUrl).toBeUndefined();
      expect(result.heuristicScores?.remote).toBeCloseTo(0.9, 5);
    } finally {
      // no-op
    }
  });

  test('high quality runs local model on sampled frames', async () => {
    const runMock = jest.fn().mockResolvedValue(0.8);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');

    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    let frameCounter = 0;
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const frameValue = Math.min(255, frameCounter * 20);
      frameCounter += 1;
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = frameValue;
        data[i + 1] = frameValue;
        data[i + 2] = frameValue;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => `data:image/jpeg;base64,frame-${frameCounter}`,
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const result = await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'high',
      });
      expect(result.contentType).toBe('video');
      expect(runMock).toHaveBeenCalled();
      expect(result.score).toBe(0.95);
      expect(result.isAIGenerated).toBe(true);
      expect(result.decisionStage).toBe('local_ml');
      expect(result.localModelScore).toBeCloseTo(0.8, 5);
      expect(result.heuristicScores?.localMl).toBeCloseTo(0.8, 5);
      expect(result.details).toContain('Local ML frame verdict');
    } finally {
      createSpy.mockRestore();
    }
  });

  test('high quality returns non-AI verdict when bundled model score is below threshold', async () => {
    const runMock = jest.fn().mockResolvedValue(0.05);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 100;
        data[i + 1] = 100;
        data[i + 2] = 100;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const result = await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'high',
      });
      expect(result.score).toBe(0.05);
      expect(result.isAIGenerated).toBe(false);
      expect(result.decisionStage).toBe('local_ml');
      expect(result.localModelScore).toBeCloseTo(0.05, 5);
      expect(result.details).toContain('Local ML frame verdict');
    } finally {
      createSpy.mockRestore();
    }
  });

  test('high quality returns AI verdict when bundled model score exceeds threshold', async () => {
    const runMock = jest.fn().mockResolvedValue(0.95);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 120;
        data[i + 1] = 120;
        data[i + 2] = 120;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const result = await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'high',
      });
      expect(result.score).toBe(0.95);
      expect(result.isAIGenerated).toBe(true);
      expect(result.decisionStage).toBe('local_ml');
      expect(result.localModelScore).toBeCloseTo(0.95, 5);
      expect(result.heuristicScores?.localMl).toBeCloseTo(0.95, 5);
      expect(result.details).toContain('Local ML frame verdict');
    } finally {
      createSpy.mockRestore();
    }
  });

  test('remote-enabled mode relies solely on remote result for videos', async () => {
    const runMock = jest.fn().mockResolvedValue(0.5);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 140;
        data[i + 1] = 140;
        data[i + 2] = 140;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const result = await detector.detect(video, {
        remoteEnabled: true,
        detectionQuality: 'high',
        remoteClassify: async () => ({ score: 0.1, label: 'human' }),
      });
      expect(result.source).toBe('remote');
      expect(result.decisionStage).toBe('remote_ml');
      expect(result.heuristicScores?.remote).toBeCloseTo(0.1, 5);
      expect(result.details).toContain('Remote-only mode');
      expect(result.isAIGenerated).toBe(false);
      expect(result.localModelScore).toBeUndefined();
    } finally {
      createSpy.mockRestore();
    }
  });

  test('high-quality video local ML receives full-resolution frame input', async () => {
    const runMock = jest.fn().mockResolvedValue(0.95);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 150;
        data[i + 1] = 150;
        data[i + 2] = 150;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'high',
      });
      expect(runMock).toHaveBeenCalled();
      const hasFullResCall = runMock.mock.calls.some((call) => call[1] === 640 && call[2] === 360);
      expect(hasFullResCall).toBe(true);
    } finally {
      createSpy.mockRestore();
    }
  });

  test('medium-quality video local ML receives half-resolution frame input', async () => {
    const runMock = jest.fn().mockResolvedValue(0.95);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 150;
        data[i + 1] = 150;
        data[i + 2] = 150;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'medium',
      });
      expect(runMock).toHaveBeenCalled();
      const hasHalfResCall = runMock.mock.calls.some((call) => call[1] === 320 && call[2] === 180);
      expect(hasHalfResCall).toBe(true);
    } finally {
      createSpy.mockRestore();
    }
  });

  test('low-quality video local ML receives 192-max-side frame input', async () => {
    const runMock = jest.fn().mockResolvedValue(0.95);
    registerMlModel({ run: runMock });

    const detector = new VideoDetector();
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: 'https://example.com/video.mp4',
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

    const originalCreateElement = document.createElement.bind(document);
    const createSpy = jest.spyOn(document, 'createElement');
    createSpy.mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 150;
        data[i + 1] = 150;
        data[i + 2] = 150;
        data[i + 3] = 255;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,frame',
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      await detector.detect(video, {
        remoteEnabled: false,
        detectionQuality: 'low',
      });
      expect(runMock).toHaveBeenCalled();
      const hasLowResCall = runMock.mock.calls.some((call) => call[1] === 192 && call[2] === 108);
      expect(hasLowResCall).toBe(true);
    } finally {
      createSpy.mockRestore();
    }
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
