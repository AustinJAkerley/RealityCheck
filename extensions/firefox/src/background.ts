/**
 * RealityCheck Firefox Extension — Background Script
 *
 * Uses WebExtensions `browser` API (Promise-based).
 * Functionally equivalent to the Chrome service worker but using
 * browser.* APIs for MV2 compatibility.
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings } from '../../packages/core/src/index.js';

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

    return undefined;
  }
);
