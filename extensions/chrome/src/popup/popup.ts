/**
 * RealityCheck Popup Script
 * Loads settings, reflects them in the UI, and saves changes.
 */
import { ExtensionSettings, DEFAULT_SETTINGS } from '../../../packages/core/src/index.js';

// ── Element references ────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const globalEnabledEl = $<HTMLInputElement>('globalEnabled');
const siteHostEl = $<HTMLElement>('siteHost');
const siteEnabledEl = $<HTMLInputElement>('siteEnabled');
const localOnlyEl = $<HTMLInputElement>('localOnly');
const remoteSectionEl = $<HTMLElement>('remoteSection');
const remoteEndpointEl = $<HTMLInputElement>('remoteEndpoint');
const remoteApiKeyEl = $<HTMLInputElement>('remoteApiKey');
const watermarkModeEl = $<HTMLSelectElement>('watermarkMode');
const watermarkPositionEl = $<HTMLSelectElement>('watermarkPosition');
const watermarkOpacityEl = $<HTMLInputElement>('watermarkOpacity');
const opacityValueEl = $<HTMLElement>('opacityValue');
const animDurationEl = $<HTMLInputElement>('animDuration');
const animDurValueEl = $<HTMLElement>('animDurValue');
const pulseFreqEl = $<HTMLInputElement>('pulseFreq');
const pulseFreqValueEl = $<HTMLElement>('pulseFreqValue');
const reportFPEl = $<HTMLButtonElement>('reportFP');
const reportFNEl = $<HTMLButtonElement>('reportFN');
const reportStatusEl = $<HTMLElement>('reportStatus');

// ── State ─────────────────────────────────────────────────────────────────────
let settings: ExtensionSettings = DEFAULT_SETTINGS;
let currentHost = '';

// ── Load settings ─────────────────────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  settings = await chrome.runtime.sendMessage<{ type: string }, ExtensionSettings>({
    type: 'GET_SETTINGS',
  });

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentHost = new URL(tabs[0]?.url ?? 'https://unknown').hostname;
  siteHostEl.textContent = currentHost;

  reflectSettings();
}

function reflectSettings(): void {
  globalEnabledEl.checked = settings.globalEnabled;

  const siteSetting = settings.siteSettings[currentHost];
  siteEnabledEl.checked = siteSetting !== undefined ? siteSetting.enabled : true;

  localOnlyEl.checked = settings.localOnly;
  remoteSectionEl.classList.toggle('hidden', settings.localOnly);

  remoteEndpointEl.value = settings.remoteEndpoint ?? '';
  remoteApiKeyEl.value = settings.remoteApiKey ?? '';

  const wm = settings.watermark;
  watermarkModeEl.value = wm.mode;
  watermarkPositionEl.value = wm.position;
  watermarkOpacityEl.value = String(wm.opacity);
  opacityValueEl.textContent = String(wm.opacity);
  animDurationEl.value = String(wm.animationDuration);
  animDurValueEl.textContent = String(wm.animationDuration);
  pulseFreqEl.value = String(wm.pulseFrequency);
  pulseFreqValueEl.textContent = String(wm.pulseFrequency);
}

// ── Save helper ───────────────────────────────────────────────────────────────
async function save(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: settings });
}

// ── Event listeners ───────────────────────────────────────────────────────────
globalEnabledEl.addEventListener('change', async () => {
  settings = { ...settings, globalEnabled: globalEnabledEl.checked };
  await save();
});

siteEnabledEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    siteSettings: {
      ...settings.siteSettings,
      [currentHost]: { enabled: siteEnabledEl.checked },
    },
  };
  await save();
});

localOnlyEl.addEventListener('change', async () => {
  settings = { ...settings, localOnly: localOnlyEl.checked };
  remoteSectionEl.classList.toggle('hidden', settings.localOnly);
  await save();
});

remoteEndpointEl.addEventListener('change', async () => {
  settings = { ...settings, remoteEndpoint: remoteEndpointEl.value.trim() };
  await save();
});

remoteApiKeyEl.addEventListener('change', async () => {
  settings = { ...settings, remoteApiKey: remoteApiKeyEl.value.trim() };
  await save();
});

watermarkModeEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    watermark: { ...settings.watermark, mode: watermarkModeEl.value as ExtensionSettings['watermark']['mode'] },
  };
  await save();
});

watermarkPositionEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    watermark: { ...settings.watermark, position: watermarkPositionEl.value as ExtensionSettings['watermark']['position'] },
  };
  await save();
});

watermarkOpacityEl.addEventListener('input', () => {
  opacityValueEl.textContent = watermarkOpacityEl.value;
});
watermarkOpacityEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    watermark: { ...settings.watermark, opacity: Number(watermarkOpacityEl.value) },
  };
  await save();
});

animDurationEl.addEventListener('input', () => {
  animDurValueEl.textContent = animDurationEl.value;
});
animDurationEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    watermark: { ...settings.watermark, animationDuration: Number(animDurationEl.value) },
  };
  await save();
});

pulseFreqEl.addEventListener('input', () => {
  pulseFreqValueEl.textContent = pulseFreqEl.value;
});
pulseFreqEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    watermark: { ...settings.watermark, pulseFrequency: Number(pulseFreqEl.value) },
  };
  await save();
});

function showReportStatus(): void {
  reportStatusEl.classList.remove('hidden');
  setTimeout(() => reportStatusEl.classList.add('hidden'), 3000);
}

reportFPEl.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'REPORT_FALSE_POSITIVE',
    payload: { type: 'false_positive', url: `https://${currentHost}` },
  });
  showReportStatus();
});

reportFNEl.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'REPORT_FALSE_POSITIVE',
    payload: { type: 'false_negative', url: `https://${currentHost}` },
  });
  showReportStatus();
});

// ── Init ─────────────────────────────────────────────────────────────────────
loadSettings().catch(console.error);
