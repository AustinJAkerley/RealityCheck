/**
 * RealityCheck Safari Extension — Background Service Worker
 *
 * Uses the WebExtensions `browser` API (Promise-based), which Safari
 * supports natively. Functionally equivalent to the Chrome service worker.
 *
 * Responsibilities:
 * - Maintain extension settings in browser.storage.sync
 * - Handle messages from content scripts and popup
 * - Broadcast settings changes to active content scripts
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings, createRemoteAdapter } from '@reality-check/core';
import type { ContentType, RemotePayload } from '@reality-check/core';

const storage = new SettingsStorage();

// Ensure default settings exist on install
browser.runtime.onInstalled.addListener(async () => {
  const settings = await storage.load();
  await storage.save(settings);
  console.log('[RealityCheck] Extension installed. Settings:', settings);
});

// Message handler
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
              .catch(() => {
                // Tab may not have a content script — ignore
              });
          }
        }
        return { ok: true };
      });
    }

    if (message.type === 'REPORT_FALSE_POSITIVE') {
      // Persist report locally (no network call unless user opts in)
      console.log('[RealityCheck] False positive reported:', message.payload);
      return Promise.resolve({ ok: true });
    }

    if (message.type === 'FETCH_IMAGE_BYTES') {
      // Fetch image bytes on behalf of the content script.
      // Background service workers are not subject to CORS restrictions,
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
