/**
 * RealityCheck Firefox Popup Script
 * Uses WebExtensions `browser` API.
 */
import { ExtensionSettings, DEFAULT_SETTINGS } from '@reality-check/core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const globalEnabledEl = $<HTMLInputElement>('globalEnabled');
const siteHostEl = $<HTMLElement>('siteHost');
const siteEnabledEl = $<HTMLInputElement>('siteEnabled');
const detectionQualityEl = $<HTMLSelectElement>('detectionQuality');
const remoteEnabledEl = $<HTMLInputElement>('remoteEnabled');
const remoteOffNoteEl = $<HTMLElement>('remoteOffNote');
const remoteOnNoteEl = $<HTMLElement>('remoteOnNote');
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
const remoteEndpointEl = $<HTMLInputElement>('remoteEndpoint');
const remoteApiKeyEl = $<HTMLInputElement>('remoteApiKey');

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let currentHost = '';

async function loadSettings(): Promise<void> {
  settings = (await browser.runtime.sendMessage({ type: 'GET_SETTINGS' })) as ExtensionSettings;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  currentHost = new URL(tabs[0]?.url ?? 'https://unknown').hostname;
  siteHostEl.textContent = currentHost;
  reflectSettings();
}

function reflectSettings(): void {
  globalEnabledEl.checked = settings.globalEnabled;
  const siteSetting = settings.siteSettings[currentHost];
  siteEnabledEl.checked = siteSetting !== undefined ? siteSetting.enabled : true;
  detectionQualityEl.value = settings.detectionQuality;
  remoteEnabledEl.checked = settings.remoteEnabled;
  updateRemoteNotes(settings.remoteEnabled);
  const wm = settings.watermark;
  watermarkModeEl.value = wm.mode;
  watermarkPositionEl.value = wm.position;
  watermarkOpacityEl.value = String(wm.opacity);
  opacityValueEl.textContent = String(wm.opacity);
  animDurationEl.value = String(wm.animationDuration);
  animDurValueEl.textContent = String(wm.animationDuration);
  pulseFreqEl.value = String(wm.pulseFrequency);
  pulseFreqValueEl.textContent = String(wm.pulseFrequency);
  remoteEndpointEl.value = settings.remoteEndpoint ?? '';
  remoteApiKeyEl.value = settings.remoteApiKey ?? '';
}

function updateRemoteNotes(remoteEnabled: boolean): void {
  remoteOffNoteEl.classList.toggle('hidden', remoteEnabled);
  remoteOnNoteEl.classList.toggle('hidden', !remoteEnabled);
}

async function save(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: settings });
}

globalEnabledEl.addEventListener('change', async () => {
  settings = { ...settings, globalEnabled: globalEnabledEl.checked };
  await save();
});

siteEnabledEl.addEventListener('change', async () => {
  settings = {
    ...settings,
    siteSettings: { ...settings.siteSettings, [currentHost]: { enabled: siteEnabledEl.checked } },
  };
  await save();
});

detectionQualityEl.addEventListener('change', async () => {
  settings = { ...settings, detectionQuality: detectionQualityEl.value as ExtensionSettings['detectionQuality'] };
  await save();
});

remoteEnabledEl.addEventListener('change', async () => {
  settings = { ...settings, remoteEnabled: remoteEnabledEl.checked };
  updateRemoteNotes(settings.remoteEnabled);
  await save();
});

watermarkModeEl.addEventListener('change', async () => {
  settings = { ...settings, watermark: { ...settings.watermark, mode: watermarkModeEl.value as ExtensionSettings['watermark']['mode'] } };
  await save();
});

watermarkPositionEl.addEventListener('change', async () => {
  settings = { ...settings, watermark: { ...settings.watermark, position: watermarkPositionEl.value as ExtensionSettings['watermark']['position'] } };
  await save();
});

watermarkOpacityEl.addEventListener('input', () => { opacityValueEl.textContent = watermarkOpacityEl.value; });
watermarkOpacityEl.addEventListener('change', async () => {
  settings = { ...settings, watermark: { ...settings.watermark, opacity: Number(watermarkOpacityEl.value) } };
  await save();
});

animDurationEl.addEventListener('input', () => { animDurValueEl.textContent = animDurationEl.value; });
animDurationEl.addEventListener('change', async () => {
  settings = { ...settings, watermark: { ...settings.watermark, animationDuration: Number(animDurationEl.value) } };
  await save();
});

pulseFreqEl.addEventListener('input', () => { pulseFreqValueEl.textContent = pulseFreqEl.value; });
pulseFreqEl.addEventListener('change', async () => {
  settings = { ...settings, watermark: { ...settings.watermark, pulseFrequency: Number(pulseFreqEl.value) } };
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

function showReportStatus(): void {
  reportStatusEl.classList.remove('hidden');
  setTimeout(() => reportStatusEl.classList.add('hidden'), 3000);
}

reportFPEl.addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'REPORT_FALSE_POSITIVE', payload: { type: 'false_positive', url: `https://${currentHost}` } });
  showReportStatus();
});

reportFNEl.addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'REPORT_FALSE_POSITIVE', payload: { type: 'false_negative', url: `https://${currentHost}` } });
  showReportStatus();
});

loadSettings().catch(console.error);

