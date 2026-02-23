/**
 * Detection pipeline — orchestrates text, image, and video detectors.
 * Results are per-element and cached to avoid redundant re-analysis.
 */
import { DetectionResult, DetectorOptions, Detector } from '../types.js';
export declare class DetectionPipeline {
    private readonly detectors;
    constructor(textDetector?: Detector, imageDetector?: Detector, videoDetector?: Detector);
    analyzeText(text: string, options: DetectorOptions): Promise<DetectionResult>;
    analyzeImage(element: HTMLImageElement | string, options: DetectorOptions): Promise<DetectionResult>;
    analyzeVideo(element: HTMLVideoElement | string, options: DetectorOptions): Promise<DetectionResult>;
    /**
     * Replace a detector implementation (e.g. swap in a custom one).
     */
    registerDetector(detector: Detector): void;
}
//# sourceMappingURL=detection-pipeline.d.ts.map