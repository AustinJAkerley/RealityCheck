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
 * - Run SDXL model inference (SDXL_CLASSIFY) — content scripts can't load WASM
 * - Route remote ML calls (REMOTE_CLASSIFY) — bypasses CORS restrictions
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings, createRemoteAdapter, createSdxlDetectorRunner, MlModelRunner } from '@reality-check/core';
import type { ContentType, RemotePayload } from '@reality-check/core';

const storage = new SettingsStorage();

// Lazy-initialised SDXL runner — Transformers.js / ONNX Runtime runs in this
// ES module service worker context where import.meta.url is valid.
let sdxlRunner: MlModelRunner | null = null;

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

    if (message.type === 'SDXL_CLASSIFY') {
      // Run the Organika/sdxl-detector model in this ES module service worker.
      // Content scripts can't load WASM (import.meta.url fails in classic scripts).
      const { data, width, height } = message.payload as {
        data: Uint8ClampedArray;
        width: number;
        height: number;
      };
      sdxlRunner ??= createSdxlDetectorRunner();
      return sdxlRunner
        .run(data, width, height)
        .then((score) => ({ ok: true, score }))
        .catch(() => ({ ok: true, score: 0.5 }));
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
