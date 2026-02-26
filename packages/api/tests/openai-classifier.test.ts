/**
 * Unit tests for the Azure OpenAI classifier.
 */
import {
  getAzureOpenAIConfig,
  classifyImageWithAzureOpenAI,
  classifyVideoWithAzureOpenAI,
  AzureOpenAIConfig,
} from '../src/analysis/openai-classifier';

// Minimal 1×1 white PNG data-URL for use in tests.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Helper: create a mock Responses API response
function responsesApiResponse(text: string) {
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    output_text: text,
  };
}

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
    process.env.AZURE_OPENAI_API_VERSION = '2025-01-01';
    const config = getAzureOpenAIConfig();
    expect(config!.deployment).toBe('gpt-4-vision');
    expect(config!.apiVersion).toBe('2025-01-01');
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

  test('calls the Responses API endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.9,"label":"ai"}'),
    } as unknown as Response);

    await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(typeof calledUrl).toBe('string');
    expect((calledUrl as string)).toBe(
      'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai/deployments/gpt-5-1-chat/responses?api-version=2024-10-21'
    );
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
    // Verify request body uses Responses API format
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body.model).toBe('gpt-5-1-chat');
    expect(body.input).toBeDefined();
    expect(body.messages).toBeUndefined();
  });

  test('sends input_image and input_text types', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.9,"label":"ai"}'),
    } as unknown as Response);

    await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    expect(userInput.content[0].type).toBe('input_image');
    expect(userInput.content[0].image_url).toBe(TINY_PNG_DATA_URL);
    expect(userInput.content[1].type).toBe('input_text');
  });

  test('returns ai label when score is high', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.9,"label":"ai"}'),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBeCloseTo(0.9);
    expect(result.label).toBe('ai');
  });

  test('returns human label when score is low', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.1,"label":"human"}'),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBeCloseTo(0.1);
    expect(result.label).toBe('human');
  });

  test('returns uncertain label for ambiguous scores', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.5,"label":"uncertain"}'),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, undefined, 'https://example.com/photo.jpg');
    expect(result.score).toBeCloseTo(0.5);
    expect(result.label).toBe('uncertain');
  });

  test('clamps score to [0, 1]', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":2.5,"label":"ai"}'),
    } as unknown as Response);

    const result = await classifyImageWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBe(1);
  });

  test('falls back to score 0.5 / uncertain for malformed JSON response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('not valid json'),
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
      json: async () => responsesApiResponse('{"score":0.8,"label":"ai"}'),
    } as unknown as Response);

    await classifyImageWithAzureOpenAI(configWithTrailingSlash, TINY_PNG_DATA_URL, undefined);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai/deployments/gpt-5-1-chat/responses?api-version=2024-10-21'
    );
  });
});

describe('classifyVideoWithAzureOpenAI', () => {
  const mockConfig: AzureOpenAIConfig = {
    endpoint: 'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai',
    apiKey: 'test-api-key',
    deployment: 'gpt-5-1-chat',
    apiVersion: '2024-10-21',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('calls the Responses API endpoint with video-specific system prompt', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.85,"label":"ai"}'),
    } as unknown as Response);

    await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(
      'https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai/deployments/gpt-5-1-chat/responses?api-version=2024-10-21'
    );
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body.input[0].content).toMatch(/video/i);
  });

  test('sends input_image and input_text types for single video frame', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.85,"label":"ai"}'),
    } as unknown as Response);

    await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    expect(userInput.content[0].type).toBe('input_image');
    expect(userInput.content[0].image_url).toBe(TINY_PNG_DATA_URL);
    expect(userInput.content[1].type).toBe('input_text');
  });

  test('sends multiple input_image items when videoFrames is provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.9,"label":"ai"}'),
    } as unknown as Response);

    const frames = [TINY_PNG_DATA_URL, TINY_PNG_DATA_URL, TINY_PNG_DATA_URL];
    await classifyVideoWithAzureOpenAI(mockConfig, undefined, undefined, frames);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    // 3 input_image + 1 input_text
    expect(userInput.content).toHaveLength(4);
    for (let i = 0; i < 3; i++) {
      expect(userInput.content[i].type).toBe('input_image');
      expect(userInput.content[i].image_url).toBe(TINY_PNG_DATA_URL);
    }
    const textPart = userInput.content[3];
    expect(textPart.type).toBe('input_text');
    expect(textPart.text).toContain('3');
  });

  test('videoFrames takes precedence over imageDataUrl', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.9,"label":"ai"}'),
    } as unknown as Response);

    const frames = [TINY_PNG_DATA_URL, TINY_PNG_DATA_URL];
    await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined, frames);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    // Should have 2 images from videoFrames (not 1 from imageDataUrl) + 1 text
    expect(userInput.content).toHaveLength(3);
    expect(userInput.content[0].type).toBe('input_image');
    expect(userInput.content[1].type).toBe('input_image');
  });

  test('returns ai label when score is high', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.85,"label":"ai"}'),
    } as unknown as Response);

    const result = await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBeCloseTo(0.85);
    expect(result.label).toBe('ai');
  });

  test('uses imageUrl in text prompt when imageDataUrl is not provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.6,"label":"uncertain"}'),
    } as unknown as Response);

    await classifyVideoWithAzureOpenAI(mockConfig, undefined, 'https://example.com/video.mp4');

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    // No imageDataUrl provided → no input_image; URL should appear in the text part
    const textPart = userInput.content[userInput.content.length - 1];
    expect(textPart.type).toBe('input_text');
    expect(textPart.text).toContain('https://example.com/video.mp4');
  });

  test('includes video URL in user prompt when imageUrl is provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('{"score":0.7,"label":"ai"}'),
    } as unknown as Response);

    await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, 'https://example.com/video.mp4');

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userInput = body.input[1];
    const textPart = userInput.content[userInput.content.length - 1];
    expect(textPart.text).toContain('https://example.com/video.mp4');
  });

  test('throws when Azure OpenAI returns non-2xx status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined)
    ).rejects.toThrow('Azure OpenAI HTTP 429');
  });

  test('falls back to score 0.5 / uncertain for malformed JSON response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => responsesApiResponse('not valid json'),
    } as unknown as Response);

    const result = await classifyVideoWithAzureOpenAI(mockConfig, TINY_PNG_DATA_URL, undefined);
    expect(result.score).toBe(0.5);
    expect(result.label).toBe('uncertain');
  });
});
