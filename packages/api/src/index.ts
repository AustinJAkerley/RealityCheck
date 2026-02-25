/**
 * Entry point for the RealityCheck API server.
 *
 * Reads PORT from the environment (default 3000) and starts listening.
 * Azure App Service sets PORT automatically; no manual configuration is
 * needed in production.
 *
 * Environment variables:
 *   PORT                     — TCP port to listen on (default: 3000)
 *   CLASSIFY_API_KEY         — Shared secret the extension sends as a Bearer token.
 *                              When unset, authentication is skipped (dev mode).
 *   ALLOWED_ORIGINS          — Comma-separated list of additional trusted web origins.
 *                              Browser-extension origins are always trusted.
 *   AZURE_OPENAI_ENDPOINT    — Azure OpenAI resource endpoint, e.g.
 *                              https://myhackathon.openai.azure.com
 *                              When set together with AZURE_OPENAI_API_KEY, image
 *                              classification is performed by GPT-4o vision instead
 *                              of the built-in heuristic analyser.
 *   AZURE_OPENAI_API_KEY     — Azure OpenAI resource key.
 *   AZURE_OPENAI_DEPLOYMENT  — Model deployment name (default: gpt-5-1-chat).
 *   AZURE_OPENAI_API_VERSION — Azure OpenAI API version (default: 2024-02-01).
 */
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();

app.listen(PORT, () => {
  console.log(`[RealityCheck API] Listening on port ${PORT}`);
});
