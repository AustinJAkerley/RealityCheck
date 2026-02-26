/**
 * RealityCheck Firefox Extension — Background Script
 *
 * Uses WebExtensions `browser` API (Promise-based).
 * Functionally equivalent to the Chrome service worker but using
 * browser.* APIs for MV2 compatibility.
 *
 * Note: Firefox MV2 background pages use classic scripts (IIFE format).
 * Transformers.js requires import.meta.url (ES module context), so
 * SDXL_CLASSIFY returns a neutral 0.5 score; the remote classifier is
 * still fully functional.
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings, createRemoteAdapter } from '@reality-check/core';
import type { ContentType, RemotePayload } from '@reality-check/core';

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

    if (message.type === 'SDXL_CLASSIFY') {
      // Firefox MV2 background pages use classic scripts (IIFE format).
      // Transformers.js requires import.meta.url, so WASM can't run here.
      // Return a neutral score; the remote classifier handles escalation.
      return Promise.resolve({ ok: true, score: 0.5 });
    }

    if (message.type === 'REMOTE_CLASSIFY') {
      const { endpoint, apiKey, contentType, payload } = message.payload as {
        endpoint: string;
        apiKey: string;
        contentType: ContentType;
        payload: RemotePayload;
      };
      const adapter = createRemoteAdapter(endpoint, apiKey);
      return adapter
        .classify(contentType, payload)
        .then((result) => ({ ok: true, result }))
        .catch((err: Error) => {
          console.warn('[RealityCheck] Remote classification error:', err.message);
          return { ok: false, error: err.message };
        });
    }

    return undefined;
  }
);
