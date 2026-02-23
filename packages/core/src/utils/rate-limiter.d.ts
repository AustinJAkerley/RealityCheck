/**
 * Token-bucket rate limiter to avoid flooding remote APIs.
 */
export declare class RateLimiter {
    private readonly maxTokens;
    private readonly refillIntervalMs;
    private tokens;
    private lastRefill;
    constructor(maxTokens?: number, refillIntervalMs?: number);
    private refill;
    canConsume(count?: number): boolean;
    consume(count?: number): boolean;
    get remainingTokens(): number;
}
//# sourceMappingURL=rate-limiter.d.ts.map