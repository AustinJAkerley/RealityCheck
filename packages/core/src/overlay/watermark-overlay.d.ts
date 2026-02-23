/**
 * Watermark overlay renderer.
 *
 * Supports four modes:
 *  - static:    Overlay always visible.
 *  - flash:     Overlay appears briefly then fades out.
 *  - pulse:     Overlay fades in/out on a slow interval.
 *  - auto-hide: Overlay visible briefly, then hidden until hover.
 *
 * Uses CSS animations instead of JS timers wherever possible.
 * Respects prefers-reduced-motion.
 * Never intercepts pointer events (pointer-events: none).
 */
import type { ConfidenceLevel, WatermarkConfig } from '../types.js';
export interface WatermarkHandle {
    /** Remove the watermark overlay and unwrap the element */
    remove(): void;
    /** Update the config (e.g. after user changes settings) */
    update(config: WatermarkConfig): void;
}
/**
 * Apply a watermark overlay to an image or video element.
 */
export declare function applyMediaWatermark(media: HTMLImageElement | HTMLVideoElement, confidence: ConfidenceLevel, config: WatermarkConfig): WatermarkHandle;
/**
 * Apply inline text highlighting to a paragraph or block element.
 * Wraps the inner text in a highlighted span with a badge and tooltip.
 */
export declare function applyTextWatermark(element: HTMLElement, confidence: ConfidenceLevel, _config: WatermarkConfig): WatermarkHandle;
//# sourceMappingURL=watermark-overlay.d.ts.map