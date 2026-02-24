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

/**
 * Check if an image is likely a video thumbnail/poster by looking for a
 * <video> element in a nearby ancestor that visually overlaps with the image.
 */
function isVideoThumbnail(img: HTMLImageElement): boolean {
  const ir = img.getBoundingClientRect();
  if (ir.width === 0 || ir.height === 0) return false;
  let el: Element | null = img.parentElement;
  for (let i = 0; i < 3 && el; i++) {
    const video = el.querySelector('video');
    if (video) {
      const vr = video.getBoundingClientRect();
      const overlapX = Math.max(0, Math.min(ir.right, vr.right) - Math.max(ir.left, vr.left));
      const overlapY = Math.max(0, Math.min(ir.bottom, vr.bottom) - Math.max(ir.top, vr.top));
      if (overlapX * overlapY > 0.5 * ir.width * ir.height) return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Remove watermarks from thumbnail images that visually overlap with a video.
 * Called after a video gets its watermark so the thumbnail's watermark
 * doesn't show alongside the video's watermark.
 */
function removeThumbnailWatermarks(video: HTMLVideoElement): void {
  const vr = video.getBoundingClientRect();
  if (vr.width === 0 || vr.height === 0) return;
  let container: Element | null = video.parentElement;
  for (let i = 0; i < 3 && container; i++) {
    container.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      const handle = handles.get(img);
      if (!handle) return;
      const ir = img.getBoundingClientRect();
      if (ir.width === 0 || ir.height === 0) return;
      const overlapX = Math.max(0, Math.min(ir.right, vr.right) - Math.max(ir.left, vr.left));
      const overlapY = Math.max(0, Math.min(ir.bottom, vr.bottom) - Math.max(ir.top, vr.top));
      if (overlapX * overlapY > 0.5 * ir.width * ir.height) {
        handle.remove();
        handles.delete(img);
      }
    });
    container = container.parentElement;
  }
}

// ── Element processors ───────────────────────────────────────────────────────

async function processImage(img: HTMLImageElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(img) || processing.has(img)) return;
  if (!img.complete || img.naturalWidth < 100 || img.naturalHeight < 100) return;
  if (isVideoThumbnail(img)) return;

  processing.add(img);
  try {
    const opts = getDetectorOptions(settings);
    const result = await pipeline.analyzeImage(img, opts);

    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(img)) return;

    if (result.isAIGenerated) {
      const handle = applyMediaWatermark(img, result.confidence, settings.watermark);
      handles.set(img, handle);
    } else if (settings.devMode) {
      handles.set(img, applyNotAIWatermark(img, settings.watermark));
    }
  } finally {
    processing.delete(img);
  }
}

async function processVideo(video: HTMLVideoElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(video) || processing.has(video)) return;

  processing.add(video);
  try {
    const opts = getDetectorOptions(settings);
    const result = await pipeline.analyzeVideo(video, opts);

    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(video)) return;

    if (result.isAIGenerated) {
      const handle = applyMediaWatermark(video, result.confidence, settings.watermark);
      handles.set(video, handle);
    } else if (settings.devMode) {
      handles.set(video, applyNotAIWatermark(video, settings.watermark));
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
  scanText(settings);
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
        } else if (TEXT_TAGS.has(el.tagName)) {
          processTextNode(el, currentSettings).catch(console.error);
        }
      }
    },
    { rootMargin: '200px' } // pre-load slightly outside viewport
  );

  // Observe existing elements
  const selector = ['img', 'video', ...Array.from(TEXT_TAGS).map((t) => t.toLowerCase())].join(',');
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => observer!.observe(el));
}

// ── MutationObserver (dynamic content) ───────────────────────────────────────

let mutationDebounce: ReturnType<typeof setTimeout> | null = null;

function startMutationObserver(settings: ExtensionSettings): void {
  const mutObs = new MutationObserver(() => {
    if (mutationDebounce) clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
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
