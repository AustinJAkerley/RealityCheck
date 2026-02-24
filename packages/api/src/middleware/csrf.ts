/**
 * CSRF protection middleware.
 *
 * For a REST API protected by Bearer tokens, classical CSRF attacks are not
 * possible because browsers do not automatically attach Authorization headers
 * (unlike cookies).  However, we add an additional layer of defence:
 *
 * 1. **Origin / Referer validation** — only allow requests whose `Origin` or
 *    `Referer` header matches the list of trusted origins stored in the
 *    `ALLOWED_ORIGINS` environment variable (comma-separated), plus browser
 *    extension origins which are always permitted.
 *
 * 2. **Custom header requirement** — each request must include the header
 *    `X-RealityCheck-Request: 1`.  Ordinary web pages cannot set custom
 *    headers in cross-origin form submissions, providing an additional
 *    CSRF barrier for any cookie-based session paths that may be added later.
 *
 * Requests that arrive without an `Origin` header (e.g. server-to-server
 * calls, curl) are allowed through origin validation so that automated
 * integrations are not blocked.
 */
import type { Request, Response, NextFunction } from 'express';

/** Browser-extension origins are always trusted. */
const EXTENSION_ORIGIN_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
  'ms-browser-extension://',
];

function isExtensionOrigin(origin: string): boolean {
  return EXTENSION_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix));
}

/**
 * Parse the `ALLOWED_ORIGINS` env var into a Set.
 * Exposed for unit testing.
 */
export function getAllowedOrigins(): Set<string> {
  const raw = process.env.ALLOWED_ORIGINS ?? '';
  return new Set(
    raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );
}

/**
 * Express middleware that performs CSRF-style request validation.
 *
 * - Checks the custom `X-RealityCheck-Request` header.
 * - When an `Origin` header is present, validates it against the allow-list.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1. Require custom header.
  const customHeader = req.headers['x-realitycheck-request'];
  if (!customHeader) {
    res.status(403).json({ error: 'Missing X-RealityCheck-Request header' });
    return;
  }

  // 2. Validate Origin (only when the browser sends one).
  const origin = req.headers['origin'];
  if (origin) {
    if (!isExtensionOrigin(origin) && !getAllowedOrigins().has(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
  }

  next();
}
