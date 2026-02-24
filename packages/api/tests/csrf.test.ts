/**
 * Tests for the CSRF protection middleware.
 */
import type { Request, Response, NextFunction } from 'express';
import { csrfMiddleware, getAllowedOrigins } from '../src/middleware/csrf';

function makeReqRes(headers: Record<string, string>): [Request, Response, NextFunction] {
  const req = { headers } as unknown as Request;
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return [req, res, next];
}

describe('getAllowedOrigins', () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  test('returns empty set when env var is not set', () => {
    expect(getAllowedOrigins().size).toBe(0);
  });

  test('parses comma-separated origins', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.com, https://b.com';
    const set = getAllowedOrigins();
    expect(set.has('https://a.com')).toBe(true);
    expect(set.has('https://b.com')).toBe(true);
  });
});

describe('csrfMiddleware', () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  test('returns 403 when X-RealityCheck-Request header is absent', () => {
    const [req, res, next] = makeReqRes({});
    csrfMiddleware(req, res, next);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when custom header is present and no origin', () => {
    const [req, res, next] = makeReqRes({ 'x-realitycheck-request': '1' });
    csrfMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('calls next() for a browser-extension origin', () => {
    const [req, res, next] = makeReqRes({
      'x-realitycheck-request': '1',
      origin: 'chrome-extension://abcdefgh',
    });
    csrfMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 403 for an untrusted web origin', () => {
    const [req, res, next] = makeReqRes({
      'x-realitycheck-request': '1',
      origin: 'https://evil.com',
    });
    csrfMiddleware(req, res, next);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() for an allowed web origin', () => {
    process.env.ALLOWED_ORIGINS = 'https://trusted.com';
    const [req, res, next] = makeReqRes({
      'x-realitycheck-request': '1',
      origin: 'https://trusted.com',
    });
    csrfMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows moz-extension:// origin', () => {
    const [req, res, next] = makeReqRes({
      'x-realitycheck-request': '1',
      origin: 'moz-extension://someid',
    });
    csrfMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
