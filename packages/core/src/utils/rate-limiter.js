/**
 * Token-bucket rate limiter to avoid flooding remote APIs.
 */
export class RateLimiter {
    constructor(maxTokens = 10, refillIntervalMs = 60000 // 1 minute
    ) {
        this.maxTokens = maxTokens;
        this.refillIntervalMs = refillIntervalMs;
        this.tokens = maxTokens;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed >= this.refillIntervalMs) {
            const periods = Math.floor(elapsed / this.refillIntervalMs);
            this.tokens = Math.min(this.maxTokens, this.tokens + periods * this.maxTokens);
            this.lastRefill = now;
        }
    }
    canConsume(count = 1) {
        this.refill();
        return this.tokens >= count;
    }
    consume(count = 1) {
        if (!this.canConsume(count))
            return false;
        this.tokens -= count;
        return true;
    }
    get remainingTokens() {
        this.refill();
        return this.tokens;
    }
}
//# sourceMappingURL=rate-limiter.js.map