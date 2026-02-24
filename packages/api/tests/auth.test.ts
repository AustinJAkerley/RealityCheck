/**
 * Tests for the authentication middleware.
 */
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware, getConfiguredApiKey } from '../src/middleware/auth';

function makeReqRes(authHeader?: string): [Request, Response, NextFunction] {
  const req = { headers: authHeader ? { authorization: authHeader } : {} } as Request;
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return [req, res, next];
}

describe('getConfiguredApiKey', () => {
  afterEach(() => {
    delete process.env.CLASSIFY_API_KEY;
  });

  test('returns null when env var is not set', () => {
    expect(getConfiguredApiKey()).toBeNull();
  });

  test('returns null when env var is empty', () => {
    process.env.CLASSIFY_API_KEY = '   ';
    expect(getConfiguredApiKey()).toBeNull();
  });

  test('returns trimmed key when set', () => {
    process.env.CLASSIFY_API_KEY = '  secret123  ';
    expect(getConfiguredApiKey()).toBe('secret123');
  });
});

describe('authMiddleware', () => {
  afterEach(() => {
    delete process.env.CLASSIFY_API_KEY;
  });

  test('calls next() when no API key is configured', () => {
    const [req, res, next] = makeReqRes();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((res.status as jest.Mock).mock.calls.length).toBe(0);
  });

  test('returns 401 when API key is configured but header is absent', () => {
    process.env.CLASSIFY_API_KEY = 'secret';
    const [req, res, next] = makeReqRes();
    authMiddleware(req, res, next);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when bearer token does not match', () => {
    process.env.CLASSIFY_API_KEY = 'secret';
    const [req, res, next] = makeReqRes('Bearer wrong');
    authMiddleware(req, res, next);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when bearer token matches', () => {
    process.env.CLASSIFY_API_KEY = 'secret';
    const [req, res, next] = makeReqRes('Bearer secret');
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 when Authorization header lacks "Bearer " prefix', () => {
    process.env.CLASSIFY_API_KEY = 'secret';
    const [req, res, next] = makeReqRes('secret');
    authMiddleware(req, res, next);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
  });
});
