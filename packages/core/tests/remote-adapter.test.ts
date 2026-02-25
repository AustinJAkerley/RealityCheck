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

  test('uses api-key header (not Authorization: Bearer)', async () => {
    const spy = mockFetch({
      choices: [{ message: { content: '{"score":0.8,"label":"ai"}' } }],
    });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['api-key']).toBe(apiKey);
    expect(headers['Authorization']).toBeUndefined();
  });

  test('calls correct Azure deployment URL with api-version', async () => {
    const spy = mockFetch({
      choices: [{ message: { content: '{"score":0.7,"label":"ai"}' } }],
    });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint, 'my-deployment', '2024-05-01');
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/deployments/my-deployment/chat/completions');
    expect(url).toContain('api-version=2024-05-01');
  });

  test('strips trailing slash from base URL', async () => {
    const spy = mockFetch({
      choices: [{ message: { content: '{"score":0.5,"label":"uncertain"}' } }],
    });
    const adapter = new AzureOpenAIAdapter(apiKey, `${azureEndpoint}/`);
    await adapter.classify('image', { imageDataUrl: TINY_PNG });

    const url = spy.mock.calls[0][0] as string;
    expect(url).not.toContain('//deployments');
  });

  test('returns ai classification result', async () => {
    mockFetch({ choices: [{ message: { content: '{"score":0.9,"label":"ai"}' } }] });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBeCloseTo(0.9);
    expect(result.label).toBe('ai');
  });

  test('clamps score to [0, 1]', async () => {
    mockFetch({ choices: [{ message: { content: '{"score":99,"label":"ai"}' } }] });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(1);
  });

  test('handles text content type', async () => {
    mockFetch({ choices: [{ message: { content: '{"score":0.95,"label":"ai"}' } }] });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('text', { text: 'This is sample text.' });
    expect(result.score).toBeCloseTo(0.95);
    expect(result.label).toBe('ai');
  });

  test('returns unsupported for audio contentType', async () => {
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('audio', {});
    expect(result.label).toBe('unsupported');
    expect(result.score).toBe(0.5);
  });

  test('falls back to uncertain for malformed JSON from model', async () => {
    mockFetch({ choices: [{ message: { content: 'not-json' } }] });
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    const result = await adapter.classify('image', { imageDataUrl: TINY_PNG });
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('uncertain');
  });

  test('throws on non-2xx Azure response', async () => {
    mockFetch({}, false, 401);
    const adapter = new AzureOpenAIAdapter(apiKey, azureEndpoint);
    await expect(adapter.classify('image', { imageDataUrl: TINY_PNG })).rejects.toThrow(
      'Azure OpenAI API HTTP 401'
    );
  });
});
