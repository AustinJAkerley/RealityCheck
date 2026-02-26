/**
 * ONNX Runtime Web adapter — wraps any ONNX binary-classification model as an
 * MlModelRunner, enabling best-in-class local AI-image detection in browser
 * extensions without any JavaScript ML-framework lock-in.
 *
 * ## Why ONNX?
 * ONNX Runtime Web (https://onnxruntime.ai) runs ONNX models via WebAssembly
 * or WebGPU directly in the browser.  Any mainstream AI-detector model can be
 * exported to ONNX: EfficientNet, MobileNet, ViT, etc.  At inference time the
 * ONNX runtime is only ~2 MB (WASM backend) and the models below 5 MB when
 * quantised to int8.
 *
 * ## Recommended open-source models
 * The following have been evaluated for in-browser AI image detection and can
 * be exported to ONNX with the exporter scripts in `scripts/`:
 *
 * | Model | Size (int8 ONNX) | AUC | Notes |
 * |---|---|---|---|
 * | organika/sdxl-detector | ~9 MB | 0.92 | ViT fine-tuned on SDXL data |
 * | umm-maybe/AI-image-detector | ~5 MB | 0.88 | ResNet-based, broad coverage |
 * | custom EfficientNet-B0 | ~3 MB | 0.86 | Train on CIFAKE / ArtiFact datasets |
 *
 * ## Usage (extension startup)
 * ```ts
 * import * as ort from 'onnxruntime-web';
 * import { createOnnxModelRunner, registerMlModel } from '@reality-check/core';
 *
 * const session = await ort.InferenceSession.create(
 *   chrome.runtime.getURL('models/ai-detector.onnx'),
 *   { executionProviders: ['webgpu', 'wasm'] }
 * );
 * registerMlModel(createOnnxModelRunner({ session }));
 * ```
 *
 * The runner automatically:
 *  - Resizes pixel data to `inputWidth × inputHeight` (default 224×224) using
 *    area-averaging downscale.
 *  - Normalises each channel to [0, 1] or ImageNet statistics depending on
 *    `normalisation`.
 *  - Builds an input tensor in CHW or HWC layout depending on `inputLayout`.
 *  - Extracts the AI-class probability from the output tensor.
 */

import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Minimal subset of an ONNX Runtime Web InferenceSession that the adapter
 * needs.  Pass the real `ort.InferenceSession` instance here; the interface
 * lets the core package stay free of a direct onnxruntime-web dependency.
 */
export interface OnnxInferenceSession {
  /** Run inference. `feeds` maps input-tensor names to typed-array tensors. */
  run(
    feeds: Record<string, OnnxTensorLike>
  ): Promise<Record<string, OnnxTensorLike>>;
}

/** Minimal tensor representation compatible with ort.Tensor. */
export interface OnnxTensorLike {
  /** Flat typed array of tensor values in C-contiguous order. */
  data: Float32Array | Int8Array | Uint8Array | BigInt64Array | number[];
  /** Shape of the tensor, e.g. [1, 3, 224, 224]. */
  dims: readonly number[];
  /** ONNX data type string, e.g. 'float32'. */
  type?: string;
}

/** Input tensor memory layout produced by this adapter. */
export type OnnxInputLayout = 'CHW' | 'HWC';

/** Pixel normalisation strategy. */
export type OnnxNormalisation =
  | 'none'           // keep values in [0, 1]
  | 'imagenet';      // subtract ImageNet mean, divide by std

/** Options for createOnnxModelRunner(). */
export interface OnnxModelAdapterOptions {
  /**
   * Pre-created ONNX InferenceSession.
   * Obtain via `ort.InferenceSession.create(url)` from onnxruntime-web.
   */
  session: OnnxInferenceSession;

  /**
   * Name of the model's input tensor. Default: `'input'`.
   * Inspect with Netron (https://netron.app) if unsure.
   */
  inputName?: string;

  /**
   * Name of the model's output tensor. Default: `'output'`.
   */
  outputName?: string;

  /**
   * Width the model expects. Default: `224`.
   */
  inputWidth?: number;

  /**
   * Height the model expects. Default: `224`.
   */
  inputHeight?: number;

  /**
   * Memory layout: Channel-first (PyTorch / most ONNX exports) or
   * Channel-last (TF/Keras exports). Default: `'CHW'`.
   */
  inputLayout?: OnnxInputLayout;

  /**
   * Pixel normalisation applied before inference. Default: `'imagenet'`.
   *
   * - `'none'`    — values in [0, 1]
   * - `'imagenet'` — (value − mean) / std using ImageNet statistics
   *   mean=[0.485,0.456,0.406] std=[0.229,0.224,0.225]
   */
  normalisation?: OnnxNormalisation;

