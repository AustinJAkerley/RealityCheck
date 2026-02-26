/**
 * Transformers.js adapter — wraps any Hugging Face Transformers.js
 * image-classification pipeline as an MlModelRunner, enabling real
 * neural-network AI-image detection entirely within a browser extension.
 *
 * ## Why Transformers.js?
 * Transformers.js (https://huggingface.co/docs/transformers.js) runs
 * quantised ONNX models via WebAssembly and WebGPU directly in the browser.
 * Compared to hand-crafted pixel features, a fine-tuned ViT achieves:
 *   • ~AUC 0.92 vs ~0.65 for the statistical nonescape-mini baseline
 *   • Handles modern latent-diffusion outputs (SDXL, FLUX, MidJourney)
 *   • No server round-trip — fully offline after the first model download
 *   • The model weight file (~5 MB int8-quantised) is cached in the browser
 *     IndexedDB / Cache API automatically by Transformers.js
 *
 * ## Recommended model
 * `Xenova/ai-image-detector` — a ViT-B/16 fine-tuned on a large balanced
 * dataset of real photos and AI-generated images (Stable Diffusion, DALL-E,
 * MidJourney, GAN variants).  It outputs two labels:
 *   • `'artificial'` — AI-generated
 *   • `'real'`       — real photograph
 *
 * ## Usage (extension startup / background script)
 * ```ts
 * import { pipeline } from '@xenova/transformers'; // v2
 * // or: import { pipeline } from '@huggingface/transformers'; // v3
 * import { registerTransformersjsModel } from '@reality-check/core';
 *
 * const pipe = await pipeline(
 *   'image-classification',
 *   'Xenova/ai-image-detector',
 *   { device: 'webgpu' }   // falls back to 'wasm' automatically
 * );
 * registerTransformersjsModel({ pipeline: pipe });
 * ```
 *
 * After this single call the extension uses real ViT inference for every image.
 * The `nonescape-mini` statistical model remains as the fallback when no
 * Transformers.js pipeline has been registered.
 *
 * ## Other compatible models
 * | Model | Labels | AUC | Notes |
 * |---|---|---|---|
 * | `Xenova/ai-image-detector` | artificial / real | ~0.92 | Default recommendation |
 * | `umm-maybe/AI-image-detector` | artificial / real | ~0.88 | Original unquantised |
 * | `Organika/sdxl-detector` | SDXL / real | ~0.93 | Specialised for SDXL |
 *
 * Pass `aiLabel` in the options if your chosen model uses a different
 * label for the AI class (e.g. `'SDXL'`, `'fake'`, `'generated'`).
 */

import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Single entry in a Transformers.js image-classification result array. */
export interface TransformersjsClassification {
  /** Class label, e.g. `'artificial'` or `'real'`. */
  label: string;
  /** Probability in [0, 1]. */
  score: number;
}

/**
 * Minimal interface compatible with the Transformers.js
 * `image-classification` pipeline object.
 *
 * Pass the real pipeline returned by `pipeline('image-classification', ...)`
 * here; the core package stays free of a direct Transformers.js dependency.
 */
export type TransformersjsPipeline = (
  input: unknown,
  options?: object
) => Promise<TransformersjsClassification[]>;

/**
 * Converts an RGBA pixel buffer into whatever format your Transformers.js
 * pipeline accepts as input.
 *
 * The default implementation (used when `toInput` is not provided) creates a
 * Blob URL via `OffscreenCanvas`, which works in any modern browser extension
 * context (background service workers, content scripts, side-panels).
 *
 * Provide a custom implementation when running in Node.js (e.g. for tests).
 */
export type TransformersjsInputConverter = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => Promise<unknown>;

/** Options for {@link createTransformersjsRunner}. */
export interface TransformersjsModelAdapterOptions {
  /**
   * Transformers.js image-classification pipeline instance.
   * See the module-level JSDoc for setup instructions.
   */
  pipeline: TransformersjsPipeline;

  /**
   * Label string that the model assigns to AI-generated images.
   * Default: `'artificial'` (correct for `Xenova/ai-image-detector`).
   * Set to `'SDXL'` for `Organika/sdxl-detector`, or `'fake'` / `'ai'`
   * for other models.
   */
  aiLabel?: string;

  /**
   * Custom pixel-buffer → pipeline-input converter.
   * The default uses `OffscreenCanvas` + `URL.createObjectURL`, which
   * requires a browser environment.
   * Override this to supply a mock or sharp/canvas path in tests / Node.js.
   */
  toInput?: TransformersjsInputConverter;
}

// ── Default browser pixel converter ──────────────────────────────────────────

/**
 * Default pixel converter for browser extension contexts.
 * Draws the RGBA buffer onto an `OffscreenCanvas`, encodes it to a PNG Blob,
 * and returns an object URL the Transformers.js pipeline can fetch.
 *
 * The caller is responsible for revoking the URL after inference
 * (handled internally by `createTransformersjsRunner`).
 */
async function rgbaToObjectUrl(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string> {
  // OffscreenCanvas is available in all modern browser contexts including
  // service workers and content scripts (Chrome 69+, Firefox 105+).
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[RealityCheck] Transformers.js adapter: OffscreenCanvas 2D context unavailable');
  }
  // Copy into a fresh Uint8ClampedArray to guarantee a plain ArrayBuffer backing.
  // TypeScript's ImageData constructor requires ArrayBuffer (not SharedArrayBuffer),
  // and the incoming data.buffer is typed as ArrayBufferLike.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return URL.createObjectURL(blob);
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Create an MlModelRunner that runs inference through the provided
 * Transformers.js image-classification pipeline.
 *
 * @example
 * ```ts
 * import { pipeline } from '@xenova/transformers';
 * const pipe = await pipeline('image-classification', 'Xenova/ai-image-detector');
 * const runner = createTransformersjsRunner({ pipeline: pipe });
 * registerMlModel(runner);
 * ```
 */
export function createTransformersjsRunner(
  options: TransformersjsModelAdapterOptions
): MlModelRunner {
  const {
    pipeline,
    aiLabel   = 'artificial',
    toInput   = rgbaToObjectUrl,
  } = options;

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      const input = await toInput(data, width, height);
      let blobUrl: string | undefined;

      // Track object URLs so we can revoke them after inference.
      if (typeof input === 'string' && input.startsWith('blob:')) {
        blobUrl = input;
      }

      try {
        const results = await pipeline(input);
        // Find the AI class entry; default to 0 if the label is absent.
        const aiEntry = results.find(
          (r) => r.label.toLowerCase() === aiLabel.toLowerCase()
        );
        return Math.max(0, Math.min(1, aiEntry?.score ?? 0));
      } finally {
        if (blobUrl !== undefined) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    },
  };
}

/**
 * Convenience wrapper: create a Transformers.js runner and immediately
 * register it as the active MlModelRunner.
 *
 * @example
 * ```ts
 * import { pipeline } from '@xenova/transformers';
 * import { registerTransformersjsModel } from '@reality-check/core';
 *
 * const pipe = await pipeline('image-classification', 'Xenova/ai-image-detector');
 * registerTransformersjsModel({ pipeline: pipe });
 * // From this point, the extension uses real ViT inference (AUC ~0.92).
 * ```
 */
export function registerTransformersjsModel(
  options: TransformersjsModelAdapterOptions
): void {
  registerMlModel(createTransformersjsRunner(options));
}
