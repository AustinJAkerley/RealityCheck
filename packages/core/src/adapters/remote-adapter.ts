/**
 * Remote adapter interface and implementations.
 *
 * All remote adapters implement the RemoteAdapter interface so the
 * detection pipeline can swap providers without changing detector logic.
 *
 * Default flow: POST to DEFAULT_REMOTE_ENDPOINT with no auth header.
 * The Azure-hosted proxy handles downstream authentication; users do not
 * need to provide API keys. API keys are only used for custom dev endpoints.
 */
import type { ContentType, RemoteAdapter, RemoteClassificationResult, RemotePayload } from '../types.js';
import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';

/**
 * Generic HTTP adapter that posts to a configured endpoint.
 * Omits the Authorization header when no API key is provided (default flow).
 */
export class GenericHttpAdapter implements RemoteAdapter {
  constructor(private readonly endpoint: string, private readonly apiKey: string = '') {}

  async classify(
    contentType: ContentType,
    payload: RemotePayload
  ): Promise<RemoteClassificationResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RealityCheck-Request': '1',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ contentType, ...payload }),
    });

    if (!response.ok) {
      throw new Error(`Remote adapter HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { score?: number; label?: string };
    return {
      score: typeof data.score === 'number' ? data.score : 0,
      label: typeof data.label === 'string' ? data.label : 'unknown',
    };
  }
}

/**
 * OpenAI-compatible adapter — for development/advanced use only.
 * The default extension flow uses GenericHttpAdapter against our hosted endpoint.
 */
export class OpenAIAdapter implements RemoteAdapter {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1'
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async classify(
    contentType: ContentType,
    payload: RemotePayload
  ): Promise<RemoteClassificationResult> {
    if (contentType !== 'text' || !payload.text) {
      return { score: 0.5, label: 'unsupported' };
    }

    const systemPrompt =
      'You are an AI content detector. Analyse the following text and respond with JSON: ' +
      '{"score": <0-1 probability of AI generation>, "label": "<human|ai|uncertain>"}. ' +
      'Be conservative — only return high scores for text that is highly likely AI-generated.';

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: payload.text.slice(0, 2000) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 64,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { score?: number; label?: string };
    return {
      score: typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : 0.5,
      label: typeof parsed.label === 'string' ? parsed.label : 'uncertain',
    };
  }
}

/**
 * Create the appropriate remote adapter.
 * When endpoint is empty or omitted, falls back to DEFAULT_REMOTE_ENDPOINT (no auth).
 * Selects OpenAIAdapter only when the endpoint hostname is exactly api.openai.com
 * or a subdomain — never based on substring matching.
 */
export function createRemoteAdapter(
  endpoint: string = DEFAULT_REMOTE_ENDPOINT,
  apiKey = ''
): RemoteAdapter {
  const url = endpoint.trim() || DEFAULT_REMOTE_ENDPOINT;
  try {
    const { hostname } = new URL(url);
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return new OpenAIAdapter(apiKey);
    }
  } catch {
    // Invalid URL — fall through to generic adapter
  }
  return new GenericHttpAdapter(url, apiKey);
}
