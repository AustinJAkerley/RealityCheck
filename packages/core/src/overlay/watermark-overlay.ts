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
 *
 * Design note: overlays are appended to document.body with position:fixed and
 * tracked via a single shared scroll/resize listener. This avoids wrapping
 * media elements in container divs, which would tear them out of flex/grid
 * layouts (e.g. LinkedIn's feed) and cause them to disappear.
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
  .rc-watermark-label { animation: none !important; }
  .rc-watermark-label.rc-mode-flash { opacity: var(--rc-opacity); }
  .rc-watermark-label.rc-mode-pulse { opacity: var(--rc-opacity); }
}
/* Outer container: covers the media element exactly, sits on document.body */
.rc-watermark {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* Inner label: the diagonal text */
.rc-watermark-label {
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
  transform: rotate(-40deg);
}
.rc-watermark-label.rc-mode-flash {
  animation: rc-flash var(--rc-anim-duration) ease forwards;
}
.rc-watermark-label.rc-mode-pulse {
  animation: rc-pulse var(--rc-pulse-freq) ease-in-out infinite;
}
.rc-watermark-label.rc-hidden {
  opacity: 0 !important;
  transition: opacity 0.4s ease;
}
.rc-watermark-label .rc-badge {
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
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEMPLATE;
  (document.head ?? document.documentElement).appendChild(style);
}

// ── Shared position tracker ───────────────────────────────────────────────────
// One scroll/resize listener serves all active overlays, avoiding the
// performance cost of per-overlay listeners.

const _positionUpdaters = new Set<() => void>();
let _trackingListenerAttached = false;

function _attachTrackingListeners(): void {
  if (_trackingListenerAttached) return;
  const update = (): void => { _positionUpdaters.forEach((fn) => fn()); };
  // capture:true so we see scroll events from any scrollable container, not
  // just the window scroll, allowing overlays to track inside scrollable divs.
  document.addEventListener('scroll', update, { passive: true, capture: true });
  window.addEventListener('resize', update, { passive: true });
  _trackingListenerAttached = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function confidenceLabel(confidence: ConfidenceLevel): string {
  const map: Record<ConfidenceLevel, string> = {
    low: 'Low confidence',
    medium: 'Medium confidence',
    high: 'High confidence',
  };
  return map[confidence];
}

/**
 * Compute font size proportional to the media element's rendered size.
 * ≈ 9% of the shorter dimension; clamped to a readable 12–56 px range.
 */
function labelFontSize(rect: DOMRect): number {
  const minDim = Math.min(rect.width, rect.height);
  return minDim > 0 ? Math.max(12, Math.min(56, Math.round(minDim * 0.09))) : 18;
}

/**
 * Return the flex-alignment style values that correspond to the position config.
 * Used to anchor the diagonal label within the fixed container.
 */
function flexAlignment(position: WatermarkConfig['position']): {
  alignItems: string;
  justifyContent: string;
} {
  switch (position) {
    case 'top-left':   return { alignItems: 'flex-start', justifyContent: 'flex-start' };
    case 'top-right':  return { alignItems: 'flex-start', justifyContent: 'flex-end' };
    case 'bottom':     return { alignItems: 'flex-end',   justifyContent: 'center' };
    default:           return { alignItems: 'center',     justifyContent: 'center' };
  }
}

/**
 * Should we flash instead of stay static? Switch to flash when the overlay
 * would cover more than obstructionThreshold of the element area.
 */
function shouldAutoFallback(rect: DOMRect, config: WatermarkConfig): boolean {
  const area = rect.width * rect.height;
  if (area === 0) return false;
  const estimatedTextArea = rect.width * 0.6 * 20;
  return estimatedTextArea / area > config.obstructionThreshold;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface WatermarkHandle {
  /** Remove the watermark overlay */
  remove(): void;
  /** Update the config (e.g. after user changes settings) */
  update(config: WatermarkConfig): void;
}

/**
 * Apply a diagonal watermark overlay to an image or video element.
 *
 * The overlay is appended to document.body with position:fixed, so the
 * media element's DOM position is never modified. This prevents layout
 * breakage on sites that use flex/grid containers (e.g. LinkedIn's feed).
 */
export function applyMediaWatermark(
  media: HTMLImageElement | HTMLVideoElement,
  confidence: ConfidenceLevel,
  config: WatermarkConfig
): WatermarkHandle {
  injectStyles();
  _attachTrackingListeners();

  // Outer container — covers the media element, lives on document.body
  const container = document.createElement('div');
  container.className = 'rc-watermark';
  container.setAttribute('aria-label', 'Likely AI-generated content');
  container.setAttribute('role', 'img');
  container.style.setProperty('--rc-anim-duration', `${config.animationDuration}ms`);
  container.style.setProperty('--rc-pulse-freq', `${config.pulseFrequency}ms`);

  // Inner label — the diagonal text
  const label = document.createElement('div');
  label.style.setProperty('--rc-opacity', String(config.opacity / 100));
  label.textContent = 'Likely AI-Generated';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = confidenceLabel(confidence);
  label.appendChild(badge);
  container.appendChild(label);
  document.body.appendChild(container);

  function updatePosition(): void {
    const rect = media.getBoundingClientRect();
    container.style.top    = `${rect.top}px`;
    container.style.left   = `${rect.left}px`;
    container.style.width  = `${rect.width}px`;
    container.style.height = `${rect.height}px`;

    const mode = config.mode === 'static' && shouldAutoFallback(rect, config)
      ? 'flash'
      : config.mode;
    label.className = `rc-watermark-label rc-mode-${mode}`;

    const { alignItems, justifyContent } = flexAlignment(config.position);
    container.style.alignItems   = alignItems;
    container.style.justifyContent = justifyContent;

    label.style.fontSize = `${labelFontSize(rect)}px`;
  }

  updatePosition();
  _positionUpdaters.add(updatePosition);

  if (config.mode === 'auto-hide') {
    setTimeout(() => label.classList.add('rc-hidden'), config.animationDuration);
    // pointer-events:none on the container means we listen on the media element
    media.addEventListener('mouseenter', () => label.classList.remove('rc-hidden'));
    media.addEventListener('mouseleave', () => label.classList.add('rc-hidden'));
  }

  return {
    remove() {
      container.remove();
      _positionUpdaters.delete(updatePosition);
    },
    update(newConfig: WatermarkConfig) {
      container.remove();
      _positionUpdaters.delete(updatePosition);
      applyMediaWatermark(media, confidence, newConfig);
    },
  };
}

/**
 * Apply a green diagonal dev-mode watermark to an image or video element.
 *
 * Shows "DEV MODE — Pipeline Active" to confirm the watermarking pipeline is
 * working during local testing. Green colour distinguishes it from the
 * production red watermark. Same body-level fixed approach as applyMediaWatermark.
 */
export function applyDevModeWatermark(
  media: HTMLImageElement | HTMLVideoElement,
  config: WatermarkConfig
): WatermarkHandle {
  injectStyles();
  _attachTrackingListeners();

  const container = document.createElement('div');
  container.className = 'rc-watermark';
  container.setAttribute('aria-label', 'Dev mode: pipeline active');
  container.setAttribute('role', 'img');

  const label = document.createElement('div');
  label.className = 'rc-watermark-label rc-dev-mode';
  label.style.setProperty('--rc-opacity', String(config.opacity / 100));
  // Green — clearly distinguishable from the production red
  label.style.color = 'rgba(20, 160, 60, 0.80)';
  label.style.textShadow =
    '0 0 8px rgba(255,255,255,0.95), 0 0 14px rgba(255,255,255,0.5), 1px 1px 3px rgba(0,0,0,0.4)';
  label.textContent = 'DEV MODE — Pipeline Active';

  const badge = document.createElement('div');
  badge.className = 'rc-badge';
  badge.textContent = 'Disable before shipping';
  label.appendChild(badge);
  container.appendChild(label);
  document.body.appendChild(container);

  function updatePosition(): void {
    const rect = media.getBoundingClientRect();
    container.style.top    = `${rect.top}px`;
    container.style.left   = `${rect.left}px`;
    container.style.width  = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
    label.style.fontSize   = `${labelFontSize(rect)}px`;
  }

  updatePosition();
  _positionUpdaters.add(updatePosition);

  return {
    remove() {
      container.remove();
      _positionUpdaters.delete(updatePosition);
    },
    update(newConfig: WatermarkConfig) {
      container.remove();
      _positionUpdaters.delete(updatePosition);
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
