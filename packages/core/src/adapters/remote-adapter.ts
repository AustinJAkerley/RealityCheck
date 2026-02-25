/**
 * Remote adapter interface and implementations.
 *
 * All remote adapters implement the RemoteAdapter interface so the
 * detection pipeline can swap providers without changing detector logic.
 *
 * Default flow: POST directly to the Azure APIM OpenAI endpoint
 * (DEFAULT_REMOTE_ENDPOINT) using AzureOpenAIAdapter with Bearer token auth.
 * API keys are only required when calling the endpoint directly.
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
 * OpenAI-compatible adapter (standard api.openai.com) — for development/advanced use only.
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
 * Azure OpenAI adapter — supports both Azure OpenAI Service and Azure API Management
 * (APIM) gateway endpoints, using the **Responses API** format.
 *
 * `baseUrl` must include the `/openai` path segment when applicable, e.g.:
 *   https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai  (APIM)
 *   https://{resource}.openai.azure.com/openai                     (direct)
 *
 * The Responses API URL is constructed as:
 *   {baseUrl}/deployments/{deployment}/responses?api-version={apiVersion}
 *
 * Authentication uses the `Authorization: Bearer` header, which is the format
 * expected by Azure API Management (APIM) gateways.
 *
 * Supports both image (vision via input_image) and text classification.
 */
export class AzureOpenAIAdapter implements RemoteAdapter {
  private readonly baseUrl: string;
  private readonly deployment: string;
  private readonly apiVersion: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    deployment = 'gpt-5-1-chat',
    apiVersion = '2024-10-21',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deployment = deployment;
    this.apiVersion = apiVersion;
  }

  async classify(
    contentType: ContentType,
    payload: RemotePayload
  ): Promise<RemoteClassificationResult> {
    let input: unknown[];

    if (contentType === 'image') {
      const userContent: unknown[] = [];
      if (payload.imageDataUrl) {
        userContent.push({ type: 'input_image', image_url: payload.imageDataUrl });
      } else if (payload.imageUrl) {
        // Cross-origin images can't be canvas-encoded; pass the URL directly so the
        // vision model can fetch it (OpenAI vision supports URL inputs natively).
        userContent.push({ type: 'input_image', image_url: payload.imageUrl });
      }
      userContent.push({
        type: 'input_text',
        text: 'Is this image AI-generated? Respond with JSON only: {"score": <0.0-1.0>, "label": "<ai|human|uncertain>"}',
      });

      input = [
        {
          role: 'system',
          content:
            'You are an AI-generated image detector. Analyse the provided image and determine whether it was ' +
            'generated by an AI model (e.g. DALL-E, Midjourney, Stable Diffusion) or captured by a real ' +
            'camera / created by a human artist. ' +
            'Respond with JSON only: {"score": <0.0–1.0 probability of AI generation>, ' +
            '"label": "<ai|human|uncertain>"}. ' +
            'Use score >= 0.65 for ai, score <= 0.35 for human, anything between for uncertain. Be conservative.',
        },
        { role: 'user', content: userContent },
      ];
    } else if (contentType === 'text' && payload.text) {
      input = [
        {
          role: 'system',
          content:
            'You are an AI content detector. Analyse the following text and respond with JSON only: ' +
            '{"score": <0-1 probability of AI generation>, "label": "<human|ai|uncertain>"}. ' +
            'Be conservative — only return high scores for text that is highly likely AI-generated.',
        },
        { role: 'user', content: payload.text.slice(0, 2000) },
      ];
    } else {
      return { score: 0.5, label: 'unsupported' };
    }

    const url =
      `${this.baseUrl}/deployments/${this.deployment}/responses?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.deployment,
        input,
        text: {
          format: {
            type: 'json_schema',
            name: 'AIDetectionResult',
            schema: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                label: { type: 'string' },
              },
              required: ['score', 'label'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI API HTTP ${response.status}`);
    }

    // Responses API returns: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
    const data = (await response.json()) as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      output_text?: string;
    };

    // Try output_text first (convenience field), then walk the output array
    const raw =
      data.output_text ??
      data.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text ??
      '{}';

    let parsed: { score?: unknown; label?: unknown };
    try {
      parsed = JSON.parse(raw) as { score?: unknown; label?: unknown };
    } catch {
      parsed = {};
    }
    return {
      score: typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : 0.5,
      label: typeof parsed.label === 'string' ? parsed.label : 'uncertain',
    };
  }
}

/**
 * Create the appropriate remote adapter.
 * When endpoint is empty or omitted, falls back to DEFAULT_REMOTE_ENDPOINT (no auth).
 * Adapter selection (most-specific first):
 *  1. `*.openai.azure.com` or `*.azure-api.net` → AzureOpenAIAdapter
 *  2. `api.openai.com` or `*.openai.com` → OpenAIAdapter
 *  3. Everything else → GenericHttpAdapter (default)
 */
export function createRemoteAdapter(
  endpoint: string = DEFAULT_REMOTE_ENDPOINT,
  apiKey = ''
): RemoteAdapter {
  const url = endpoint.trim() || DEFAULT_REMOTE_ENDPOINT;
  try {
    const { hostname } = new URL(url);
    if (hostname.endsWith('.openai.azure.com') || hostname.endsWith('.azure-api.net')) {
      return new AzureOpenAIAdapter(apiKey, url);
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return new OpenAIAdapter(apiKey);
    }
  } catch {
    // Invalid URL — fall through to generic adapter
  }
  return new GenericHttpAdapter(url, apiKey);
}
