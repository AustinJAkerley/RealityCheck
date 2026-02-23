import { DEFAULT_SETTINGS } from '../types.js';
function getBrowserStorage() {
    if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
        return {
            get: (keys) => new Promise((resolve, reject) => chrome.storage.sync.get(keys, (result) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(result);
            })),
            set: (items) => new Promise((resolve, reject) => chrome.storage.sync.set(items, () => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve();
            })),
        };
    }
    if (typeof globalThis.browser !==
        'undefined' &&
        globalThis.browser?.storage?.sync) {
        const bStorage = globalThis.browser.storage.sync;
        return {
            get: (keys) => bStorage.get(keys),
            set: (items) => bStorage.set(items),
        };
    }
    return null;
}
const SETTINGS_KEY = 'rc_settings';
export class SettingsStorage {
    constructor() {
        this.memCache = null;
        this.backend = getBrowserStorage();
    }
    async load() {
        if (this.backend) {
            const data = await this.backend.get([SETTINGS_KEY]);
            const stored = data[SETTINGS_KEY];
            if (stored) {
                // Deep merge with defaults so new fields are populated
                this.memCache = deepMerge(DEFAULT_SETTINGS, stored);
                return this.memCache;
            }
        }
        else if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                try {
                    const stored = JSON.parse(raw);
                    this.memCache = deepMerge(DEFAULT_SETTINGS, stored);
                    return this.memCache;
                }
                catch {
                    // ignore
                }
            }
        }
        this.memCache = structuredClone(DEFAULT_SETTINGS);
        return this.memCache;
    }
    async save(settings) {
        this.memCache = settings;
        if (this.backend) {
            await this.backend.set({ [SETTINGS_KEY]: settings });
        }
        else if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        }
    }
    getCached() {
        return this.memCache ?? structuredClone(DEFAULT_SETTINGS);
    }
}
// Simple deep merge — last-write wins for primitives, recursively merges objects
function deepMerge(base, override) {
    const result = structuredClone(base);
    for (const key of Object.keys(override)) {
        const val = override[key];
        if (val !== undefined && val !== null) {
            if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
                result[key] = deepMerge(result[key], val);
            }
            else {
                result[key] = val;
            }
        }
    }
    return result;
}
//# sourceMappingURL=settings-storage.js.map