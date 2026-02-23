/**
 * Lightweight content hashing utilities.
 * Uses a simple djb2-style string hash for text;
 * for images we hash a small portion of the data URL.
 */
export declare function hashString(str: string): string;
/**
 * Produces a short hash key from a text snippet (first 500 chars).
 */
export declare function hashText(text: string): string;
/**
 * Produces a hash from the first 256 characters of a data URL.
 * Fast, not cryptographically strong — only used for caching.
 */
export declare function hashDataUrl(dataUrl: string): string;
/**
 * Produces a hash from a URL string (for caching by src).
 */
export declare function hashUrl(url: string): string;
//# sourceMappingURL=hash.d.ts.map