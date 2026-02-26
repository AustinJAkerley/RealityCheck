/**
 * RealityCheck Chrome Extension — Offscreen Document
 *
 * Runs Transformers.js / ONNX Runtime inference in a full DOM context.
 * Chrome MV3 service workers forbid dynamic import() and WASM, so the
 * background service worker creates this offscreen document and forwards
 * SDXL_CLASSIFY requests here.
 *
 * Lifecycle: created lazily on first SDXL_CLASSIFY and kept alive for
 * subsequent calls so the model stays warm in memory.
 */

import { SettingsStorage, createSdxlDetectorRunner, MlModelRunner } from '@reality-check/core';

const storage = new SettingsStorage();

/** Lazy-initialised SDXL runner — only created once. */
let sdxlRunner: MlModelRunner | null = null;

async function ensureRunner(): Promise<MlModelRunner> {
  if (!sdxlRunner) {
    const settings = await storage.load();
    sdxlRunner = createSdxlDetectorRunner({ hfToken: settings.hfToken || undefined });
  }
  return sdxlRunner;
}

// Listen for messages forwarded by the background service worker.
chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload?: unknown },
    _sender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === 'OFFSCREEN_SDXL_CLASSIFY') {
      const { data, width, height } = message.payload as {
        data: Uint8ClampedArray;
        width: number;
        height: number;
      };

      ensureRunner()
        .then((runner) => runner.run(data, width, height))
        .then((score) => {
          console.log('[RealityCheck:offscreen] SDXL_CLASSIFY score:', score);
          sendResponse({ ok: true, score });
        })
        .catch((err: unknown) => {
          console.error(
            '[RealityCheck:offscreen] SDXL_CLASSIFY error:',
            err instanceof Error ? err.message : err,
          );
          sendResponse({ ok: false, score: 0.5 });
        });
      return true; // async response
    }

    if (message.type === 'SAVE_SETTINGS') {
      // Settings changed — reset the runner so the next call picks up the new hfToken.
      sdxlRunner = null;
    }

    return false;
  },
);

console.log('[RealityCheck] Offscreen document ready');
