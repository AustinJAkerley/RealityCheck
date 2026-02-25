/**
 * RealityCheck Chrome Extension — Content Script
 *
 * Scans visible page content (images, videos, text blocks) and applies
 * watermarks to likely AI-generated content.
 *
 * Key design decisions:
 * - Only processes elements in/near the viewport (IntersectionObserver)
 * - Debounces DOM mutations to avoid thrashing on dynamic pages
 * - All settings are fetched from the background worker
 * - Respects per-site and global enable/disable settings
 */

import {
  DetectionPipeline,
  ExtensionSettings,
  DetectorOptions,
  applyMediaWatermark,
  applyNotAIWatermark,
  applyTextWatermark,
  WatermarkHandle,
} from '@reality-check/core';

const pipeline = new DetectionPipeline();

/**
 * Track active watermark handles for elements that have been watermarked.
 * Map (not WeakMap) so we can iterate and remove all overlays when settings
 * change (e.g. toggling devMode on/off).
 */
const handles = new Map<Element, WatermarkHandle>();

/**
 * Elements currently being analysed. Guards against concurrent calls to the
 * same element (e.g. from runScan() and IntersectionObserver firing at the
 * same time) interleaving their async work — particularly the video frame
 * seeks inside analyzeVideoFrames, which corrupt each other when interleaved.
 */
const processing = new Set<Element>();

let currentSettings: ExtensionSettings | null = null;

function decisionStageLabel(stage: string | undefined): string {
  if (stage === 'local_ml') return 'Local ML';
  if (stage === 'remote_ml') return 'Remote ML';
  return 'Initial';
}

