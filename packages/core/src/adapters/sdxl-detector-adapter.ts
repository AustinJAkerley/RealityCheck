/**
 * Adapter for the Organika/sdxl-detector model hosted on HuggingFace.
 *
 * This adapter calls the HuggingFace Inference API with a JPEG-encoded image
 * and returns the probability that the image is AI-generated ("artificial").
 *
 * Model: https://huggingface.co/Organika/sdxl-detector
 *
 * The API returns an array of classification labels, e.g.:
 *   [{ "label": "artificial", "score": 0.97 }, { "label": "real", "score": 0.03 }]
 *
 * Usage (extension startup):
 * ```ts
 * import { registerSdxlDetector } from '@reality-check/core';
 * registerSdxlDetector({ apiToken: 'hf_...' });
 * ```
 */
import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

export interface SdxlDetectorOptions {
  /** HuggingFace API token. Optional for free-tier usage; required for higher rate limits. */
  apiToken?: string;
  /** Custom endpoint override. Defaults to the HuggingFace Inference API. */
  endpoint?: string;
  /**
   * Custom image encoder for testing.
   * When not provided, the built-in canvas-based JPEG encoder is used.
   * @internal
   */
  imageEncoder?: (
    data: Uint8ClampedArray,
    width: number,
    height: number
  ) => Promise<ArrayBuffer | null>;
}

export const SDXL_DETECTOR_ENDPOINT =
  'https://api-inference.huggingface.co/models/Organika/sdxl-detector';

/** Expected response shape from the HuggingFace image classification API. */
type HuggingFaceClassificationResult = Array<{ label: string; score: number }>;

/**
 * Encode RGBA pixel data as a JPEG byte array using the canvas API.
 * Returns null when the canvas API is unavailable or encoding fails.
 */
async function encodeAsJpeg(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<ArrayBuffer | null> {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (!dataUrl || !dataUrl.includes(',')) return null;
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.length > 0 ? bytes.buffer : null;
  } catch {
    return null;
  }
}

function classifyFromScore(score: number): number {
  // Calibrate away from hard binary outputs so uncertain samples can escalate
  // to remote ML in the cascade. Keep strong confidence near edges.
  if (score >= 0.9) return 0.95;
  if (score <= 0.1) return 0.05;
  return Math.max(0, Math.min(1, score));
}

export function createSdxlDetectorRunner(options: SdxlDetectorOptions = {}): MlModelRunner {
  const endpoint = options.endpoint ?? SDXL_DETECTOR_ENDPOINT;
  const apiToken = options.apiToken ?? '';
  const encode = options.imageEncoder ?? encodeAsJpeg;

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      try {
        const imageBytes = await encode(data, width, height);
        if (!imageBytes) return 0.5;

        const headers: Record<string, string> = {
          'Content-Type': 'image/jpeg',
        };
        if (apiToken) {
          headers['Authorization'] = `Bearer ${apiToken}`;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: imageBytes,
        });

        if (!response.ok) return 0.5;

        const results = (await response.json()) as HuggingFaceClassificationResult;
        const artificial = Array.isArray(results)
          ? results.find((r) => r.label === 'artificial')
          : null;
        const score = artificial ? Math.max(0, Math.min(1, artificial.score)) : 0.5;
        return classifyFromScore(score);
      } catch {
        return 0.5;
      }
    },
  };
}

export function registerSdxlDetector(options: SdxlDetectorOptions = {}): void {
  registerMlModel(createSdxlDetectorRunner(options));
}
