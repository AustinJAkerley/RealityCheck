import type { MlModelRunner } from '../types.js';
import { registerMlModel } from '../detectors/image-detector.js';

export interface NonescapeModelApi {
  predict(input: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    features: NonescapeModelFeatures;
  }): number | Promise<number>;
}

export interface NonescapeModelFeatures {
  meanSat: number;
  satVar: number;
  meanLum: number;
  channelVarSimilarity: number;
}

export interface NonescapeMiniAdapterOptions {
  /** Model profile key. Defaults to 'nonescape-mini'. */
  model?: string;
  /**
   * Optional model API implementation.
   * Pass this to swap in a new bundled model runtime without changing detector code.
   */
  api?: NonescapeModelApi;
}

const DEFAULT_MODEL_NAME = 'nonescape-mini';

const builtInModels: Record<string, NonescapeModelApi> = {
  'nonescape-mini': {
    predict({ features }): number {
      // Tiny bundled logistic profile for extension-safe inference.
      const linear =
        -1.45 +
        features.meanSat * 2.6 +
        (1 - features.satVar * 8) * 1.2 +
        (1 - Math.abs(features.meanLum - 0.5) * 2) * 0.9 +
        features.channelVarSimilarity * 0.7;
      const score = 1 / (1 + Math.exp(-linear));
      return Math.max(0, Math.min(1, score));
    },
  },
};

function extractFeatures(data: Uint8ClampedArray): NonescapeModelFeatures {
  const pixelCount = data.length / 4;
  if (pixelCount === 0) {
    return { meanSat: 0, satVar: 0, meanLum: 0, channelVarSimilarity: 0 };
  }

  let satSum = 0;
  let satSqSum = 0;
  let lumSum = 0;
  let rSum = 0, gSum = 0, bSum = 0;
  let rSqSum = 0, gSqSum = 0, bSqSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r8 = data[i], g8 = data[i + 1], b8 = data[i + 2];
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;

    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    satSum += sat;
    satSqSum += sat * sat;
    lumSum += r * 0.299 + g * 0.587 + b * 0.114;

    rSum += r8; gSum += g8; bSum += b8;
    rSqSum += r8 * r8; gSqSum += g8 * g8; bSqSum += b8 * b8;
  }

  const meanSat = satSum / pixelCount;
  const satVar = Math.max(0, satSqSum / pixelCount - meanSat * meanSat);
  const meanLum = lumSum / pixelCount;

  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;
  const rVar = Math.max(0, rSqSum / pixelCount - rMean * rMean);
  const gVar = Math.max(0, gSqSum / pixelCount - gMean * gMean);
  const bVar = Math.max(0, bSqSum / pixelCount - bMean * bMean);
  const varMean = (rVar + gVar + bVar) / 3;
  const channelVarSimilarity =
    varMean > 0
      ? Math.max(
          0,
          Math.min(
            1,
            1 -
              (Math.abs(rVar - varMean) + Math.abs(gVar - varMean) + Math.abs(bVar - varMean)) /
                (3 * varMean)
          )
        )
      : 1;

  return { meanSat, satVar, meanLum, channelVarSimilarity };
}

function resolveModelApi(options: NonescapeMiniAdapterOptions): NonescapeModelApi {
  if (options.api) return options.api;
  const selectedModel = options.model ?? DEFAULT_MODEL_NAME;
  return builtInModels[selectedModel] ?? builtInModels[DEFAULT_MODEL_NAME];
}

export function createNonescapeMiniRunner(
  options: NonescapeMiniAdapterOptions = {}
): MlModelRunner {
  const modelApi = resolveModelApi(options);

  return {
    async run(data: Uint8ClampedArray, width: number, height: number): Promise<number> {
      const features = extractFeatures(data);
      const rawScore = await modelApi.predict({ data, width, height, features });
      return Math.max(0, Math.min(1, rawScore));
    },
  };
}

export function registerNonescapeMiniModel(options: NonescapeMiniAdapterOptions = {}): void {
  registerMlModel(createNonescapeMiniRunner(options));
}
