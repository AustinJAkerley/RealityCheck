import { TextDetector } from '../detectors/text-detector.js';
import { ImageDetector } from '../detectors/image-detector.js';
import { VideoDetector } from '../detectors/video-detector.js';
export class DetectionPipeline {
    constructor(textDetector = new TextDetector(), imageDetector = new ImageDetector(), videoDetector = new VideoDetector()) {
        this.detectors = new Map([
            ['text', textDetector],
            ['image', imageDetector],
            ['video', videoDetector],
        ]);
    }
    async analyzeText(text, options) {
        return this.detectors.get('text').detect(text, options);
    }
    async analyzeImage(element, options) {
        return this.detectors.get('image').detect(element, options);
    }
    async analyzeVideo(element, options) {
        return this.detectors.get('video').detect(element, options);
    }
    /**
     * Replace a detector implementation (e.g. swap in a custom one).
     */
    registerDetector(detector) {
        this.detectors.set(detector.contentType, detector);
    }
}
//# sourceMappingURL=detection-pipeline.js.map