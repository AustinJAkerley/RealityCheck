/**
 * Core types for the RealityCheck AI Content Watermarker.
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type ContentType = 'text' | 'image' | 'video' | 'audio';

export type WatermarkMode = 'static' | 'flash' | 'pulse' | 'auto-hide';

export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom';

/**
 * Three-tier local classification quality setting.
 * - low:    Canvas heuristics only (color histogram, unique color count, edge analysis).
 *           Near-zero performance impact.
 * - medium: Low tier + gradient smoothness, block noise/texture, saturation distribution.
 *           Balanced cost/accuracy (default).
 * - high:   Medium tier + bundled ML model (TensorFlow.js / ONNX Runtime Web).
 *           Most accurate; requires modern hardware.
 */
export type DetectionQuality = 'low' | 'medium' | 'high';

/**
 * Default remote endpoint — the hackathon Azure OpenAI APIM gateway.
 * Extensions call this endpoint directly for AI classification.
 * The endpoint includes the /openai path; deployment and api-version
 * are appended by AzureOpenAIAdapter.
 * Can be overridden in the Advanced settings for development purposes.
 */
export const DEFAULT_REMOTE_ENDPOINT = 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai';

export interface DetectionResult {
  contentType: ContentType;
  isAIGenerated: boolean;
  confidence: ConfidenceLevel;
  /** 0–1 probability score */
  score: number;
  source: 'local' | 'remote';
  /** Set to true when the photorealism pre-filter determined the image is not photorealistic */
  skippedByPreFilter?: boolean;
  details?: string;
}

/**
 * Result of the photorealism pre-filter.
 * Indicates whether the image is likely photorealistic and worth further analysis.
 */
export interface PhotorealismResult {
  isPhotorealistic: boolean;
  /** 0–1 score; higher = more photorealistic */
  score: number;
}

export interface DetectorOptions {
  /** Whether to call the remote classifier. Defaults to true. */
  remoteEnabled: boolean;
  /** Detection quality tier — controls pre-filter depth. Default: 'medium'. */
  detectionQuality: DetectionQuality;
  /**
   * Remote endpoint override. When omitted, DEFAULT_REMOTE_ENDPOINT is used.
   * Only needed for advanced/development use.
   */
  remoteEndpoint?: string;
  /**
   * API key for the remote endpoint. Required when using Azure OpenAI directly.
   * When omitted, no auth header is sent.
   */
  remoteApiKey?: string;
  /**
   * Callback to perform remote classification via the background service worker.
   *
   * This is the single code path for all remote API calls. Content scripts
   * must provide this callback to route requests through the CORS-free
   * background context. When `remoteEnabled` is true but this callback is
   * not set, remote classification is skipped (falls back to local score).
   *
   * The callback receives the endpoint URL, API key, content type, and payload,
   * and must return the classification result.
   */
  remoteClassify?: (
    endpoint: string,
    apiKey: string,
    contentType: ContentType,
    payload: RemotePayload
  ) => Promise<RemoteClassificationResult>;
  /**
   * Optional callback to fetch raw image bytes as a base64 data URL.
   *
   * Direct `fetch()` from a content script is subject to CORS restrictions,
   * meaning EXIF and C2PA metadata analysis silently fails for cross-origin images.
   * Providing this callback (e.g. via a browser-extension background service worker
   * that is not CORS-restricted) allows the detector to read the original image binary.
   *
   * Example (Chrome extension content script):
   * ```ts
   * fetchBytes: (url) => new Promise((resolve) => {
   *   chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BYTES', payload: url },
   *     (resp) => resolve(resp?.ok ? resp.dataUrl : null));
   * })
   * ```
   */
  fetchBytes?: (url: string) => Promise<string | null>;
}

export interface WatermarkConfig {
  mode: WatermarkMode;
  position: WatermarkPosition;
  /** 0–100 */
  opacity: number;
  /** Animation duration in ms */
  animationDuration: number;
  /** Pulse frequency in ms (for pulse mode) */
  pulseFrequency: number;
  /** If the watermark covers more than this fraction of the element, switch to flash/auto-hide */
  obstructionThreshold: number;
}

export interface SiteSettings {
  enabled: boolean;
}

export interface ExtensionSettings {
  globalEnabled: boolean;
  /** Whether to call the remote classifier. Defaults to true. */
  remoteEnabled: boolean;
  /** Local classification quality tier. Default: 'medium'. */
  detectionQuality: DetectionQuality;
  /**
   * Remote endpoint override (advanced/dev only). Empty string = use DEFAULT_REMOTE_ENDPOINT.
   */
  remoteEndpoint: string;
  /**
   * API key for custom remote endpoints (advanced/dev only). Not needed for the default endpoint.
   */
  remoteApiKey: string;
  /**
   * Dev mode: when true, every image and video is immediately watermarked with a green
   * "DEV: Watermarking Active" overlay, bypassing detection entirely.
   * Default: false. Keep this OFF in production.
   */
  devMode: boolean;
  /** Whether to scan text for AI-generated content. Default: false. */
  textScanEnabled: boolean;
  watermark: WatermarkConfig;
  siteSettings: Record<string, SiteSettings>;
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  mode: 'static',
  position: 'center',
  opacity: 70,
  animationDuration: 1500,
  pulseFrequency: 3000,
  obstructionThreshold: 0.5,
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  globalEnabled: true,
  remoteEnabled: false,
  detectionQuality: 'high',
  remoteEndpoint: '',
  remoteApiKey: '',
  devMode: true,
  textScanEnabled: false,
  watermark: DEFAULT_WATERMARK_CONFIG,
  siteSettings: {},
};

export interface Detector {
  readonly contentType: ContentType;
  detect(content: string | HTMLElement, options: DetectorOptions): Promise<DetectionResult>;
}

export interface RemoteAdapter {
  classify(contentType: ContentType, payload: RemotePayload): Promise<RemoteClassificationResult>;
}

export interface RemotePayload {
  text?: string;
  imageDataUrl?: string;
  imageHash?: string;
  /** Original image URL — used as a fallback by vision-capable adapters when imageDataUrl is unavailable (e.g. cross-origin canvas taint). */
  imageUrl?: string;
}

export interface RemoteClassificationResult {
  score: number;
  label: string;
}

/**
 * Interface for plugging in an on-device ML model runner (ONNX / TF.js).
 * Implement this interface and register it with `registerMlModel()` in
 * `image-detector.ts` to enable High-tier local inference.
 */
export interface MlModelRunner {
  /**
   * Run inference on a 64×64 RGBA pixel buffer.
   * @param data   Flat RGBA pixel buffer (length = width * height * 4)
   * @param width  Image width in pixels
   * @param height Image height in pixels
   * @returns Promise resolving to a 0–1 probability of AI generation
   */
  run(data: Uint8ClampedArray, width: number, height: number): Promise<number>;
}

/**
 * User feedback report for a false positive or missed AI detection.
 * Wire this up to a backend endpoint or telemetry sink to improve future accuracy.
 */
export interface FeedbackReport {
  contentType: ContentType;
  feedback: 'false_positive' | 'missed_ai';
  /** URL of the content that was misclassified, if available */
  url?: string;
  /** The score that was returned by the detector */
  detectorScore?: number;
  /** Unix timestamp (ms) when the feedback was submitted */
  timestamp: number;
}
