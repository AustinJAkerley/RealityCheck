/**
 * Core types for the RealityCheck AI Content Watermarker.
 */
/**
 * Default hosted endpoint — our Azure-hosted AI classifier proxy.
 * Users do not need to provide an API key; the proxy authenticates the extension
 * via standard extension certificate verification.
 * Can be overridden in the Advanced settings for development purposes.
 */
export const DEFAULT_REMOTE_ENDPOINT = 'https://api.realitycheck.ai/v1/classify';
export const DEFAULT_WATERMARK_CONFIG = {
    mode: 'static',
    position: 'center',
    opacity: 70,
    animationDuration: 1500,
    pulseFrequency: 3000,
    obstructionThreshold: 0.5,
};
export const DEFAULT_SETTINGS = {
    globalEnabled: true,
    remoteEnabled: true,
    detectionQuality: 'medium',
    remoteEndpoint: '',
    remoteApiKey: '',
    watermark: DEFAULT_WATERMARK_CONFIG,
    siteSettings: {},
};
//# sourceMappingURL=types.js.map