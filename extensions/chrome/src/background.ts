/**
 * RealityCheck Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * - Maintain extension settings in chrome.storage.sync
 * - Handle messages from content scripts and popup
 * - Broadcast settings changes to active content scripts
 */

import { SettingsStorage, DEFAULT_SETTINGS, ExtensionSettings } from '../../packages/core/src/index.js';

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

    return false;
  }
);
