/**
 * Simple LRU-like in-memory cache for detection results.
 * Key: content hash or URL, Value: DetectionResult with timestamp.
 */
export declare class DetectionCache<T> {
    private readonly maxSize;
    private readonly ttlMs;
    private readonly cache;
    constructor(maxSize?: number, ttlMs?: number);
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    has(key: string): boolean;
    clear(): void;
}
//# sourceMappingURL=cache.d.ts.map