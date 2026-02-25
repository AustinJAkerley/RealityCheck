/**
 * RealityCheck Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * - Maintain extension settings in chrome.storage.sync
 * - Handle messages from content scripts and popup
 * - Broadcast settings changes to active content scripts
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings, createRemoteAdapter } from '@reality-check/core';
import type { ContentType, RemotePayload } from '@reality-check/core';

const storage = new SettingsStorage();

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
          // Broadcast updated settings to all tabs
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

    if (message.type === 'FETCH_IMAGE_BYTES') {
      // Fetch image bytes on behalf of the content script.
      // Background service workers are not subject to CORS restrictions,
      // allowing EXIF and C2PA metadata to be read from cross-origin images.
      const url = message.payload as string;
      fetch(url)
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
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch(() => sendResponse({ ok: false, dataUrl: null }));
      return true; // async response
    }

    if (message.type === 'REMOTE_CLASSIFY') {
      // Perform remote classification on behalf of the content script.
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
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }

    return false;
  }
);