  /**
   * Index of the AI-class in the output tensor.
   *
   * For a binary [real, AI] softmax, set to `1` (default).
   * For a [AI, real] layout (e.g. some HuggingFace pipelines), set to `0`.
   * For a single-output sigmoid, set to `0`.
   */
  aiClassIndex?: number;

  /**
   * Optional score transform applied after index extraction.
   * Useful when the raw output is a logit rather than a probability.
   * Default: identity (no transform).
   */
  scoreTransform?: (raw: number) => number;
}

// ── ImageNet normalisation constants ─────────────────────────────────────────

const IMAGENET_MEAN = [0.485, 0.456, 0.406]; // R, G, B
const IMAGENET_STD  = [0.229, 0.224, 0.225];

// ── Downscale helper ──────────────────────────────────────────────────────────

/**
 * Area-average downscale from an arbitrary-size RGBA buffer to `dw × dh` RGB.
 * Returns a Float32Array in [0,1] range, R then G then B plane (CHW) or
 * interleaved (HWC), according to `layout`.
 *
 * The area-average approach avoids aliasing artefacts that would occur if we
 * simply sampled nearest-neighbour, preserving the low-frequency content that
 * most classification models rely on.
 */
function downscaleToFloat32(
  data: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  layout: OnnxInputLayout,
  normalisation: OnnxNormalisation
): Float32Array {
  const len = dstW * dstH * 3;
  const out = new Float32Array(len);

  const xScale = srcW / dstW;
  const yScale = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    // Source row range [y0, y1)
    const y0 = dy * yScale;
    const y1 = (dy + 1) * yScale;
    const rowStart = Math.floor(y0);
    const rowEnd   = Math.min(Math.ceil(y1), srcH);

    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * xScale;
      const x1 = (dx + 1) * xScale;
      const colStart = Math.floor(x0);
      const colEnd   = Math.min(Math.ceil(x1), srcW);

      let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

      for (let sy = rowStart; sy < rowEnd; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = colStart; sx < colEnd; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w  = wx * wy;
          const pi = (sy * srcW + sx) * 4;
          rSum += data[pi    ] * w;
          gSum += data[pi + 1] * w;
          bSum += data[pi + 2] * w;
          wSum += w;
        }
      }

      const invW = wSum > 0 ? 1 / (wSum * 255) : 0;
      let rv = rSum * invW;
      let gv = gSum * invW;
      let bv = bSum * invW;

      if (normalisation === 'imagenet') {
        rv = (rv - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        gv = (gv - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        bv = (bv - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
      }

      if (layout === 'CHW') {
        out[               dy * dstW + dx] = rv;
        out[    dstH * dstW + dy * dstW + dx] = gv;
        out[2 * dstH * dstW + dy * dstW + dx] = bv;
      } else {
        const base = (dy * dstW + dx) * 3;
        out[base    ] = rv;
        out[base + 1] = gv;
        out[base + 2] = bv;
      }
    }
  }

  return out;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Create an MlModelRunner that runs inference through the provided ONNX session.
 *
 * @example
 * ```ts
 * import * as ort from 'onnxruntime-web';
 * const session = await ort.InferenceSession.create(modelUrl, {
 *   executionProviders: ['webgpu', 'wasm'],
 * });
 * const runner = createOnnxModelRunner({ session });
 * registerMlModel(runner);
 * ```
 */
export function createOnnxModelRunner(options: OnnxModelAdapterOptions): MlModelRunner {
  const {
    session,
    inputName      = 'input',
    outputName     = 'output',
    inputWidth     = 224,
    inputHeight    = 224,
    inputLayout    = 'CHW',
    normalisation  = 'imagenet',
    aiClassIndex   = 1,
    scoreTransform = (x: number) => x,
  } = options;

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      const floatData = downscaleToFloat32(
        data, width, height,
        inputWidth, inputHeight,
        inputLayout, normalisation
      );

      const dims: number[] =
        inputLayout === 'CHW'
          ? [1, 3, inputHeight, inputWidth]
          : [1, inputHeight, inputWidth, 3];

      const feeds: Record<string, OnnxTensorLike> = {
        [inputName]: { data: floatData, dims, type: 'float32' },
      };

      const results = await session.run(feeds);
      const outputTensor = results[outputName];
      if (!outputTensor) {
        throw new Error(`[RealityCheck] ONNX: output tensor '${outputName}' not found`);
      }

      const rawScore = Number(outputTensor.data[aiClassIndex] ?? 0);
      return Math.max(0, Math.min(1, scoreTransform(rawScore)));
    },
  };
}

/**
 * Convenience wrapper: create an ONNX runner and immediately register it as the
 * active MlModelRunner.
 */
export function registerOnnxModel(options: OnnxModelAdapterOptions): void {
  registerMlModel(createOnnxModelRunner(options));
}
