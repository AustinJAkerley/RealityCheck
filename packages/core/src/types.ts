/**
 * Core types for the RealityCheck AI Content Watermarker.
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type ContentType = 'text' | 'image' | 'video';

export type WatermarkMode = 'static' | 'flash' | 'pulse' | 'auto-hide';

export type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom';

export interface DetectionResult {
  contentType: ContentType;
  isAIGenerated: boolean;
  confidence: ConfidenceLevel;
  /** 0–1 probability score */
  score: number;
  source: 'local' | 'remote';
  details?: string;
}

export interface DetectorOptions {
  /** If true, never make network calls */
  localOnly: boolean;
  /** Remote API endpoint (if not localOnly) */
  remoteEndpoint?: string;
  /** API key for the remote provider */
  remoteApiKey?: string;
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
  localOnly: boolean;
  remoteEndpoint: string;
  remoteApiKey: string;
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
  localOnly: true,
  remoteEndpoint: '',
  remoteApiKey: '',
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
