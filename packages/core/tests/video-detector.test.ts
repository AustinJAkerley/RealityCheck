/**
 * @jest-environment jsdom
 */
import { registerMlModel } from '../src/detectors/image-detector';
import { VideoDetector } from '../src/detectors/video-detector';

describe('VideoDetector', () => {
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
    } finally {
      createSpy.mockRestore();
    }
  });
});
