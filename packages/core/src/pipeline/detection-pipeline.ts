/**
 * Detection pipeline — orchestrates text, image, and video detectors.
 * Results are per-element and cached to avoid redundant re-analysis.
 */
import { ContentType, DetectionResult, DetectorOptions, Detector } from '../types.js';
import { TextDetector } from '../detectors/text-detector.js';
import { ImageDetector } from '../detectors/image-detector.js';
import { VideoDetector } from '../detectors/video-detector.js';
import { registerSdxlDetector } from '../adapters/sdxl-detector-adapter.js';

let localModelInitialized = false;

export class DetectionPipeline {
  private readonly detectors: Map<ContentType, Detector>;

  constructor(
    textDetector: Detector = new TextDetector(),
    imageDetector: Detector = new ImageDetector(),
    videoDetector: Detector = new VideoDetector()
  ) {
    if (!localModelInitialized) {
      registerSdxlDetector();
      localModelInitialized = true;
    }
    this.detectors = new Map([
      ['text', textDetector],
      ['image', imageDetector],
      ['video', videoDetector],
    ]);
  }

  async analyzeText(text: string, options: DetectorOptions): Promise<DetectionResult> {
    return this.detectors.get('text')!.detect(text, options);
  }

  async analyzeImage(element: HTMLImageElement | string, options: DetectorOptions): Promise<DetectionResult> {
    return this.detectors.get('image')!.detect(element, options);
  }

  async analyzeVideo(element: HTMLVideoElement | string, options: DetectorOptions): Promise<DetectionResult> {
    return this.detectors.get('video')!.detect(element, options);
  }

  /**
   * Replace a detector implementation (e.g. swap in a custom one).
   */
  registerDetector(detector: Detector): void {
    this.detectors.set(detector.contentType, detector);
  }
}
