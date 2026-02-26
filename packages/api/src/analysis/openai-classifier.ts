/**
 * Azure OpenAI-based image classifier for the RealityCheck API backend.
 *
 * Uses the Azure OpenAI Responses API to determine whether an image is AI-generated.
 * Activated when the following environment variables are present:
 *
 *   AZURE_OPENAI_ENDPOINT    — Base URL including the /openai path, e.g.
 *                              https://hackathon2026-apim-chffbmwwvr7u2.azure-api.net/openai
 *   AZURE_OPENAI_API_KEY     — Bearer token for APIM gateway authentication
 *   AZURE_OPENAI_DEPLOYMENT  — model deployment name (default: gpt-5-1-chat)
 *
 * When these variables are not set, the function is a no-op and the caller
 * falls back to the heuristic `analyzeImage` implementation.
 *
 * Responses API endpoint format:
 *   POST {AZURE_OPENAI_ENDPOINT}/deployments/{deployment}/responses?api-version=2024-10-21
 * Authentication header: `Authorization: Bearer {key}` (APIM gateway format).
 */

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

/**
 * Read Azure OpenAI configuration from environment variables.
 * Returns null when the required variables are not set.
 */
export function getAzureOpenAIConfig(): AzureOpenAIConfig | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    return null;
  }
  return {
    endpoint,
    apiKey,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || 'gpt-5-1-chat',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-10-21',
  };
}

export interface OpenAIClassificationResult {
  score: number;
  label: 'ai' | 'human' | 'uncertain';
}

/**
 * Shared Azure OpenAI Responses API call — used by both image and video classifiers.
 * Constructs the request with the given system prompt and user content, sends it to
 * the Responses API, and parses the structured JSON result.
 *
 * @throws When the Azure OpenAI API returns a non-2xx response.
 */
async function callAzureOpenAIResponsesAPI(
  config: AzureOpenAIConfig,
  systemPrompt: string,
  userContent: unknown[]
): Promise<OpenAIClassificationResult> {
  const responsesUrl =
    `${config.endpoint.replace(/\/$/, '')}/deployments/${config.deployment}/responses?api-version=${config.apiVersion}`;

  const response = await fetch(responsesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.deployment,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
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
    throw new Error(`Azure OpenAI HTTP ${response.status}: ${response.statusText}`);
  }

  // Responses API returns: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
  const data = (await response.json()) as {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    output_text?: string;
  };

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

  const score =
    typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : 0.5;
  const labelRaw = typeof parsed.label === 'string' ? parsed.label : 'uncertain';
  const label: OpenAIClassificationResult['label'] =
    labelRaw === 'ai' || labelRaw === 'human' ? labelRaw : 'uncertain';

  return { score, label };
}

/**
 * Classify video frames using Azure OpenAI Responses API (vision).
 *
 * Accepts multiple frames sampled at 0.25s intervals (or a single representative
 * frame as fallback) and asks the vision model to determine whether the video is
 * AI-generated.
 *
 * @param config        Azure OpenAI configuration.
 * @param imageDataUrl  Base64 data-URL of a single captured video frame (fallback).
 * @param imageUrl      Original source URL of the video (included in the prompt for extra context).
 * @param videoFrames   Multiple video frames (data URLs) at 0.25s intervals; takes precedence over imageDataUrl.
 * @returns Classification result with a 0–1 score and a label.
 * @throws When the Azure OpenAI API returns a non-2xx response.
 */
export async function classifyVideoWithAzureOpenAI(
  config: AzureOpenAIConfig,
  imageDataUrl: string | undefined,
  imageUrl: string | undefined,
  videoFrames?: string[]
): Promise<OpenAIClassificationResult> {
  const systemPrompt =
    'You are an AI-generated video detector. Analyse the provided video frame(s) and determine whether they were ' +
    'generated by an AI model (e.g. Sora, Runway, Pika, Stable Video Diffusion) or captured by a real ' +
    'camera. ' +
    'Respond with JSON only: {"score": <0.0-1.0 probability of AI generation>, ' +
    '"label": "<ai|human|uncertain>"}. ' +
    'Use score >= 0.65 for ai, score <= 0.35 for human, anything between for uncertain. Be conservative.';

  const userContent: unknown[] = [];
  if (videoFrames && videoFrames.length > 0) {
    for (const frame of videoFrames) {
      userContent.push({ type: 'input_image', image_url: frame });
    }
  } else if (imageDataUrl) {
    userContent.push({ type: 'input_image', image_url: imageDataUrl });
  }
  const frameCount = userContent.length; // number of image items added
  userContent.push({
    type: 'input_text',
    text: frameCount > 1
      ? `${imageUrl ? `Video source URL: ${imageUrl}\n` : ''}Analyse these ${frameCount} video frames (sampled at 0.25s intervals). Are they from an AI-generated video? Respond with JSON only.`
      : (imageUrl
        ? `Video source URL: ${imageUrl}\nIs this video frame from an AI-generated video? Respond with JSON only.`
        : 'Is this video frame from an AI-generated video? Respond with JSON only.'),
  });

  return callAzureOpenAIResponsesAPI(config, systemPrompt, userContent);
}

/**
 * Classify an image using Azure OpenAI Responses API (vision).
 *
 * @param config        Azure OpenAI configuration.
 * @param imageDataUrl  Base64 data-URL of the (down-scaled) image, passed to the vision model.
 * @param imageUrl      Original source URL of the image (included in the prompt for extra context).
 * @returns Classification result with a 0–1 score and a label.
 * @throws When the Azure OpenAI API returns a non-2xx response.
 */
export async function classifyImageWithAzureOpenAI(
  config: AzureOpenAIConfig,
  imageDataUrl: string | undefined,
  imageUrl: string | undefined
): Promise<OpenAIClassificationResult> {
  const systemPrompt =
    'You are an AI-generated image detector. Analyse the provided image and determine whether it was ' +
    'generated by an AI model (e.g. DALL-E, Midjourney, Stable Diffusion) or captured by a real ' +
    'camera / created by a human artist. ' +
    'Respond with JSON only: {"score": <0.0-1.0 probability of AI generation>, ' +
    '"label": "<ai|human|uncertain>"}. ' +
    'Use score >= 0.65 for ai, score <= 0.35 for human, anything between for uncertain. Be conservative.';

  const userContent: unknown[] = [];
  if (imageDataUrl) {
    userContent.push({ type: 'input_image', image_url: imageDataUrl });
  }
  userContent.push({
    type: 'input_text',
    text: imageUrl
      ? `Image source URL: ${imageUrl}\nIs this image AI-generated? Respond with JSON only.`
      : 'Is this image AI-generated? Respond with JSON only.',
  });

  return callAzureOpenAIResponsesAPI(config, systemPrompt, userContent);
}
