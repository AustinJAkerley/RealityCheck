/**
 * Audio detector — returns neutral results.
 *
 * Neither the local SDXL model nor the remote text/image classifier
 * is suited to audio deepfake detection. This detector always returns
 * a neutral result so the pipeline does not crash when audio elements
 * are encountered.
 *
 * Future work: on-device ONNX model trained on mel-spectrogram features.
 */
import { DetectionResult, Detector, DetectorOptions } from '../types.js';

export class AudioDetector implements Detector {
  readonly contentType = 'audio' as const;

  async detect(_content: string | HTMLElement, _options: DetectorOptions): Promise<DetectionResult> {
    return {
      contentType: 'audio',
      isAIGenerated: false,
      confidence: 'low',
      score: 0,
      source: 'local',
      details: 'Audio detection not yet supported.',
    };
  }
}
