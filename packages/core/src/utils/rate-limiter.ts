/**
 * Token-bucket rate limiter to avoid flooding remote APIs.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 10,
    private readonly refillIntervalMs: number = 60_000 // 1 minute
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      const periods = Math.floor(elapsed / this.refillIntervalMs);
      this.tokens = Math.min(this.maxTokens, this.tokens + periods * this.maxTokens);
      this.lastRefill = now;
    }
  }

  canConsume(count = 1): boolean {
    this.refill();
    return this.tokens >= count;
  }

  consume(count = 1): boolean {
    if (!this.canConsume(count)) return false;
    this.tokens -= count;
    return true;
  }

  /** Return tokens that were consumed but not actually used (e.g. a failed API call). */
  returnToken(count = 1): void {
    this.tokens = Math.min(this.maxTokens, this.tokens + count);
  }

  get remainingTokens(): number {
    this.refill();
    return this.tokens;
  }
}
