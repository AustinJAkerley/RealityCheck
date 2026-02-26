/**
 * RealityCheck Edge Extension — Content Script
 *
 * Scans visible page content (images, videos) and applies watermarks to
 * likely AI-generated content using the Organika/sdxl-detector local ML
 * model, with optional remote ML escalation for uncertain cases.
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
  WatermarkHandle,
} from '@reality-check/core';
import type { ContentType, RemotePayload, RemoteClassificationResult } from '@reality-check/core';

const pipeline = new DetectionPipeline();

/**
 * Track active watermark handles for elements that have been watermarked.
 * Map (not WeakMap) so we can iterate and remove all overlays when settings change.
 */
const handles = new Map<Element, WatermarkHandle>();

/**
 * Elements currently being analysed. Guards against concurrent calls to the
 * same element interleaving their async work (particularly video frame seeks).
 */
const processing = new Set<Element>();

let currentSettings: ExtensionSettings | null = null;

const BASE36_FIVE_DIGITS = 36 ** 5;
const _seenDetectionIds = new Set<string>();

function createDetectionId(kind: 'img' | 'vid'): string {
  let id = '';
  do {
    const n = Math.floor(Math.random() * BASE36_FIVE_DIGITS);
    const code = n.toString(36).toUpperCase().padStart(5, '0');
    id = `rc-${kind}-${code}`;
  } while (_seenDetectionIds.has(id));
  _seenDetectionIds.add(id);
  return id;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDetectorOptions(settings: ExtensionSettings): DetectorOptions {
  return {
    remoteEnabled: settings.remoteEnabled,
    detectionQuality: settings.detectionQuality,
    remoteEndpoint: settings.remoteEndpoint || undefined,
    remoteApiKey: settings.remoteApiKey || undefined,
    // Route remote classification through the background service worker
    // to avoid CORS restrictions on the Azure OpenAI APIM endpoint.
    remoteClassify: (
      endpoint: string,
      apiKey: string,
      contentType: ContentType,
      payload: RemotePayload
    ): Promise<RemoteClassificationResult> =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'REMOTE_CLASSIFY',
            payload: { endpoint, apiKey, contentType, payload },
          },
          (response: { ok: boolean; result?: RemoteClassificationResult; error?: string } | undefined) => {
            if (chrome.runtime.lastError || !response?.ok) {
              reject(new Error(response?.error ?? chrome.runtime.lastError?.message ?? 'Remote classify failed'));
            } else {
              resolve(response.result!);
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

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const overlapArea = overlapX * overlapY;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 && overlapArea > 0.5 * smallerArea;
}

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
      score: result.score,
      source: result.source,
      localModelScore: result.localModelScore,
      markedAsAI: result.isAIGenerated,
      details: result.details,
      durationMs,
    });

    if (handles.has(img)) return;

    if (result.isAIGenerated) {
      handles.set(img, applyMediaWatermark(img, result.confidence, settings.watermark, result.source, result.details, detectionId));
    } else if (settings.devMode) {
      handles.set(img, applyNotAIWatermark(img, settings.watermark, result.source, result.details, detectionId));
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
      score: result.score,
      source: result.source,
      localModelScore: result.localModelScore,
      markedAsAI: result.isAIGenerated,
      details: result.details,
      durationMs,
    });

    if (handles.has(video)) return;

    if (result.isAIGenerated) {
      handles.set(video, applyMediaWatermark(video, result.confidence, settings.watermark, result.source, result.details, detectionId));
    } else if (settings.devMode) {
      handles.set(video, applyNotAIWatermark(video, settings.watermark, result.source, result.details, detectionId));
    }

    // Remove thumbnail watermarks that overlap this video element.
    removeThumbnailWatermarks(video);
  } finally {
    processing.delete(video);
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

function runScan(settings: ExtensionSettings): void {
  if (!isSiteEnabled(settings)) return;
  scanImages(settings);
  scanVideos(settings);
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
        }
      }
    },
    { rootMargin: '200px' }
  );
  document.querySelectorAll<HTMLElement>('img, video').forEach((el) => observer!.observe(el));
}

// ── MutationObserver (dynamic content) ───────────────────────────────────────

let mutationDebounce: ReturnType<typeof setTimeout> | null = null;

function startMutationObserver(settings: ExtensionSettings): void {
  const mutObs = new MutationObserver((mutations) => {
    // Skip re-scan when the only mutations are RC overlay additions/removals
    const allRcOverlay = mutations.every((m) => {
      const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
      return (
        nodes.length > 0 &&
        nodes.every((n) => n instanceof Element && (n as Element).classList.contains('rc-watermark'))
      );
    });
    if (allRcOverlay) return;

    if (mutationDebounce) clearTimeout(mutationDebounce);
    mutationDebounce = setTimeout(() => {
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
