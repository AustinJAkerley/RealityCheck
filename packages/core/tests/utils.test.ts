import { DetectionCache } from '../src/utils/cache';
import { RateLimiter } from '../src/utils/rate-limiter';
import { hashString, hashText, hashUrl } from '../src/utils/hash';

describe('DetectionCache', () => {
  test('stores and retrieves values', () => {
    const cache = new DetectionCache<number>(100, 60_000);
    cache.set('key1', 42);
    expect(cache.get('key1')).toBe(42);
  });

  test('returns undefined for missing keys', () => {
    const cache = new DetectionCache<number>();
    expect(cache.get('missing')).toBeUndefined();
  });

  test('evicts expired entries', () => {
    const cache = new DetectionCache<number>(100, 1); // 1ms TTL
    cache.set('key', 99);
    // Wait briefly so TTL expires
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(cache.get('key')).toBeUndefined();
  });

  test('evicts oldest when over max size', () => {
    const cache = new DetectionCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  test('clear empties the cache', () => {
    const cache = new DetectionCache<number>();
    cache.set('x', 1);
    cache.clear();
    expect(cache.get('x')).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  test('allows consuming up to max tokens', () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume()).toBe(true);
    }
  });

  test('rejects when tokens exhausted', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.consume();
    limiter.consume();
    expect(limiter.consume()).toBe(false);
  });

  test('canConsume returns false when no tokens remain', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.consume();
    expect(limiter.canConsume()).toBe(false);
  });

  test('remainingTokens decrements correctly', () => {
    const limiter = new RateLimiter(10, 60_000);
    limiter.consume(3);
    expect(limiter.remainingTokens).toBe(7);
  });
});

describe('hash utilities', () => {
  test('hashString produces consistent results', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  test('hashString produces different results for different inputs', () => {
    expect(hashString('foo')).not.toBe(hashString('bar'));
  });

  test('hashText hashes truncated text', () => {
    const long = 'a'.repeat(1000);
    const short = 'a'.repeat(500);
    expect(hashText(long)).toBe(hashText(short)); // truncated at 500
  });

  test('hashUrl works for URLs', () => {
    const h = hashUrl('https://example.com/image.png');
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });
});
