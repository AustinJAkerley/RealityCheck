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
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: none;
  /* Semi-transparent red with white halo — legible on any background */
  color: rgba(210, 30, 30, 0.72);
  text-shadow:
    0 0 8px rgba(255, 255, 255, 0.95),
    0 0 16px rgba(255, 255, 255, 0.55),
    1px 1px 3px rgba(0, 0, 0, 0.45);
  background: none;
  border: none;
  padding: 0;
  opacity: var(--rc-opacity);
  white-space: nowrap;
  /* Diagonal: centred on the element by default (overridden per position) */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-40deg);
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
  display: block;
  font-size: 0.5em;
  margin-top: 2px;
  font-weight: 400;
  letter-spacing: 0.04em;
  opacity: 0.80;
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

/**
 * Adjust the anchor point of the diagonal watermark based on the position setting.
 * CSS handles the rotation; this sets top/left percentage on the wrapper.
 */
function positionWatermark(
  el: HTMLElement,
  position: WatermarkConfig['position']
): void {
  switch (position) {
    case 'top-left':
      el.style.top = '28%';
      el.style.left = '32%';
      break;
    case 'top-right':
      el.style.top = '28%';
      el.style.left = '68%';
      break;
    case 'bottom':
      el.style.top = '72%';
      el.style.left = '50%';
      break;
    default: // center — CSS default (top:50%, left:50%)
      el.style.top = '50%';
      el.style.left = '50%';
  }
}

/**
 * Set font size as a fraction of the shorter element dimension so the
 * diagonal text scales with the image and never consumes the whole visual.
 * Falls back to intrinsic dimensions when the element is off-screen.
 */
function setDiagonalFontSize(
  overlay: HTMLElement,
  media: HTMLImageElement | HTMLVideoElement,
  wrapper: HTMLElement
): void {
  const w =
    wrapper.offsetWidth ||
    (media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth) ||
    0;
  const h =
    wrapper.offsetHeight ||
    (media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight) ||
    0;
  const minDim = Math.min(w, h);
  // ≈ 9% of the shorter dimension; clamped to a readable 12–56 px range
  const px = minDim > 0 ? Math.max(12, Math.min(56, Math.round(minDim * 0.09))) : 18;
  overlay.style.fontSize = `${px}px`;
}

/**
 * Determine whether the watermark would significantly obstruct the element.
 * The diagonal text-only mark is far less obstructive than a box, so the
 * threshold is only triggered for very tiny images.
 */
function shouldAutoFallback(
  element: HTMLElement,
  config: WatermarkConfig
): boolean {
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (area === 0) return false;
  // Text-only diagonal watermark occupies roughly 15% of total area — only
  // fall back to flash/auto-hide when the image is smaller than the threshold.
  const estimatedTextArea = rect.width * 0.6 * 20; // width × approx text height
  return estimatedTextArea / area > config.obstructionThreshold;
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
 * Apply a diagonal watermark overlay to an image or video element.
 * Styled like a stock-photo watermark: semi-transparent red diagonal text,
 * sized proportionally to the element so it never covers the whole image.
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
  overlay.setAttribute('role', 'img');
  overlay.style.setProperty('--rc-opacity', String(config.opacity / 100));
  overlay.style.setProperty('--rc-anim-duration', `${config.animationDuration}ms`);
  overlay.style.setProperty('--rc-pulse-freq', `${config.pulseFrequency}ms`);

  // Font size proportional to image dimensions (never covers the whole image)
  setDiagonalFontSize(overlay, media, wrapper);

  overlay.textContent = 'Likely AI-Generated';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = confidenceLabel(confidence);
  overlay.appendChild(badge);

  positionWatermark(overlay, config.position);
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
 * Apply a green diagonal dev-mode watermark to an image or video element.
 * Shows "Not AI Generated" to confirm the watermarking pipeline is active
 * during local testing. Visually identical in style to the production mark
 * but green rather than red.
 *
 * When `localInconclusive` is true the badge also reports that the local
 * classifier was uncertain and remote escalation was triggered, so developers
 * can identify which images fell into the inconclusive zone.
 */
export function applyDevModeWatermark(
  media: HTMLImageElement | HTMLVideoElement,
  config: WatermarkConfig,
  localInconclusive?: boolean
): WatermarkHandle {
  injectStyles();

  const wrapper = ensureWrapper(media);

  const overlay = document.createElement('div');
  overlay.className = 'rc-watermark rc-dev-mode';
  overlay.setAttribute('aria-label', 'Dev mode: pipeline active');
  overlay.setAttribute('role', 'img');
  overlay.style.setProperty('--rc-opacity', String(config.opacity / 100));
  // Green — clearly distinguishable from the production red
  overlay.style.color = 'rgba(20, 160, 60, 0.80)';
  overlay.style.textShadow =
    '0 0 8px rgba(255,255,255,0.95), 0 0 14px rgba(255,255,255,0.5), 1px 1px 3px rgba(0,0,0,0.4)';

  // Font size proportional to image dimensions
  setDiagonalFontSize(overlay, media, wrapper);

  overlay.textContent = 'Not AI Generated';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = localInconclusive
    ? 'Dev · Local Inconclusive → Remote'
    : 'Dev Mode — disable before shipping';
  overlay.appendChild(badge);

  positionWatermark(overlay, config.position);
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
      applyDevModeWatermark(media, newConfig, localInconclusive);
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
