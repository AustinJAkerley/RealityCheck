/**
 * Entry point for the RealityCheck API server.
 *
 * Reads PORT from the environment (default 3000) and starts listening.
 * Azure App Service sets PORT automatically; no manual configuration is
 * needed in production.
 *
 * Environment variables:
 *   PORT              — TCP port to listen on (default: 3000)
 *   CLASSIFY_API_KEY  — Shared secret the extension sends as a Bearer token.
 *                       When unset, authentication is skipped (dev mode).
 *   ALLOWED_ORIGINS   — Comma-separated list of additional trusted web origins.
 *                       Browser-extension origins are always trusted.
 */
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();

app.listen(PORT, () => {
  console.log(`[RealityCheck API] Listening on port ${PORT}`);
});
