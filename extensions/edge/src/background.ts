/**
 * RealityCheck Edge Extension — Background Service Worker
 *
 * Responsibilities:
 * - Maintain extension settings in chrome.storage.sync
 * - Handle messages from content scripts and popup
 * - Broadcast settings changes to active content scripts
 * - Run SDXL model inference (SDXL_CLASSIFY) — content scripts can't load WASM
 * - Route remote ML calls (REMOTE_CLASSIFY) — bypasses CORS restrictions
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings, createRemoteAdapter } from '@reality-check/core';
import type { ContentType, RemotePayload } from '@reality-check/core';

const storage = new SettingsStorage();

// ---------------------------------------------------------------------------
// Offscreen document helpers — WASM / ONNX Runtime cannot run inside a
// Chromium MV3 service worker (dynamic import() is disallowed).  We create an
// offscreen document that hosts Transformers.js and forward SDXL_CLASSIFY
// messages to it.
// ---------------------------------------------------------------------------
const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offscreen = (chrome as any).offscreen;
  if (!offscreen) {
    throw new Error('chrome.offscreen API not available — requires Edge 109+');
  }

  if (await offscreen.hasDocument?.()) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [offscreen.Reason?.DOM_SCRAPING ?? 'DOM_SCRAPING'],
    justification: 'Run ONNX Runtime WASM inference for AI image classification',
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// Ensure default settings exist on install
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await storage.load();
  await storage.save(settings);
  console.log('[RealityCheck] Extension installed. Settings:', settings);
});

// Message handler
chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload?: unknown },
    _sender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === 'GET_SETTINGS') {
      storage.load().then(sendResponse).catch(() => sendResponse(DEFAULT_SETTINGS));
      return true; // async response
    }

    if (message.type === 'SAVE_SETTINGS') {
      const newSettings = message.payload as ExtensionSettings;
      storage
        .save(newSettings)
        .then(() => {
          // Broadcast updated settings to all tabs (the offscreen document also
          // listens for SAVE_SETTINGS and resets its runner automatically).
          chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
              if (tab.id !== undefined) {
                chrome.tabs
                  .sendMessage(tab.id, { type: 'SETTINGS_UPDATED', payload: newSettings })
                  .catch(() => {
                    // Tab may not have a content script — ignore
                  });
              }
            }
          });
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message.type === 'REPORT_FALSE_POSITIVE') {
      // Persist report locally (no network call unless user opts in)
      console.log('[RealityCheck] False positive reported:', message.payload);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'SDXL_CLASSIFY') {
      // Forward to the offscreen document where WASM / dynamic import() are allowed.
      ensureOffscreenDocument()
        .then(() =>
          chrome.runtime.sendMessage({
            type: 'OFFSCREEN_SDXL_CLASSIFY',
            payload: message.payload,
          }),
        )
        .then((response) => {
          const res = response as { ok: boolean; score: number } | undefined;
          const score = res?.ok && typeof res.score === 'number' ? res.score : 0.5;
          console.log('[RealityCheck] SDXL_CLASSIFY score:', score);
          sendResponse({ ok: true, score });
        })
        .catch((err: unknown) => {
          console.error('[RealityCheck] SDXL_CLASSIFY error:', err instanceof Error ? err.message : err);
          sendResponse({ ok: true, score: 0.5 });
        });
      return true; // async response
    }

    if (message.type === 'REMOTE_CLASSIFY') {
      // Background service workers are not subject to CORS restrictions,
      // so the fetch to the Azure OpenAI APIM endpoint succeeds here.
      const { endpoint, apiKey, contentType, payload } = message.payload as {
        endpoint: string;
        apiKey: string;
        contentType: ContentType;
        payload: RemotePayload;
      };
      const adapter = createRemoteAdapter(endpoint, apiKey);
      adapter
        .classify(contentType, payload)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err: Error) => {
          console.warn('[RealityCheck] Remote classification error:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true; // async response
    }

    return false;
  }
);
