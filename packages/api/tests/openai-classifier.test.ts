/**
 * Unit tests for the Azure OpenAI classifier.
 */
import {
  getAzureOpenAIConfig,
  classifyImageWithAzureOpenAI,
  AzureOpenAIConfig,
} from '../src/analysis/openai-classifier';

// Minimal 1×1 white PNG data-URL for use in tests.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('getAzureOpenAIConfig', () => {
  afterEach(() => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_DEPLOYMENT;
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  test('returns null when env vars are not set', () => {
    expect(getAzureOpenAIConfig()).toBeNull();
  });

  test('returns null when only endpoint is set', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai';
    expect(getAzureOpenAIConfig()).toBeNull();
  });

  test('returns null when only api key is set', () => {
    process.env.AZURE_OPENAI_API_KEY = 'mykey';
    expect(getAzureOpenAIConfig()).toBeNull();
  });

  test('returns config with defaults when required vars are set', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai';
    process.env.AZURE_OPENAI_API_KEY = 'mykey';
    const config = getAzureOpenAIConfig();
    expect(config).not.toBeNull();
    expect(config!.endpoint).toBe('https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai');
    expect(config!.apiKey).toBe('mykey');
    expect(config!.deployment).toBe('gpt-5-1-chat');
    expect(config!.apiVersion).toBe('2024-10-21');
  });

  test('uses custom deployment and api version when set', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai';
    process.env.AZURE_OPENAI_API_KEY = 'mykey';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4-vision';
    process.env.AZURE_OPENAI_API_VERSION = '2024-05-01-preview';
    const config = getAzureOpenAIConfig();
    expect(config!.deployment).toBe('gpt-4-vision');
    expect(config!.apiVersion).toBe('2024-05-01-preview');
  });
});

describe('classifyImageWithAzureOpenAI', () => {
  const mockConfig: AzureOpenAIConfig = {
    endpoint: 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai',
    apiKey: 'test-api-key',
    deployment: 'gpt-5-1-chat',
    apiVersion: '2024-10-21',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('calls the correct Azure OpenAI endpoint', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":0.9,"label":"ai"}' } }],
      }),
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      mockResponse as unknown as Response
    );

    await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(typeof calledUrl).toBe('string');
    expect((calledUrl as string)).toContain('hackathon2026-apim-chffbmwwvr7u2.azure-api.net');
    expect((calledUrl as string)).toContain('/deployments/gpt-5-1-chat/chat/completions');
    expect((calledUrl as string)).toContain('api-version=2024-10-21');
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('returns ai label when score is high', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":0.9,"label":"ai"}' } }],
      }),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBeCloseTo(0.9);
    expect(result.label).toBe('ai');
  });

  test('returns human label when score is low', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":0.1,"label":"human"}' } }],
      }),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBeCloseTo(0.1);
    expect(result.label).toBe('human');
  });

  test('returns uncertain label for ambiguous scores', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":0.5,"label":"uncertain"}' } }],
      }),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, undefined, 'https://example.com/photo.jpg');
    expect(result.score).toBeCloseTo(0.5);
    expect(result.label).toBe('uncertain');
  });

  test('clamps score to [0, 1]', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":2.5,"label":"ai"}' } }],
      }),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBe(1);
  });

  test('falls back to score 0.5 / uncertain for malformed JSON response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not valid json' } }],
      }),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('uncertain');
  });

  test('throws when Azure OpenAI returns non-2xx status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined)
    ).rejects.toThrow('Azure OpenAI HTTP 429');
  });

  test('includes trailing-slash-stripped endpoint in URL', async () => {
    const configWithTrailingSlash: AzureOpenAIConfig = {
      ...mockConfig,
      endpoint: 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai/',
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score":0.8,"label":"ai"}' } }],
      }),
    } as unknown as Response);

    await classifyImageWithAzureOpenAI(configWithTrailingSlash, TINY_PNG_DATA_URL, undefined);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('//deployments');
  });
});
