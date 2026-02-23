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
  applyTextWatermark,
  WatermarkHandle,
} from '@reality-check/core';

const pipeline = new DetectionPipeline();

/** Track watermark handles so we can remove them if settings change */
const handles = new WeakMap<Element, WatermarkHandle>();

let currentSettings: ExtensionSettings | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDetectorOptions(settings: ExtensionSettings): DetectorOptions {
  return {
    remoteEnabled: settings.remoteEnabled,
    detectionQuality: settings.detectionQuality,
    remoteEndpoint: settings.remoteEndpoint || undefined,
  };
}

function isSiteEnabled(settings: ExtensionSettings): boolean {
  if (!settings.globalEnabled) return false;
  const host = window.location.hostname;
  const siteSetting = settings.siteSettings[host];
  if (siteSetting !== undefined) return siteSetting.enabled;
  return true; // default: enabled
}

// ── Element processors ───────────────────────────────────────────────────────

async function processImage(img: HTMLImageElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(img)) return;
  if (!img.complete || img.naturalWidth < 100 || img.naturalHeight < 100) return;

  const opts = getDetectorOptions(settings);
  const result = await pipeline.analyzeImage(img, opts);

  if (result.isAIGenerated) {
    const handle = applyMediaWatermark(img, result.confidence, settings.watermark);
    handles.set(img, handle);
  }
}

async function processVideo(video: HTMLVideoElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(video)) return;

  const opts = getDetectorOptions(settings);
  const result = await pipeline.analyzeVideo(video, opts);

  if (result.isAIGenerated) {
    const handle = applyMediaWatermark(video, result.confidence, settings.watermark);
    handles.set(video, handle);
  }
}

/** Minimum text length to bother analysing */
const MIN_TEXT_LENGTH = 150;

/** Elements whose tags we consider for text analysis */
const TEXT_TAGS = new Set(['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'DIV', 'SPAN', 'LI']);

async function processTextNode(el: HTMLElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(el)) return;
  const text = el.innerText?.trim() ?? '';
  if (text.length < MIN_TEXT_LENGTH) return;
  // Skip if element has many child elements (likely a layout container)
  if (el.children.length > 10) return;

  const opts = getDetectorOptions(settings);
  const result = await pipeline.analyzeText(text, opts);

  if (result.isAIGenerated) {
    const handle = applyTextWatermark(el, result.confidence, settings.watermark);
    handles.set(el, handle);
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

function startObserver(settings: ExtensionSettings): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        if (el instanceof HTMLImageElement) {
          processImage(el, settings).catch(console.error);
        } else if (el instanceof HTMLVideoElement) {
          processVideo(el, settings).catch(console.error);
        } else if (TEXT_TAGS.has(el.tagName)) {
          processTextNode(el, settings).catch(console.error);
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
  startObserver(settings);
  startMutationObserver(settings);
  runScan(settings);
}

// Listen for settings updates from background
chrome.runtime.onMessage.addListener(
  (message: { type: string; payload?: unknown }) => {
    if (message.type === 'SETTINGS_UPDATED') {
      currentSettings = message.payload as ExtensionSettings;
      // Re-run scan with new settings
      if (isSiteEnabled(currentSettings)) {
        runScan(currentSettings);
      }
    }
  }
);

init().catch(console.error);
