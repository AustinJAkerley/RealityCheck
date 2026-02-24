/**
 * Authentication middleware.
 *
 * Validates the caller's identity via a Bearer token.
 * The expected key is read from the `CLASSIFY_API_KEY` environment variable.
 *
 * When `CLASSIFY_API_KEY` is not set the middleware falls through (useful for
 * local development without any configuration).  Set the variable to a
 * non-empty secret in all production deployments.
 *
 * Accepted header format:
 *   Authorization: Bearer <key>
 */
import type { Request, Response, NextFunction } from 'express';

/**
 * Return the configured API key from the environment, or null if not set.
 * Exposed for unit testing.
 */
export function getConfiguredApiKey(): string | null {
  const key = process.env.CLASSIFY_API_KEY;
  return key && key.trim() !== '' ? key.trim() : null;
}

/**
 * Express middleware that enforces Bearer-token authentication.
 *
 * - If `CLASSIFY_API_KEY` is not configured: passes through (dev mode).
 * - If the header is absent or the token does not match: returns 401.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = getConfiguredApiKey();

  // No key configured — allow all requests (development / test environment).
  if (!configuredKey) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (token !== configuredKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
