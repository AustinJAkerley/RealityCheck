/**
 * Unit tests for remote adapter implementations.
 *
 * Covers GenericHttpAdapter, OpenAIAdapter, AzureOpenAIAdapter, and
 * the createRemoteAdapter factory function.
 */
import {
  GenericHttpAdapter,
  OpenAIAdapter,
  AzureOpenAIAdapter,
  createRemoteAdapter,
} from '../src/adapters/remote-adapter';
import { DEFAULT_REMOTE_ENDPOINT } from '../src/types';

// Tiny 1×1 PNG data-URL for image tests.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function mockFetch(body: unknown, ok = true, status = 200): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ── createRemoteAdapter factory ───────────────────────────────────────────────

describe('createRemoteAdapter', () => {
  test('returns AzureOpenAIAdapter for the default endpoint', () => {
    const adapter = createRemoteAdapter();
    expect(adapter).toBeInstanceOf(AzureOpenAIAdapter);
  });

  test('returns GenericHttpAdapter when endpoint is empty (falls back to default APIM URL)', () => {
    const adapter = createRemoteAdapter('');
    expect(adapter).toBeInstanceOf(AzureOpenAIAdapter);
  });

  test('returns OpenAIAdapter for api.openai.com', () => {
    const adapter = createRemoteAdapter('https://api.openai.com/v1', 'key');
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  test('returns AzureOpenAIAdapter for *.openai.azure.com', () => {
    const adapter = createRemoteAdapter('https://hackathon.openai.azure.com/openai', 'key');
    expect(adapter).toBeInstanceOf(AzureOpenAIAdapter);
  });

  test('returns AzureOpenAIAdapter for *.azure-api.net (APIM)', () => {
    const adapter = createRemoteAdapter(
      'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai',
      'key'
    );
    expect(adapter).toBeInstanceOf(AzureOpenAIAdapter);
  });

  test('returns GenericHttpAdapter for an arbitrary endpoint', () => {
    const adapter = createRemoteAdapter('https://api.example.com/classify', 'key');
    expect(adapter).toBeInstanceOf(GenericHttpAdapter);
  });

  test('returns GenericHttpAdapter for malformed URL', () => {
    const adapter = createRemoteAdapter('not-a-url', 'key');
    expect(adapter).toBeInstanceOf(GenericHttpAdapter);
  });
});

// ── GenericHttpAdapter ────────────────────────────────────────────────────────

describe('GenericHttpAdapter', () => {
  test('POSTs to the configured endpoint with CSRF header', async () => {
    const spy = mockFetch({ score: 0.2, label: 'human' });
    const adapter = new GenericHttpAdapter('https://api.example.com/classify');
    await adapter.classify('image', { imageHash: 'abc' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.example.com/classify');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-RealityCheck-Request']).toBe('1');
  });

  test('includes Authorization header when apiKey is provided', async () => {
    const spy = mockFetch({ score: 0.5, label: 'uncertain' });
    const adapter = new GenericHttpAdapter('https://api.example.com/classify', 'my-key');
    await adapter.classify('image', {});

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-key');
  });

  test('omits Authorization header when no apiKey', async () => {
    const spy = mockFetch({ score: 0.1, label: 'human' });
    const adapter = new GenericHttpAdapter('https://api.example.com/classify');
    await adapter.classify('image', {});

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  test('throws on non-2xx response', async () => {
    mockFetch({}, false, 500);
    const adapter = new GenericHttpAdapter('https://api.example.com/classify');
    await expect(adapter.classify('image', {})).rejects.toThrow('Remote adapter HTTP 500');
  });
});

// ── AzureOpenAIAdapter ────────────────────────────────────────────────────────

describe('AzureOpenAIAdapter', () => {
  const azureEndpoint = 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai';
  const apiKey = 'azure-key-123';

  // Helper: mock a Responses API response
  function mockResponsesApi(text: string, ok = true, status = 200): jest.SpyInstance {
    return mockFetch({
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
      output_text: text,
    }, ok, status);
  }

  test('uses Authorization: Bearer header', async () => {
    const spy = mockResponsesApi('{"score":0.8,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);
    expect(headers['api-key']).toBeUndefined();
  });

  test('calls correct deployment-based Responses API URL', async () => {
    const spy = mockResponsesApi('{"score":0.7,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint, 'my-deployment');
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toBe(`${azureEndpoint}/deployments/my-deployment/responses?api-version=2024-10-21`);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('my-deployment');
  });

  test('sends input (not messages) with input_image and input_text types', async () => {
    const spy = mockResponsesApi('{"score":0.8,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.input).toBeDefined();
    expect(body.messages).toBeUndefined();
    // Check user content uses Responses API types
    const userInput = body.input[1];
    expect(userInput.role).toBe('user');
    const imgPart = userInput.content[0];
    expect(imgPart.type).toBe('input_image');
    expect(imgPart.image_url).toBe(TINY_PNG);
    const textPart = userInput.content[1];
    expect(textPart.type).toBe('input_text');
  });

  test('uses json_schema text format for structured output', async () => {
    const spy = mockResponsesApi('{"score":0.8,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.name).toBe('AIDetectionResult');
    expect(body.text.format.strict).toBe(true);
  });

  test('strips trailing slash from base URL', async () => {
    const spy = mockResponsesApi('{"score":0.5,"label":"uncertain"}');
    const adapter = new AzureOpenAIAdapter(apiKey, `${azureEndpoint}/`);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toBe(`${azureEndpoint}/deployments/gpt-5-1-chat/responses?api-version=2024-10-21`);
  });

  test('returns ai classification result', async () => {
    mockResponsesApi('{"score":0.9,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBeCloseTo(0.9);
    expect(result.label).toBe('ai');
  });

  test('clamps score to [0, 1]', async () => {
    mockResponsesApi('{"score":99,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(1);
  });

  test('handles text content type', async () => {
    mockResponsesApi('{"score":0.95,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('text', { text: 'This is sample text.' });
    expect(result.score).toBeCloseTo(0.95);
    expect(result.label).toBe('ai');
  });

  test('handles video content type with imageDataUrl (frame)', async () => {
    const spy = mockResponsesApi('{"score":0.8,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('video', { imageDataUrl: TINY_PNG });

    expect(result.score).toBeCloseTo(0.8);
    expect(result.label).toBe('ai');

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    expect(userInput.role).toBe('user');
    const imgPart = userInput.content[0];
    expect(imgPart.type).toBe('input_image');
    expect(imgPart.image_url).toBe(TINY_PNG);
  });

  test('handles video content type with imageUrl fallback', async () => {
    const spy = mockResponsesApi('{"score":0.7,"label":"ai"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('video', { imageUrl: 'https://example.com/video.mp4' });

    expect(result.score).toBeCloseTo(0.7);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    const imgPart = userInput.content[0];
    expect(imgPart.type).toBe('input_image');
    expect(imgPart.image_url).toBe('https://example.com/video.mp4');
  });

  test('returns unsupported for audio contentType', async () => {
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('audio', {});
    expect(result.label).toBe('unsupported');
    expect(result.score).toBe(0.5);
  });

  test('falls back to uncertain for malformed JSON from model', async () => {
    mockResponsesApi('not-json');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('uncertain');
  });

  test('parses output array when output_text is missing', async () => {
    mockFetch({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"score":0.6,"label":"uncertain"}' }] }],
    });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBeCloseTo(0.6);
    expect(result.label).toBe('uncertain');
  });

  test('passes imageUrl when imageDataUrl is not available', async () => {
    const spy = mockResponsesApi('{"score":0.5,"label":"uncertain"}');
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await adapter.classify('image', { imageUrl: 'https://example.com/photo.jpg' });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    const imgPart = userInput.content[0];
    expect(imgPart.type).toBe('input_image');
    expect(imgPart.image_url).toBe('https://example.com/photo.jpg');
  });

  test('returns error fallback on non-2xx Azure response', async () => {
    mockResponsesApi('{}', false, 401);
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('error');
  });

  test('returns error fallback on network failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('error');
  });
});
