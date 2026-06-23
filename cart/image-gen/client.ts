// image-gen/client.ts — the PURE nano-gpt image client (no DB, no disk, no key
// lookup). Build the payload + POST + parse → raw base64 strings, with the API key
// passed IN by the caller. Two consumers (rule of two):
//   • the image-gen app (generate.ts) — looks the key up in its Postgres store + saves
//     the results to disk.
//   • the Studio (cart/hmsc-int textureGen.ts) — reads the key from its OWN native
//     localstore (req_1118, all in-house) + composites results into the atlas.
// Keeping this module DB-free is what lets hmsc-int reuse it WITHOUT pulling in the
// Postgres bindings (`__pg_*`).

import { postAsync } from '../../runtime/hooks/fetch';
import { CONFIG, isResolutionBasedModel, type JobOptions } from './config';

export interface ApiError extends Error {
  status?: number;
  details?: string;
  hint?: string;
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

/** The NETWORK half of generation: build the payload, POST to nano-gpt with the given
 *  key, parse the response into the raw base64 image strings. No disk, no naming, no
 *  elapsed — just bytes back. The caller supplies the API key (no store lookup here). */
export async function generateToBase64(
  prompt: string,
  options: JobOptions,
  apiKey: string,
  img2imgBase64Array: string[] = [],
): Promise<string[]> {
  if (!apiKey) throw new Error('No API key provided.');

  const body = buildPayload(prompt, options, img2imgBase64Array);

  const response = await postAsync(CONFIG.API_URL, JSON.stringify(body), {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
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

  const out: string[] = [];
  for (const imageItem of data.data) {
    const base64Data = imageItem.b64_json || imageItem.image || imageItem;
    if (typeof base64Data === 'string') out.push(base64Data);
  }
  return out;
}
