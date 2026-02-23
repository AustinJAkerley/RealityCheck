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
/**
 * Generic HTTP adapter that posts to a configured endpoint.
 * Omits the Authorization header when no API key is provided (default flow).
 */
export declare class GenericHttpAdapter implements RemoteAdapter {
    private readonly endpoint;
    private readonly apiKey;
    constructor(endpoint: string, apiKey?: string);
    classify(contentType: ContentType, payload: RemotePayload): Promise<RemoteClassificationResult>;
}
/**
 * OpenAI-compatible adapter — for development/advanced use only.
 * The default extension flow uses GenericHttpAdapter against our hosted endpoint.
 */
export declare class OpenAIAdapter implements RemoteAdapter {
    private readonly apiKey;
    private readonly model;
    private readonly baseUrl;
    constructor(apiKey: string, model?: string, baseUrl?: string);
    classify(contentType: ContentType, payload: RemotePayload): Promise<RemoteClassificationResult>;
}
/**
 * Create the appropriate remote adapter.
 * When endpoint is empty or omitted, falls back to DEFAULT_REMOTE_ENDPOINT (no auth).
 * Selects OpenAIAdapter only when the endpoint hostname is exactly api.openai.com
 * or a subdomain — never based on substring matching.
 */
export declare function createRemoteAdapter(endpoint?: string, apiKey?: string): RemoteAdapter;
//# sourceMappingURL=remote-adapter.d.ts.map