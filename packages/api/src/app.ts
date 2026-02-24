/**
 * Express application factory for the RealityCheck API.
 *
 * Creates and configures a fully-wired Express app without starting a
 * TCP listener.  This separation allows `index.ts` to start the server
 * and tests to import `createApp()` directly without binding a port.
 *
 * Security layers (applied in order):
 *  1. `helmet`             — sets secure HTTP response headers.
 *  2. `cors`               — enforces allowed origins for browser requests.
 *  3. `express.json`       — parses JSON bodies (with size limit).
 *  4. `authMiddleware`     — validates Bearer token when CLASSIFY_API_KEY is set.
 *  5. `csrfMiddleware`     — validates Origin + custom request header.
 *  6. `rateLimit`          — token-bucket rate limiter per IP.
 *  7. Routes               — classify, health.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware } from './middleware/auth';
import { csrfMiddleware, getAllowedOrigins } from './middleware/csrf';
import { classifyRouter } from './routes/classify';
import { healthRouter } from './routes/health';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Build the dynamic origin allow-list: extension origins + configured origins.
  const extensionPrefixes = [
    'chrome-extension://',
    'moz-extension://',
    'safari-web-extension://',
    'ms-browser-extension://',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Server-to-server (no Origin header) — allow.
        if (!origin) {
          callback(null, true);
          return;
        }
        // Browser extension origins — always allow.
        if (extensionPrefixes.some((p) => origin.startsWith(p))) {
          callback(null, true);
          return;
        }
        // Configured allow-list.
        if (getAllowedOrigins().has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      methods: ['POST', 'GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-RealityCheck-Request'],
    })
  );

  // ── Body parsing ───────────────────────────────────────────────────────────
  // Limit body size to 4 MB to cover the largest permissible image payload.
  app.use(express.json({ limit: '4mb' }));

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // 60 requests per minute per IP.  Azure Front Door / App Gateway forwards
  // the real client IP in X-Forwarded-For; set `trustProxy` in production.
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use(limiter);

  // ── Authentication ─────────────────────────────────────────────────────────
  app.use(authMiddleware);

  // ── CSRF protection ────────────────────────────────────────────────────────
  // Applied only to /v1/* routes, not the public /health endpoint.
  app.use('/v1', csrfMiddleware);

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.use('/v1/classify', classifyRouter);
  app.use('/health', healthRouter);

  // ── 404 fallback ───────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
