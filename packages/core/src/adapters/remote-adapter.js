import { DEFAULT_REMOTE_ENDPOINT } from '../types.js';
/**
 * Generic HTTP adapter that posts to a configured endpoint.
 * Omits the Authorization header when no API key is provided (default flow).
 */
export class GenericHttpAdapter {
    constructor(endpoint, apiKey = '') {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
    }
    async classify(contentType, payload) {
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
        const data = (await response.json());
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
export class OpenAIAdapter {
    constructor(apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }
    async classify(contentType, payload) {
        if (contentType !== 'text' || !payload.text) {
            return { score: 0.5, label: 'unsupported' };
        }
        const systemPrompt = 'You are an AI content detector. Analyse the following text and respond with JSON: ' +
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
        const data = (await response.json());
        const raw = data?.choices?.[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw);
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
export function createRemoteAdapter(endpoint = DEFAULT_REMOTE_ENDPOINT, apiKey = '') {
    const url = endpoint.trim() || DEFAULT_REMOTE_ENDPOINT;
    try {
        const { hostname } = new URL(url);
        if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
            return new OpenAIAdapter(apiKey);
        }
    }
    catch {
        // Invalid URL — fall through to generic adapter
    }
    return new GenericHttpAdapter(url, apiKey);
}
//# sourceMappingURL=remote-adapter.js.map