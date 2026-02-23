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
  applyTextWatermark,
  WatermarkHandle,
} from '../../packages/core/src/index.js';

const pipeline = new DetectionPipeline();
const handles = new WeakMap<Element, WatermarkHandle>();
let currentSettings: ExtensionSettings | null = null;

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
  return siteSetting !== undefined ? siteSetting.enabled : true;
}

async function processImage(img: HTMLImageElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(img)) return;
  if (!img.complete || img.naturalWidth < 100 || img.naturalHeight < 100) return;
  const result = await pipeline.analyzeImage(img, getDetectorOptions(settings));
  if (result.isAIGenerated) {
    handles.set(img, applyMediaWatermark(img, result.confidence, settings.watermark));
  }
}

async function processVideo(video: HTMLVideoElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(video)) return;
  const result = await pipeline.analyzeVideo(video, getDetectorOptions(settings));
  if (result.isAIGenerated) {
    handles.set(video, applyMediaWatermark(video, result.confidence, settings.watermark));
  }
}

const MIN_TEXT_LENGTH = 150;
const TEXT_TAGS = new Set(['P', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'DIV', 'SPAN', 'LI']);

async function processTextNode(el: HTMLElement, settings: ExtensionSettings): Promise<void> {
  if (handles.has(el)) return;
  const text = el.innerText?.trim() ?? '';
  if (text.length < MIN_TEXT_LENGTH || el.children.length > 10) return;
  const result = await pipeline.analyzeText(text, getDetectorOptions(settings));
  if (result.isAIGenerated) {
    handles.set(el, applyTextWatermark(el, result.confidence, settings.watermark));
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
  document
    .querySelectorAll<HTMLElement>(Array.from(TEXT_TAGS).join(','))
    .forEach((el) => processTextNode(el, settings).catch(console.error));
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
        else if (TEXT_TAGS.has(el.tagName)) processTextNode(el, currentSettings).catch(console.error);
      }
    },
    { rootMargin: '200px' }
  );

  const sel = ['img', 'video', ...Array.from(TEXT_TAGS).map((t) => t.toLowerCase())].join(',');
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => observer.observe(el));

  new MutationObserver(() => {
    if (mutDebounce) clearTimeout(mutDebounce);
    mutDebounce = setTimeout(() => {
      if (currentSettings) runScan(currentSettings);
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  runScan(settings);
}

browser.runtime.onMessage.addListener((message: { type: string; payload?: unknown }) => {
  if (message.type === 'SETTINGS_UPDATED') {
    currentSettings = message.payload as ExtensionSettings;
    if (currentSettings && isSiteEnabled(currentSettings)) runScan(currentSettings);
  }
});

init().catch(console.error);
