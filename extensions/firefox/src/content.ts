/**
 * RealityCheck Firefox Extension — Content Script
 *
 * Uses `browser` (WebExtensions) API instead of `chrome`.
 * Functionally identical to the Chrome content script.
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
import type { ContentType, RemotePayload, RemoteClassificationResult } from '@reality-check/core';

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

function getDetectorOptions(settings: ExtensionSettings): DetectorOptions {
  return {
    remoteEnabled: settings.remoteEnabled,
    detectionQuality: settings.detectionQuality,
    remoteEndpoint: settings.remoteEndpoint || undefined,
    remoteApiKey: settings.remoteApiKey || undefined,
    remoteClassify: (
      endpoint: string,
      apiKey: string,
      contentType: ContentType,
      payload: RemotePayload
    ): Promise<RemoteClassificationResult> =>
      browser.runtime
        .sendMessage({
          type: 'REMOTE_CLASSIFY',
          payload: { endpoint, apiKey, contentType, payload },
        })
        .then((response: unknown) => {
          const resp = response as { ok: boolean; result?: RemoteClassificationResult; error?: string } | undefined;
          if (!resp?.ok) throw new Error(resp?.error ?? 'Remote classify failed');
          return resp.result!;
        }),
    fetchBytes: (url: string) =>
      browser.runtime
        .sendMessage({ type: 'FETCH_IMAGE_BYTES', payload: url })
        .then((response: unknown) => {
          const resp = response as { ok: boolean; dataUrl: string | null } | undefined;
          return resp?.ok ? (resp.dataUrl ?? null) : null;
        })
        .catch(() => null),
  };
}

function isSiteEnabled(settings: ExtensionSettings): boolean {
  if (!settings.globalEnabled) return false;
  const host = window.location.hostname;
  const siteSetting = settings.siteSettings[host];
  return siteSetting !== undefined ? siteSetting.enabled : true;
}

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
    const t0 = performance.now();
    const result = await pipeline.analyzeImage(img, getDetectorOptions(settings));
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
      handles.set(
        img,
        applyMediaWatermark(
          img,
          result.confidence,
          settings.watermark,
          decisionStageLabel(result.decisionStage),
          result.details,
          detectionId
        )
      );
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
    const t0 = performance.now();
    const result = await pipeline.analyzeVideo(video, getDetectorOptions(settings));
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
      handles.set(
        video,
        applyMediaWatermark(
          video,
          result.confidence,
          settings.watermark,
          decisionStageLabel(result.decisionStage),
          result.details,
          detectionId
        )
      );
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
    removeThumbnailWatermarks(video);
  } finally {
    processing.delete(video);
  }
}

const MIN_TEXT_LENGTH = 150;
const TEXT_TAGS = new Set(['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'DIV', 'SPAN', 'LI']);

async function processTextNode(el: HTMLElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(el) || processing.has(el)) return;
  const text = el.innerText?.trim() ?? '';
  if (text.length < MIN_TEXT_LENGTH || el.children.length > 10) return;
  processing.add(el);
  try {
    const result = await pipeline.analyzeText(text, getDetectorOptions(settings));
    // Guard again after await: a concurrent call may have already watermarked this element.
    if (handles.has(el)) return;
    if (result.isAIGenerated) {
      handles.set(el, applyTextWatermark(el, result.confidence, settings.watermark));
    }
  } finally {
    processing.delete(el);
  }
}

function runScan(settings: ExtensionSettings): void {
  if (!isSiteEnabled(settings)) return;
  document.querySelectorAll<HTMLImageElement>('img').forEach((img) =>
    processImage(img, settings).catch(console.error)
  );
  document.querySelectorAll<HTMLVideoElement>('video').forEach((v) =>
    processVideo(v, settings).catch(console.error)
  );
  if (settings.textScanEnabled) {
    document
      .querySelectorAll<HTMLElement>(Array.from(TEXT_TAGS).join(','))
      .forEach((el) => processTextNode(el, settings).catch(console.error));
  }
}

let mutDebounce: ReturnType<typeof setTimeout> | null = null;

async function init(): Promise<void> {
  const settings = (await browser.runtime.sendMessage({ type: 'GET_SETTINGS' })) as ExtensionSettings;
  currentSettings = settings;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !currentSettings) continue;
        const el = entry.target as HTMLElement;
        if (el instanceof HTMLImageElement) processImage(el, currentSettings).catch(console.error);
        else if (el instanceof HTMLVideoElement) processVideo(el, currentSettings).catch(console.error);
        else if (currentSettings.textScanEnabled && TEXT_TAGS.has(el.tagName)) processTextNode(el, currentSettings).catch(console.error);
      }
    },
    { rootMargin: '200px' }
  );

  const selParts = ['img', 'video'];
  if (currentSettings?.textScanEnabled) {
    selParts.push(...Array.from(TEXT_TAGS).map((t) => t.toLowerCase()));
  }
  const sel = selParts.join(', ');
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => observer.observe(el));

  new MutationObserver(() => {
    if (mutDebounce) clearTimeout(mutDebounce);
    mutDebounce = setTimeout(() => {
      // Clean up watermarks for elements no longer in the DOM (SPA navigation, dynamic removal)
      handles.forEach((handle, el) => {
        if (!el.isConnected) {
          handle.remove();
          handles.delete(el);
        }
      });
      if (currentSettings) runScan(currentSettings);
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  runScan(settings);
}

browser.runtime.onMessage.addListener((message: { type: string; payload?: unknown }) => {
  if (message.type === 'SETTINGS_UPDATED') {
    currentSettings = message.payload as ExtensionSettings;
    // Remove all existing watermarks before re-scanning with updated settings.
    handles.forEach((handle) => handle.remove());
    handles.clear();
    if (currentSettings && isSiteEnabled(currentSettings)) runScan(currentSettings);
  }
});

init().catch(console.error);
