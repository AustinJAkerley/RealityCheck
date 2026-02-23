/**
 * Settings storage — wraps browser.storage.sync (or chrome.storage.sync).
 * Falls back to localStorage for unit tests / environments without the
 * extension storage API.
 */
import type { ExtensionSettings } from '../types.js';
export declare class SettingsStorage {
    private backend;
    private memCache;
    constructor();
    load(): Promise<ExtensionSettings>;
    save(settings: ExtensionSettings): Promise<void>;
    getCached(): ExtensionSettings;
}
//# sourceMappingURL=settings-storage.d.ts.map