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

const STYLE_ID = 'reality-check-styles';

const CSS_TEMPLATE = `
@keyframes rc-flash {
  0%   { opacity: var(--rc-opacity); }
  80%  { opacity: var(--rc-opacity); }
  100% { opacity: 0; }
}
@keyframes rc-pulse {
  0%   { opacity: var(--rc-opacity); }
  50%  { opacity: 0; }
  100% { opacity: var(--rc-opacity); }
}
@media (prefers-reduced-motion: reduce) {
  .rc-watermark { animation: none !important; }
  .rc-watermark.rc-mode-flash  { opacity: var(--rc-opacity); }
  .rc-watermark.rc-mode-pulse  { opacity: var(--rc-opacity); }
}
.rc-watermark {
  position: absolute;
  z-index: 2147483646;
  pointer-events: none;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.8vw, 22px);
  text-align: center;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  background: rgba(220,30,30,0.55);
  border: 2px solid rgba(255,60,60,0.8);
  border-radius: 6px;
  padding: 6px 12px;
  opacity: var(--rc-opacity);
  box-sizing: border-box;
  /* Never block interaction with the underlying element */
  pointer-events: none;
}
.rc-watermark.rc-mode-flash {
  animation: rc-flash var(--rc-anim-duration) ease forwards;
}
.rc-watermark.rc-mode-pulse {
  animation: rc-pulse var(--rc-pulse-freq) ease-in-out infinite;
}
.rc-watermark.rc-mode-auto-hide {
  transition: opacity 0.4s ease;
}
.rc-watermark.rc-hidden {
  opacity: 0 !important;
}
.rc-watermark .rc-badge {
  font-size: 0.7em;
  margin-top: 3px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.9;
}
/* Text highlight for inline AI-labelled spans */
.rc-text-highlight {
  background: rgba(255, 200, 0, 0.35);
  border-bottom: 2px solid rgba(220, 140, 0, 0.8);
  border-radius: 2px;
  position: relative;
  cursor: help;
}
.rc-text-badge {
  display: inline-block;
  font-size: 0.7em;
  font-weight: 700;
  background: rgba(220,140,0,0.9);
  color: #fff;
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 2px;
  vertical-align: super;
  line-height: 1.4;
  letter-spacing: 0.04em;
  cursor: help;
}
/* Wrapper for media elements that need an overlay */
.rc-media-wrapper {
  position: relative !important;
  display: inline-block !important;
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEMPLATE;
  (document.head ?? document.documentElement).appendChild(style);
}

function confidenceLabel(confidence: ConfidenceLevel): string {
  const map: Record<ConfidenceLevel, string> = {
    low: 'Low confidence',
    medium: 'Medium confidence',
    high: 'High confidence',
  };
  return map[confidence];
}

function positionWatermark(
  el: HTMLElement,
  wrapper: HTMLElement,
  position: WatermarkConfig['position']
): void {
  el.style.maxWidth = '90%';
  switch (position) {
    case 'top-left':
      el.style.top = '8px';
      el.style.left = '8px';
      el.style.bottom = '';
      el.style.right = '';
      el.style.transform = '';
      break;
    case 'top-right':
      el.style.top = '8px';
      el.style.right = '8px';
      el.style.bottom = '';
      el.style.left = '';
      el.style.transform = '';
      break;
    case 'bottom':
      el.style.bottom = '8px';
      el.style.left = '50%';
      el.style.top = '';
      el.style.right = '';
      el.style.transform = 'translateX(-50%)';
      break;
    default: // center
      el.style.top = '50%';
      el.style.left = '50%';
      el.style.bottom = '';
      el.style.right = '';
      el.style.transform = 'translate(-50%, -50%)';
  }
  // Suppress unused wrapper warning
  void wrapper;
}

/**
 * Determine whether the watermark would significantly obstruct the element.
 * If so, prefer flash or auto-hide.
 */
function shouldAutoFallback(
  element: HTMLElement,
  config: WatermarkConfig
): boolean {
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (area === 0) return false;
  // Watermark is roughly 200×60 px at most — check fraction
  const watermarkArea = Math.min(rect.width * 0.9, 220) * 60;
  return watermarkArea / area > config.obstructionThreshold;
}

function effectiveMode(element: HTMLElement, config: WatermarkConfig): WatermarkConfig['mode'] {
  if (config.mode === 'static' && shouldAutoFallback(element, config)) {
    return 'flash';
  }
  return config.mode;
}

/**
 * Wrap a media element (img/video) in a relative-positioned div
 * so the overlay can be positioned absolutely over it.
 * If already wrapped, reuses the existing wrapper.
 */
function ensureWrapper(media: HTMLElement): HTMLElement {
  const parent = media.parentElement;
  if (parent && parent.classList.contains('rc-media-wrapper')) {
    return parent;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'rc-media-wrapper';

  // Copy relevant styles to maintain layout
  const computed = getComputedStyle(media);
  wrapper.style.display = computed.display === 'block' ? 'block' : 'inline-block';

  media.parentNode?.insertBefore(wrapper, media);
  wrapper.appendChild(media);
  return wrapper;
}

export interface WatermarkHandle {
  /** Remove the watermark overlay and unwrap the element */
  remove(): void;
  /** Update the config (e.g. after user changes settings) */
  update(config: WatermarkConfig): void;
}

/**
 * Apply a watermark overlay to an image or video element.
 */
export function applyMediaWatermark(
  media: HTMLImageElement | HTMLVideoElement,
  confidence: ConfidenceLevel,
  config: WatermarkConfig
): WatermarkHandle {
  injectStyles();

  const wrapper = ensureWrapper(media);
  const mode = effectiveMode(media, config);

  const overlay = document.createElement('div');
  overlay.className = `rc-watermark rc-mode-${mode}`;
  overlay.setAttribute('aria-label', 'Likely AI-generated content');
  overlay.style.setProperty('--rc-opacity', String(config.opacity / 100));
  overlay.style.setProperty('--rc-anim-duration', `${config.animationDuration}ms`);
  overlay.style.setProperty('--rc-pulse-freq', `${config.pulseFrequency}ms`);

  overlay.textContent = '⚠ Likely AI Generated';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = confidenceLabel(confidence);
  overlay.appendChild(badge);

  positionWatermark(overlay, wrapper, config.position);
  wrapper.appendChild(overlay);

  if (mode === 'auto-hide') {
    // Show briefly, then hide; reveal on hover
    setTimeout(() => {
      overlay.classList.add('rc-hidden');
    }, config.animationDuration);

    wrapper.addEventListener('mouseenter', () => overlay.classList.remove('rc-hidden'));
    wrapper.addEventListener('mouseleave', () => overlay.classList.add('rc-hidden'));
  }

  return {
    remove() {
      overlay.remove();
      // Unwrap if we wrapped it
      if (wrapper.classList.contains('rc-media-wrapper') && wrapper.children.length === 1) {
        wrapper.parentNode?.insertBefore(media, wrapper);
        wrapper.remove();
      }
    },
    update(newConfig: WatermarkConfig) {
      overlay.remove();
      applyMediaWatermark(media, confidence, newConfig);
    },
  };
}

/**
 * Apply a green dev-mode banner to an image or video element.
 * Indicates that the watermarking pipeline is working — used during local testing.
 * Shows "DEV: Watermarking Active" instead of an AI verdict.
 */
export function applyDevModeWatermark(
  media: HTMLImageElement | HTMLVideoElement,
  config: WatermarkConfig
): WatermarkHandle {
  injectStyles();

  const wrapper = ensureWrapper(media);

  const overlay = document.createElement('div');
  overlay.className = 'rc-watermark rc-dev-mode';
  overlay.setAttribute('aria-label', 'Dev mode: watermarking active');
  overlay.style.setProperty('--rc-opacity', String(config.opacity / 100));
  // Green badge — clearly distinguishable from the production red
  overlay.style.background = 'rgba(20,160,60,0.75)';
  overlay.style.border = '2px solid rgba(50,220,90,0.9)';

  overlay.textContent = '🛠 DEV: Watermarking Active';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = 'Disable Dev Mode when done testing';
  overlay.appendChild(badge);

  positionWatermark(overlay, wrapper, config.position);
  wrapper.appendChild(overlay);

  return {
    remove() {
      overlay.remove();
      if (wrapper.classList.contains('rc-media-wrapper') && wrapper.children.length === 1) {
        wrapper.parentNode?.insertBefore(media, wrapper);
        wrapper.remove();
      }
    },
    update(newConfig: WatermarkConfig) {
      overlay.remove();
      applyDevModeWatermark(media, newConfig);
    },
  };
}

/**
 * Apply inline text highlighting to a paragraph or block element.
 * Wraps the inner text in a highlighted span with a badge and tooltip.
 */
export function applyTextWatermark(
  element: HTMLElement,
  confidence: ConfidenceLevel,
  _config: WatermarkConfig
): WatermarkHandle {
  injectStyles();

  const tooltip = `Likely AI-generated text. ${confidenceLabel(confidence)}. This is a probabilistic estimate and may be incorrect.`;

  const originalContent = element.innerHTML;
  const span = document.createElement('span');
  span.className = 'rc-text-highlight';
  span.title = tooltip;
  span.innerHTML = element.innerHTML;

  const badge = document.createElement('span');
  badge.className = 'rc-text-badge';
  badge.title = tooltip;
  badge.textContent = '~AI';

  element.innerHTML = '';
  element.appendChild(span);
  element.appendChild(badge);

  return {
    remove() {
      element.innerHTML = originalContent;
    },
    update(_newConfig: WatermarkConfig) {
      element.innerHTML = originalContent;
      applyTextWatermark(element, confidence, _newConfig);
    },
  };
}
