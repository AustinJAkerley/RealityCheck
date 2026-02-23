/**
 * Settings storage — wraps browser.storage.sync (or chrome.storage.sync).
 * Falls back to localStorage for unit tests / environments without the
 * extension storage API.
 */
import type { ExtensionSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';

type StorageBackend = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function getBrowserStorage(): StorageBackend | null {
  if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
    return {
      get: (keys) =>
        new Promise((resolve, reject) =>
          chrome.storage.sync.get(keys, (result) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result);
          })
        ),
      set: (items) =>
        new Promise((resolve, reject) =>
          chrome.storage.sync.set(items, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          })
        ),
    };
  }
  if (
    typeof (globalThis as unknown as { browser?: { storage?: { sync?: unknown } } }).browser !==
      'undefined' &&
    (globalThis as unknown as { browser: { storage: { sync: unknown } } }).browser?.storage?.sync
  ) {
    const bStorage = (
      globalThis as unknown as { browser: { storage: { sync: StorageBackend } } }
    ).browser.storage.sync;
    return {
      get: (keys) => bStorage.get(keys) as Promise<Record<string, unknown>>,
      set: (items) => bStorage.set(items) as Promise<void>,
    };
  }
  return null;
}

const SETTINGS_KEY = 'rc_settings';

export class SettingsStorage {
  private backend: StorageBackend | null;
  private memCache: ExtensionSettings | null = null;

  constructor() {
    this.backend = getBrowserStorage();
  }

  async load(): Promise<ExtensionSettings> {
    if (this.backend) {
      const data = await this.backend.get([SETTINGS_KEY]);
      const stored = data[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
      if (stored) {
        // Deep merge with defaults so new fields are populated
        this.memCache = deepMerge(DEFAULT_SETTINGS, stored);
        return this.memCache;
      }
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        try {
          const stored = JSON.parse(raw) as Partial<ExtensionSettings>;
          this.memCache = deepMerge(DEFAULT_SETTINGS, stored);
          return this.memCache;
        } catch {
          // ignore
        }
      }
    }
    this.memCache = structuredClone(DEFAULT_SETTINGS);
    return this.memCache;
  }

  async save(settings: ExtensionSettings): Promise<void> {
    this.memCache = settings;
    if (this.backend) {
      await this.backend.set({ [SETTINGS_KEY]: settings });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }

  getCached(): ExtensionSettings {
    return this.memCache ?? structuredClone(DEFAULT_SETTINGS);
  }
}

// Simple deep merge — last-write wins for primitives, recursively merges objects
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result: T = structuredClone(base);
  for (const key of Object.keys(override) as Array<keyof T>) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
        (result[key] as unknown) = deepMerge(
          result[key] as object,
          val as Partial<typeof result[typeof key]>
        );
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}
