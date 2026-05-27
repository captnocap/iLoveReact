// Image generation API client for nano-gpt.com.
// Uses the framework's async HTTP (no Node.js fetch / socks-proxy-agent).

import { postAsync } from '../../runtime/hooks/fetch';
import { CONFIG, isResolutionBasedModel, type JobOptions } from './config';
import { getActiveApiKey } from './db';

export interface GenerateResult {
  imageCount: number;
  savedFiles: Array<{ filename: string; size: number; path: string }>;
  referencesUsed: string[];
  promptUsed: string;
  elapsedMs: number;
}

export interface ApiError extends Error {
  status?: number;
  details?: string;
  hint?: string;
}

function estimateBase64Size(base64: string): number {
  return base64.length * 0.75;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Build the API payload based on model type and options. */
export function buildPayload(
  prompt: string,
  options: JobOptions,
  img2imgBase64Array: string[],
): Record<string, any> {
  const model = options.model || CONFIG.DEFAULT_MODEL;
  const numImages = options.numImages || CONFIG.DEFAULT_IMAGES;

  const body: Record<string, any> = {
    prompt,
    model,
    nImages: numImages,
    responseFormat: 'b64_json',
    showExplicitContent: true,
  };

  if (isResolutionBasedModel(model) || options.resolution) {
    body.resolution = options.resolution || 'auto';
    if (options.aspect_ratio) {
      body.aspect_ratio = options.aspect_ratio;
    } else if (model.includes('nano-banana')) {
      body.aspect_ratio = 'auto';
    }
  } else {
    body.width = options.width || CONFIG.DEFAULT_WIDTH;
    body.height = options.height || CONFIG.DEFAULT_HEIGHT;
    body.resolution = `${body.width}x${body.height}`;
  }

  if (img2imgBase64Array.length > 0) {
    body.imageDataUrls = img2imgBase64Array.map((b64) => `data:image/png;base64,${b64}`);
  }

  if (options.style) body.style = options.style;

  if (model === 'seedream-v3') {
    if (options.guidanceScale !== undefined) body.guidance_scale = options.guidanceScale;
    if (options.safetyChecker !== undefined) body.enable_safety_checker = options.safetyChecker;
  }

  if (model.includes('riverflow')) {
    if (options.steps !== undefined) body.steps = options.steps;
    if (options.CFGScale !== undefined) body.CFGScale = options.CFGScale;
    if (options.strength !== undefined) body.strength = options.strength;
  }

  if (model.includes('wan-')) {
    if (options.seed !== undefined) body.seed = options.seed;
  }

  return body;
}

/** Call the nano-gpt image generation API. */
export async function generateBatch(
  prompt: string,
  options: JobOptions,
  img2imgBase64Array: string[],
): Promise<GenerateResult> {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    throw new Error('No active API key configured. Add one in Settings.');
  }

  const body = buildPayload(prompt, options, img2imgBase64Array);
  const payloadString = JSON.stringify(body);
  const payloadSize = payloadString.length; // approximate

  const startedAt = Date.now();

  const response = await postAsync(CONFIG.API_URL, payloadString, {
    'Content-Type': 'application/json',
    'x-api-key': apiKey.key_value,
  });

  if (response.status < 200 || response.status >= 300) {
    const errorText = response.body.slice(0, 500);
    const err: ApiError = new Error(`API request failed (${response.status}): ${errorText}`);
    err.status = response.status;
    err.details = response.body;
    if (response.status === 413 || errorText.toLowerCase().includes('payload')) {
      err.hint = 'Payload too large. Reduce references or image count.';
    }
    throw err;
  }

  let data: any;
  try {
    data = JSON.parse(response.body);
  } catch {
    const err: ApiError = new Error('API response is not valid JSON');
    err.status = response.status;
    throw err;
  }

  if (!data || !Array.isArray(data.data)) {
    const err: ApiError = new Error('API response missing data array');
    err.status = response.status;
    throw err;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const promptPart = prompt.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const savedFiles: Array<{ filename: string; size: number; path: string }> = [];

  for (let i = 0; i < data.data.length; i++) {
    const imageItem = data.data[i];
    const base64Data = imageItem.b64_json || imageItem.image || imageItem;
    if (typeof base64Data === 'string') {
      const uniqueId = `${timestamp}_img${i}`;
      const filename = `generated_${uniqueId}_${promptPart}.json`;
      const filepath = `./cart/image-gen/data/generated_images/${filename}`;
      // Save as JSON with base64 since we can't write binary directly
      const { writeFile } = await import('./fs');
      const jsonContent = JSON.stringify({ base64: base64Data, prompt, model: body.model }, null, 2);
      writeFile(filepath, jsonContent);
      savedFiles.push({ filename, size: estimateBase64Size(base64Data), path: filepath });
    }
  }

  const elapsedMs = Date.now() - startedAt;

  return {
    imageCount: savedFiles.length,
    savedFiles,
    referencesUsed: [], // populated by caller
    promptUsed: prompt,
    elapsedMs,
  };
}
