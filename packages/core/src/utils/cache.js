/**
 * Simple LRU-like in-memory cache for detection results.
 * Key: content hash or URL, Value: DetectionResult with timestamp.
 */
export class DetectionCache {
    constructor(maxSize = 200, ttlMs = 5 * 60 * 1000 // 5 minutes
    ) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            // Evict oldest entry
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    clear() {
        this.cache.clear();
    }
}
//# sourceMappingURL=cache.js.map