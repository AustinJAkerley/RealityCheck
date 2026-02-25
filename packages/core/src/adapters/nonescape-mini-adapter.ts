import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:8765';
const DEFAULT_MODEL_NAME = 'nonescape-mini';
const DEFAULT_CLASSIFY_PATH = '/v1/classify/image';

export interface NonescapeMiniAdapterOptions {
  endpoint?: string;
  model?: string;
  path?: string;
  fetchImpl?: typeof fetch;
}

function toBase64(data: Uint8ClampedArray): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

export function createNonescapeMiniRunner(
  options: NonescapeMiniAdapterOptions = {}
): MlModelRunner {
  const endpoint = options.endpoint ?? DEFAULT_LOCAL_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL_NAME;
  const path = options.path ?? DEFAULT_CLASSIFY_PATH;

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      const fetchImpl =
        options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (!fetchImpl) {
        throw new Error('fetch is not available for Nonescape mini adapter');
      }
      const response = await fetchImpl(`${endpoint}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          width,
          height,
          pixelsBase64: toBase64(data),
        }),
      });

      if (!response.ok) {
        throw new Error(`Nonescape mini adapter HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { score?: number; aiScore?: number };
      const rawScore =
        typeof payload.score === 'number'
          ? payload.score
          : typeof payload.aiScore === 'number'
            ? payload.aiScore
            : 0;
      return Math.max(0, Math.min(1, rawScore));
    },
  };
}

export function registerNonescapeMiniModel(options: NonescapeMiniAdapterOptions = {}): void {
  registerMlModel(createNonescapeMiniRunner(options));
}
