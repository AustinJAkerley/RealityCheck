/**
 * Core types for the RealityCheck AI Content Watermarker.
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type ContentType = 'text' | 'image' | 'video';

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
 * Default hosted endpoint — our Azure-hosted AI classifier proxy.
 * Users do not need to provide an API key; the proxy authenticates the extension
 * via standard extension certificate verification.
 * Can be overridden in the Advanced settings for development purposes.
 */
export const DEFAULT_REMOTE_ENDPOINT = 'https://api.realitycheck.ai/v1/classify';

export interface DetectionResult {
  contentType: ContentType;
  isAIGenerated: boolean;
  confidence: ConfidenceLevel;
  /** 0–1 probability score */
  score: number;
  source: 'local' | 'remote';
  /** Set to true when the photorealism pre-filter determined the image is not photorealistic */
  skippedByPreFilter?: boolean;
  /**
   * Set to true when the local classifier score fell in the inconclusive zone [0.20, 0.65)
   * and remote classification was needed to reach a decision.
   * Useful in dev mode to surface which images required remote escalation.
   */
  localInconclusive?: boolean;
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
  remoteEnabled: true,
  detectionQuality: 'medium',
  remoteEndpoint: '',
  remoteApiKey: '',
  devMode: false,
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
}

export interface RemoteClassificationResult {
  score: number;
  label: string;
}
