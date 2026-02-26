/**
 * Detection pipeline — orchestrates text, image, and video detectors.
 * Results are per-element and cached to avoid redundant re-analysis.
 *
 * ## Local ML model upgrade path
 * By default the pipeline registers `nonescape-mini`, a fast statistical
 * feature model (AUC ~0.65).  For best-in-class accuracy, upgrade to a real
 * neural-network model before creating the pipeline:
 *
 * ```ts
 * // In extension startup / background script:
 * import { pipeline } from '@xenova/transformers';
 * import { registerTransformersjsModel, DetectionPipeline } from '@reality-check/core';
 *
 * const pipe = await pipeline('image-classification', 'Xenova/ai-image-detector');
 * registerTransformersjsModel({ pipeline: pipe }); // ViT, AUC ~0.92
 * const detectionPipeline = new DetectionPipeline();
 * ```
 *
 * Alternatively, pass a pre-created ONNX session via `registerOnnxModel()`
 * from `onnx-model-adapter.ts`.
 */
import { ContentType, DetectionResult, DetectorOptions, Detector } from '../types.js';
import { TextDetector } from '../detectors/text-detector.js';
import { ImageDetector } from '../detectors/image-detector.js';
import { VideoDetector } from '../detectors/video-detector.js';
import { registerNonescapeMiniModel } from '../adapters/nonescape-mini-adapter.js';

let localModelInitialized = false;

export class DetectionPipeline {
  private readonly detectors: Map<ContentType, Detector>;

  constructor(
    textDetector: Detector = new TextDetector(),
    imageDetector: Detector = new ImageDetector(),
    videoDetector: Detector = new VideoDetector()
  ) {
    if (!localModelInitialized) {
      registerNonescapeMiniModel();
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
