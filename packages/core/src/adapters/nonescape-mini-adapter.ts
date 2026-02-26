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
  /** Mean luminance gradient magnitude (per-pixel rate, 0–1). Lower = smoother = more AI-like. */
  gradientMean: number;
  /** Population variance of luminance values (0–~0.25). */
  lumVariance: number;
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
      // Gradient smoothness: AI diffusion models produce smoother per-pixel
      // transitions than real cameras (which have sensor noise). Scale so that
      // a per-pixel luminance change of 1/16 = 0 (threshold), smoother = higher.
      const gradSmoothnessScore = Math.max(0, 1 - features.gradientMean * 16);

      // Luminance variance: AI images tend to have moderate exposure variance.
      // Very high variance (>0.14) is more common in high-contrast real photos.
      const lumVarScore = Math.max(0, 1 - Math.max(0, features.lumVariance - 0.04) / 0.10);

      // Bias reduced from -1.45 to -1.80 to compensate for the two new positive
      // features and to reduce over-confidence on vivid real photos.
      const linear =
        -1.80 +
        features.meanSat * 2.6 +
        (1 - features.satVar * 8) * 1.2 +
        (1 - Math.abs(features.meanLum - 0.5) * 2) * 0.9 +
        features.channelVarSimilarity * 0.7 +
        gradSmoothnessScore * 0.8 +
        lumVarScore * 0.4;
      const score = 1 / (1 + Math.exp(-linear));
      return Math.max(0, Math.min(1, score));
    },
  },
};

function classifyFromScore(score: number): number {
  // Calibrate away from hard binary outputs so uncertain samples can escalate
  // to remote ML in the cascade. Keep strong confidence near edges.
  if (score >= 0.9) return 0.95;
  if (score <= 0.1) return 0.05;
  return Math.max(0, Math.min(1, score));
}

function extractFeatures(data: Uint8ClampedArray, width: number, height: number): NonescapeModelFeatures {
  const pixelCount = data.length / 4;
  if (pixelCount === 0) {
    return { meanSat: 0, satVar: 0, meanLum: 0, channelVarSimilarity: 0, gradientMean: 0, lumVariance: 0 };
  }

  let satSum = 0;
  let satSqSum = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let rSum = 0, gSum = 0, bSum = 0;
  let rSqSum = 0, gSqSum = 0, bSqSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r8 = data[i], g8 = data[i + 1], b8 = data[i + 2];
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;

    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    satSum += sat;
    satSqSum += sat * sat;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    lumSum += lum;
    lumSqSum += lum * lum;

    rSum += r8; gSum += g8; bSum += b8;
    rSqSum += r8 * r8; gSqSum += g8 * g8; bSqSum += b8 * b8;
  }

  const meanSat = satSum / pixelCount;
  const satVar = Math.max(0, satSqSum / pixelCount - meanSat * meanSat);
  const meanLum = lumSum / pixelCount;
  const lumVariance = Math.max(0, lumSqSum / pixelCount - meanLum * meanLum);

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

  // Gradient mean: mean per-pixel luminance gradient magnitude.
  // Stride-sampled to cap computation at ≈128×128 points regardless of image size,
  // then divided by stride to obtain a per-pixel rate comparable across resolutions.
  const gStride = Math.max(1, Math.ceil(Math.max(width, height) / 128));
  let gradSum = 0;
  let gradCount = 0;
  for (let y = 0; y < height - gStride; y += gStride) {
    for (let x = 0; x < width - gStride; x += gStride) {
      const i0 = (y * width + x) * 4;
      const i1 = (y * width + x + gStride) * 4;       // right neighbour
      const i2 = ((y + gStride) * width + x) * 4;    // bottom neighbour
      // Luminance in 0–255 range (BT.601 coefficients × 1000 for integer arithmetic)
      const l0 = (data[i0] * 299 + data[i0 + 1] * 587 + data[i0 + 2] * 114) / 1000;
      const l1 = (data[i1] * 299 + data[i1 + 1] * 587 + data[i1 + 2] * 114) / 1000;
      const l2 = (data[i2] * 299 + data[i2 + 1] * 587 + data[i2 + 2] * 114) / 1000;
      // Divide by: 2 (average two directions) × gStride (per-pixel rate) × 255 (→ [0,1])
      gradSum += (Math.abs(l1 - l0) + Math.abs(l2 - l0)) / (2 * gStride * 255);
      gradCount++;
    }
  }
  const gradientMean = gradCount > 0 ? gradSum / gradCount : 0;

  return { meanSat, satVar, meanLum, channelVarSimilarity, gradientMean, lumVariance };
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
      const features = extractFeatures(data, width, height);
      const rawScore = await modelApi.predict({ data, width, height, features });
      return classifyFromScore(Math.max(0, Math.min(1, rawScore)));
    },
  };
}

export function registerNonescapeMiniModel(options: NonescapeMiniAdapterOptions = {}): void {
  registerMlModel(createNonescapeMiniRunner(options));
}
