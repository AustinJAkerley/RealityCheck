/**
 * Remote adapter interface and implementations.
 *
 * All remote adapters implement the RemoteAdapter interface so the
 * detection pipeline can swap providers without changing detector logic.
 *
 * Privacy: no content is sent off-device unless the user has enabled
 * "Remote detection" mode and explicitly opted in.
 */
import type { ContentType, RemoteAdapter, RemoteClassificationResult, RemotePayload } from '../types.js';

/**
 * Generic HTTP adapter that posts to a user-configured endpoint.
 * Expected response: { score: number; label: string }
 */
export class GenericHttpAdapter implements RemoteAdapter {
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}

  async classify(
    contentType: ContentType,
    payload: RemotePayload
  ): Promise<RemoteClassificationResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
 * OpenAI-compatible adapter using chat completions.
 * Sends text content to a model (e.g. gpt-4o) and parses the response.
 * Only text is supported for now; images can be added via vision API.
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
      // Image/video classification via OpenAI requires additional setup;
      // fall back to a neutral score if unsupported payload
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
 * Create the appropriate remote adapter from settings.
 */
export function createRemoteAdapter(
  endpoint: string,
  apiKey: string
): RemoteAdapter {
  if (endpoint.includes('api.openai.com') || endpoint.includes('openai')) {
    return new OpenAIAdapter(apiKey);
  }
  return new GenericHttpAdapter(endpoint, apiKey);
}
