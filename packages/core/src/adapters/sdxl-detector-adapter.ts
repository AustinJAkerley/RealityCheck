/**
 * Adapter for the Organika/sdxl-detector model running locally via Transformers.js.
 *
 * On first call the model weights (~90 MB) are downloaded from HuggingFace Hub
 * and cached by the browser. All subsequent inference runs fully offline in
 * WebAssembly via ONNX Runtime Web — no per-image API call is made.
 *
 * Model: https://huggingface.co/Organika/sdxl-detector
 *
 * The model returns an array of classification labels, e.g.:
 *   [{ "label": "artificial", "score": 0.97 }, { "label": "real", "score": 0.03 }]
 *
 * Usage (extension startup):
 * ```ts
 * import { registerSdxlDetector } from '@reality-check/core';
 * registerSdxlDetector();
 * ```
 *
 * Custom model ID or test override:
 * ```ts
 * registerSdxlDetector({
 *   modelId: 'my-org/my-sdxl-classifier',
 *   classifier: async (image) => myClassify(image),
 * });
 * ```
 */
import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

export interface SdxlDetectorOptions {
  /** HuggingFace model ID. Defaults to 'Organika/sdxl-detector'. */
  modelId?: string;
  /**
   * Custom classifier function for testing or overriding the local pipeline.
   * When provided, the Transformers.js pipeline is not loaded.
   * @internal
   */
  classifier?: (image: unknown) => Promise<Array<{ label: string; score: number }>>;
}

export const SDXL_MODEL_ID = 'Organika/sdxl-detector';

type ClassificationResult = Array<{ label: string; score: number }>;
type Classifier = (image: unknown) => Promise<ClassificationResult>;

let cachedClassifierPromise: Promise<Classifier> | null = null;

/**
 * Lazily initialises the Transformers.js image-classification pipeline.
 * The model is downloaded from HuggingFace Hub on the first call and cached
 * in the browser's Cache API for subsequent offline use.
 *
 * Concurrency: the promise is assigned synchronously before any async work
 * begins, so all concurrent callers receive the same promise and the pipeline
 * is only built once.
 *
 * On failure the promise is cleared so the next call retries rather than
 * immediately re-throwing the same cached rejection.
 */
async function buildLocalClassifier(modelId: string): Promise<Classifier> {
  if (!cachedClassifierPromise) {
    cachedClassifierPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');

      // Chrome extension service workers do not have SharedArrayBuffer, so
      // ONNX Runtime's default multi-threaded WASM mode fails.  Force single-
      // threaded mode before the pipeline is created.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onnxEnv = (env.backends as any)?.onnx;
      if (onnxEnv) {
        onnxEnv.wasm ??= {};
        onnxEnv.wasm.numThreads = 1;
      }

      console.log('[RealityCheck] Loading SDXL model:', modelId);
      // The Transformers.js pipeline() overload for 'image-classification' returns
      // ImageClassificationPipeline, which is callable but typed as a complex union.
      // We cast to our simpler Classifier alias that captures the runtime contract.
      const p = await (pipeline('image-classification', modelId) as unknown as Promise<Classifier>);
      console.log('[RealityCheck] SDXL model loaded successfully');
      return p;
    })().catch((err: unknown) => {
      console.error('[RealityCheck] Failed to load SDXL model:', err instanceof Error ? err.message : err);
      cachedClassifierPromise = null; // allow retry on next call
      throw err;
    });
  }
  return cachedClassifierPromise;
}

function classifyFromScore(score: number): number {
  // Calibrate away from hard binary outputs so uncertain samples can escalate
  // to remote ML in the cascade. Keep strong confidence near edges.
  if (score >= 0.9) return 0.95;
  if (score <= 0.1) return 0.05;
  return Math.max(0, Math.min(1, score));
}

export function createSdxlDetectorRunner(options: SdxlDetectorOptions = {}): MlModelRunner {
  const modelId = options.modelId ?? SDXL_MODEL_ID;

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      try {
        let image: unknown;
        let classify: Classifier;

        if (options.classifier) {
          // Test path: injected classifier receives a plain data object; no WASM loaded.
          classify = options.classifier;
          image = { data, width, height };
        } else {
          // Production path: lazy-load Transformers.js and build a RawImage for the model.
          const { RawImage } = await import('@huggingface/transformers');
          classify = await buildLocalClassifier(modelId);
          image = new RawImage(data, width, height, 4);
        }

        const results = await classify(image);
        const artificial = Array.isArray(results)
          ? results.find((r) => r.label === 'artificial')
          : null;
        const score = artificial ? Math.max(0, Math.min(1, artificial.score)) : 0.5;
        return classifyFromScore(score);
      } catch (err) {
        console.error('[RealityCheck] SDXL inference error:', err instanceof Error ? err.message : err);
        return 0.5;
      }
    },
  };
}

export function registerSdxlDetector(options: SdxlDetectorOptions = {}): void {
  registerMlModel(createSdxlDetectorRunner(options));
}

/**
 * Proxy runner for content scripts.
 *
 * Content scripts are loaded by Chrome as classic scripts (not ES modules),
 * even when bundled with `format: 'esm'`. The `@huggingface/transformers`
 * library uses `import.meta.url` to locate ONNX Runtime WASM files, which
 * throws a SyntaxError at parse time in classic-script contexts.
 *
 * This proxy delegates inference to the background service worker (which IS
 * an ES module via `"type": "module"` in the manifest) via
 * `chrome.runtime.sendMessage`. It follows the same pattern as REMOTE_CLASSIFY.
 *
 * esbuild tree-shaking: because `detection-pipeline.ts` only imports this
 * function (not `createSdxlDetectorRunner`), `buildLocalClassifier` and the
 * dynamic `import('@huggingface/transformers')` are dropped from content
 * script bundles entirely.
 */
export function createSdxlDetectorProxyRunner(): MlModelRunner {
  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const send = (globalThis as any).chrome?.runtime?.sendMessage as
          | ((msg: unknown) => Promise<unknown>)
          | undefined;
        if (!send) return 0.5;
        const response = (await send({
          type: 'SDXL_CLASSIFY',
          payload: { data, width, height },
        })) as { ok: boolean; score: number } | undefined;
        return response?.ok && typeof response.score === 'number' ? response.score : 0.5;
      } catch (err) {
        console.error('[RealityCheck] SDXL_CLASSIFY proxy error:', err instanceof Error ? err.message : err);
        return 0.5;
      }
    },
  };
}

export function registerSdxlDetectorProxy(): void {
  registerMlModel(createSdxlDetectorProxyRunner());
}
