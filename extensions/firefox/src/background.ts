/**
 * RealityCheck Firefox Extension — Background Script
 *
 * Uses WebExtensions `browser` API (Promise-based).
 * Functionally equivalent to the Chrome service worker but using
 * browser.* APIs for MV2 compatibility.
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings } from '@reality-check/core';

const storage = new SettingsStorage();

browser.runtime.onInstalled.addListener(async () => {
  const settings = await storage.load();
  await storage.save(settings);
  console.log('[RealityCheck] Extension installed. Settings:', settings);
});

browser.runtime.onMessage.addListener(
  (message: { type: string; payload?: unknown }): Promise<unknown> | undefined => {
    if (message.type === 'GET_SETTINGS') {
      return storage.load().catch(() => DEFAULT_SETTINGS);
    }

    if (message.type === 'SAVE_SETTINGS') {
      const newSettings = message.payload as ExtensionSettings;
      return storage.save(newSettings).then(async () => {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
          if (tab.id !== undefined) {
            browser.tabs
              .sendMessage(tab.id, { type: 'SETTINGS_UPDATED', payload: newSettings })
              .catch(() => {/* content script may not be loaded */});
          }
        }
        return { ok: true };
      });
    }

    if (message.type === 'REPORT_FALSE_POSITIVE') {
      console.log('[RealityCheck] False positive reported:', message.payload);
      return Promise.resolve({ ok: true });
    }

    if (message.type === 'FETCH_IMAGE_BYTES') {
      // Fetch image bytes on behalf of the content script.
      // Background scripts are not subject to CORS restrictions,
      // allowing EXIF and C2PA metadata to be read from cross-origin images.
      const url = message.payload as string;
      return fetch(url)
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        })
        .then((dataUrl) => ({ ok: true, dataUrl }))
        .catch(() => ({ ok: false, dataUrl: null }));
    }

    return undefined;
  }
);
