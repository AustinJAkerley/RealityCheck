/**
 * POST /v1/classify
 *
 * Primary classification endpoint.  Accepts a JSON body matching the
 * `RemotePayload` shape used by the browser extension's `GenericHttpAdapter`:
 *
 * ```json
 * {
 *   "contentType": "image",
 *   "imageDataUrl": "data:image/jpeg;base64,...",
 *   "imageHash": "abc123"
 * }
 * ```
 *
 * Responds with:
 * ```json
 * { "score": 0.72, "label": "ai" }
 * ```
 *
 * Error responses:
 *   400 — invalid / missing fields
 *   415 — unsupported content type (non-JSON body)
 */
import { Router, Request, Response } from 'express';
import { analyzeImage } from '../analysis/image-analyzer';
import {
  getAzureOpenAIConfig,
  classifyImageWithAzureOpenAI,
} from '../analysis/openai-classifier';

export const classifyRouter = Router();

const SUPPORTED_CONTENT_TYPES = ['image', 'video', 'text', 'audio'] as const;
type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

function isSupportedContentType(v: unknown): v is SupportedContentType {
  return typeof v === 'string' && (SUPPORTED_CONTENT_TYPES as readonly string[]).includes(v);
}

/** Maximum accepted data-URL length (~2 MB base64 ≈ 1.5 MB binary). */
const MAX_DATA_URL_LENGTH = 2_800_000;

/** Maximum accepted image hash length. */
const MAX_HASH_LENGTH = 128;

/** Maximum accepted image URL length. */
const MAX_URL_LENGTH = 2048;

classifyRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  const { contentType, imageDataUrl, imageHash, imageUrl } = body;

  // ── Validate contentType ─────────────────────────────────────────────────
  if (!isSupportedContentType(contentType)) {
    res.status(400).json({
      error: 'Invalid or missing contentType. Must be one of: image, video, text, audio.',
    });
    return;
  }

  // ── Validate optional imageDataUrl ───────────────────────────────────────
  if (imageDataUrl !== undefined) {
    if (typeof imageDataUrl !== 'string') {
      res.status(400).json({ error: 'imageDataUrl must be a string' });
      return;
    }
    if (imageDataUrl.length > MAX_DATA_URL_LENGTH) {
      res.status(400).json({ error: 'imageDataUrl exceeds maximum allowed size' });
      return;
    }
    if (!imageDataUrl.startsWith('data:')) {
      res.status(400).json({ error: 'imageDataUrl must be a data: URI' });
      return;
    }
  }

  // ── Validate optional imageHash ──────────────────────────────────────────
  if (imageHash !== undefined) {
    if (typeof imageHash !== 'string' || imageHash.length > MAX_HASH_LENGTH) {
      res.status(400).json({ error: 'imageHash must be a string of at most 128 characters' });
      return;
    }
  }

  // ── Validate optional imageUrl ───────────────────────────────────────────
  if (imageUrl !== undefined) {
    if (typeof imageUrl !== 'string' || imageUrl.length > MAX_URL_LENGTH) {
      res.status(400).json({ error: 'imageUrl must be a string of at most 2048 characters' });
      return;
    }
  }

  // ── Analyse ──────────────────────────────────────────────────────────────
  // For image content: try Azure OpenAI vision first (when configured), then
  // fall back to the heuristic analyzeImage implementation.
  // Other content types return a neutral uncertain score and will be enhanced
  // in future iterations.
  if (contentType === 'image') {
    const azureConfig = getAzureOpenAIConfig();
    if (azureConfig) {
      try {
        const result = await classifyImageWithAzureOpenAI(
          azureConfig,
          typeof imageDataUrl === 'string' ? imageDataUrl : undefined,
          typeof imageUrl === 'string' ? imageUrl : undefined
        );
        res.json({ score: result.score, label: result.label });
        return;
      } catch {
        // Azure OpenAI call failed — fall through to heuristic analysis
      }
    }

    const result = analyzeImage(
      typeof imageDataUrl === 'string' ? imageDataUrl : undefined,
      typeof imageHash === 'string' ? imageHash : undefined,
      typeof imageUrl === 'string' ? imageUrl : undefined,
    );
    res.json({ score: result.score, label: result.label });
    return;
  }

  // Fallback for unsupported content types (text, video, audio):
  // return a neutral uncertain score so the client can blend it with local results.
  res.json({ score: 0.5, label: 'uncertain' });
});
