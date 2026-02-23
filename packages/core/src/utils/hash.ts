/**
 * Lightweight content hashing utilities.
 * Uses a simple djb2-style string hash for text;
 * for images we hash a small portion of the data URL.
 */

export function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}

/**
 * Produces a short hash key from a text snippet (first 500 chars).
 */
export function hashText(text: string): string {
  return hashString(text.slice(0, 500).trim());
}

/**
 * Produces a hash from the first 256 characters of a data URL.
 * Fast, not cryptographically strong — only used for caching.
 */
export function hashDataUrl(dataUrl: string): string {
  return hashString(dataUrl.slice(0, 256));
}

/**
 * Produces a hash from a URL string (for caching by src).
 */
export function hashUrl(url: string): string {
  return hashString(url);
}