function createDetectionId(kind: 'img' | 'vid'): string {
  return `rc-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDetectorOptions(settings: ExtensionSettings): DetectorOptions {
  return {
    remoteEnabled: settings.remoteEnabled,
    detectionQuality: settings.detectionQuality,
    remoteEndpoint: settings.remoteEndpoint || undefined,
    // Fetch image bytes via the background service worker, which is not
    // subject to CORS restrictions, enabling EXIF/C2PA analysis on cross-origin images.
    fetchBytes: (url: string) =>
      new Promise<string | null>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FETCH_IMAGE_BYTES', payload: url },
          (response: { ok: boolean; dataUrl: string | null } | undefined) => {
            if (chrome.runtime.lastError || !response?.ok) {
              resolve(null);
            } else {
              resolve(response.dataUrl ?? null);
            }
          }
        );
      }),
  };
}

function isSiteEnabled(settings: ExtensionSettings): boolean {
  if (!settings.globalEnabled) return false;
  const host = window.location.hostname;
  const siteSetting = settings.siteSettings[host];
  if (siteSetting !== undefined) return siteSetting.enabled;
  return true; // default: enabled
}

// ── Video thumbnail helpers ──────────────────────────────────────────────────

/** Check whether two bounding rects overlap by more than 50% of the smaller one's area. */
function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const overlapArea = overlapX * overlapY;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 && overlapArea > 0.5 * smallerArea;
}

/**
 * Check if an image is likely a video thumbnail/poster by checking whether
 * ANY <video> on the page visually overlaps with it.  Pure bounding-rect
 * comparison — independent of DOM nesting depth.
 */
function isVideoThumbnail(img: HTMLImageElement): boolean {
  const ir = img.getBoundingClientRect();
  if (ir.width === 0 || ir.height === 0) return false;
  const videos = document.querySelectorAll<HTMLVideoElement>('video');
  for (const video of videos) {
    const vr = video.getBoundingClientRect();
    if (vr.width === 0 || vr.height === 0) continue;
    if (rectsOverlap(ir, vr)) return true;
  }
  return false;
}

/**
 * Remove watermarks from ALL watermarked images that visually overlap with a
 * video.  Iterates the handles map directly so it works regardless of DOM
 * nesting depth between the <img> and <video>.
 */
function removeThumbnailWatermarks(video: HTMLVideoElement): void {
  const vr = video.getBoundingClientRect();
  if (vr.width === 0 || vr.height === 0) return;
  handles.forEach((handle, el) => {
    if (!(el instanceof HTMLImageElement)) return;
    const ir = el.getBoundingClientRect();
    if (ir.width === 0 || ir.height === 0) return;
    if (rectsOverlap(ir, vr)) {
      handle.remove();
      handles.delete(el);
    }
  });
}

// ── Element processors ───────────────────────────────────────────────────────

async function processImage(img: HTMLImageElement, settings: ExtensionSettings): Promise<void> {
  const detectionId = createDetectionId('img');
  if (handles.has(img) || processing.has(img)) {
    console.info('[RealityCheck] Image detection skipped', { detectionId, reason: 'already-processing-or-watermarked' });
    return;
  }
  if (!img.complete || img.naturalWidth < 100 || img.naturalHeight < 100) {
    console.info('[RealityCheck] Image detection skipped', { detectionId, reason: 'image-too-small-or-not-loaded' });
    return;
  }
  if (isVideoThumbnail(img)) {
    console.info('[RealityCheck] Image detection skipped', { detectionId, reason: 'video-thumbnail' });
    return;
  }

  processing.add(img);
  try {
    const opts = getDetectorOptions(settings);
    const t0 = performance.now();
    const result = await pipeline.analyzeImage(img, opts);
    const durationMs = Math.round((performance.now() - t0) * 100) / 100;
    console.info('[RealityCheck] Image detection', {
      detectionId,
      stage: decisionStageLabel(result.decisionStage),
      score: result.score,
      source: result.source,
      localModelScore: result.localModelScore,
      heuristicScores: result.heuristicScores,
      markedAsAI: result.isAIGenerated,
      details: result.details,
      durationMs,
    });

    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(img)) return;

    if (result.isAIGenerated) {
      const handle = applyMediaWatermark(
        img,
        result.confidence,
        settings.watermark,
        decisionStageLabel(result.decisionStage),
        result.details,
        detectionId
      );
      handles.set(img, handle);
    } else if (settings.devMode) {
      handles.set(
        img,
        applyNotAIWatermark(
          img,
          settings.watermark,
          decisionStageLabel(result.decisionStage),
          result.details,
          detectionId
        )
      );
    }
  } finally {
    processing.delete(img);
  }
}

async function processVideo(video: HTMLVideoElement, settings: ExtensionSettings): Promise<void> {
  const detectionId = createDetectionId('vid');
  if (handles.has(video) || processing.has(video)) {
    console.info('[RealityCheck] Video detection skipped', { detectionId, reason: 'already-processing-or-watermarked' });
    return;
  }

  processing.add(video);
  try {
    const opts = getDetectorOptions(settings);
    const t0 = performance.now();
    const result = await pipeline.analyzeVideo(video, opts);
    const durationMs = Math.round((performance.now() - t0) * 100) / 100;
    console.info('[RealityCheck] Video detection', {
      detectionId,
      stage: decisionStageLabel(result.decisionStage),
      score: result.score,
      source: result.source,
      localModelScore: result.localModelScore,
      heuristicScores: result.heuristicScores,
      markedAsAI: result.isAIGenerated,
      details: result.details,
      durationMs,
    });

    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(video)) return;

    if (result.isAIGenerated) {
      const handle = applyMediaWatermark(
        video,
        result.confidence,
        settings.watermark,
        decisionStageLabel(result.decisionStage),
        result.details,
        detectionId
      );
      handles.set(video, handle);
    } else if (settings.devMode) {
      handles.set(
        video,
        applyNotAIWatermark(
          video,
          settings.watermark,
          decisionStageLabel(result.decisionStage),
          result.details,
          detectionId
        )
      );
    }

    // Remove watermarks from thumbnail images that visually overlap this video,
    // preventing the double watermark issue when both a thumbnail <img> and
    // the <video> element get independently analysed.
    removeThumbnailWatermarks(video);
  } finally {
    processing.delete(video);
  }
}

/** Minimum text length to bother analysing */
const MIN_TEXT_LENGTH = 150;

/** Elements whose tags we consider for text analysis */
const TEXT_TAGS = new Set(['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'DIV', 'SPAN', 'LI']);

async function processTextNode(el: HTMLElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(el) || processing.has(el)) return;
  const text = el.innerText?.trim() ?? '';
  if (text.length < MIN_TEXT_LENGTH) return;
  // Skip if element has many child elements (likely a layout container)
  if (el.children.length > 10) return;

  processing.add(el);
  try {
    const opts = getDetectorOptions(settings);
    const result = await pipeline.analyzeText(text, opts);

    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(el)) return;

    if (result.isAIGenerated) {
      const handle = applyTextWatermark(el, result.confidence, settings.watermark);
      handles.set(el, handle);
    }
  } finally {
    processing.delete(el);
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

function scanImages(settings: ExtensionSettings): void {
  document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    processImage(img, settings).catch(console.error);
  });
}

function scanVideos(settings: ExtensionSettings): void {
  document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
    processVideo(video, settings).catch(console.error);
  });
}

function scanText(settings: ExtensionSettings): void {
  document.querySelectorAll<HTMLElement>(Array.from(TEXT_TAGS).join(',')).forEach((el) => {
    processTextNode(el, settings).catch(console.error);
  });
}

function runScan(settings: ExtensionSettings): void {
  if (!isSiteEnabled(settings)) return;
  scanImages(settings);
  scanVideos(settings);
  if (settings.textScanEnabled) scanText(settings);
}

// ── Intersection Observer (viewport-only scanning) ───────────────────────────

let observer: IntersectionObserver | null = null;

function startObserver(): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !currentSettings) continue;
        const el = entry.target as HTMLElement;
        if (el instanceof HTMLImageElement) {
          processImage(el, currentSettings).catch(console.error);
        } else if (el instanceof HTMLVideoElement) {
          processVideo(el, currentSettings).catch(console.error);
        } else if (currentSettings.textScanEnabled && TEXT_TAGS.has(el.tagName)) {
          processTextNode(el, currentSettings).catch(console.error);
        }
      }
    },
    { rootMargin: '200px' } // pre-load slightly outside viewport
  );

  // Observe existing elements
  const selParts = ['img', 'video'];
  if (currentSettings?.textScanEnabled) {
    selParts.push(...Array.from(TEXT_TAGS).map((t) => t.toLowerCase()));
  }
  const selector = selParts.join(', ');
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => observer!.observe(el));
}

// ── MutationObserver (dynamic content) ───────────────────────────────────────

let mutationDebounce: ReturnType<typeof setTimeout> | null = null;

function startMutationObserver(settings: ExtensionSettings): void {
  const mutObs = new MutationObserver(() => {
    if (mutationDebounce) clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
      // Clean up watermarks for elements no longer in the DOM (SPA navigation, dynamic removal)
      handles.forEach((handle, el) => {
        if (!el.isConnected) {
          handle.remove();
          handles.delete(el);
        }
      });
      if (currentSettings) runScan(currentSettings);
    }, 500);
  });
  mutObs.observe(document.body, { childList: true, subtree: true });
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const settings = await chrome.runtime.sendMessage<
    { type: string },
    ExtensionSettings
  >({ type: 'GET_SETTINGS' });

  currentSettings = settings;
  startObserver();
  startMutationObserver(settings);
  runScan(settings);
}

// Listen for settings updates from background
chrome.runtime.onMessage.addListener(
  (message: { type: string; payload?: unknown }) => {
    if (message.type === 'SETTINGS_UPDATED') {
      currentSettings = message.payload as ExtensionSettings;
      // Remove all existing watermarks before re-scanning with updated settings.
      handles.forEach((handle) => handle.remove());
      handles.clear();
      if (isSiteEnabled(currentSettings)) {
        runScan(currentSettings);
      }
    }
  }
);

init().catch(console.error);
