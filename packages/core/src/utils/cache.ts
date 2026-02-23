/**
 * Simple LRU-like in-memory cache for detection results.
 * Key: content hash or URL, Value: DetectionResult with timestamp.
 */
export class DetectionCache<T> {
  private readonly cache: Map<string, { value: T; timestamp: number }> = new Map();

  constructor(
    private readonly maxSize: number = 200,
    private readonly ttlMs: number = 5 * 60 * 1000 // 5 minutes
  ) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }
}
