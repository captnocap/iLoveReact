// Image generation for the image-gen APP: the pure client (client.ts) + the app's
// Postgres key lookup + disk persistence. The Studio (cart/hmsc-int) does NOT import
// this file — it imports client.ts directly with its own native key, so it never pulls
// in the Postgres bindings. (req_1118)

import { CONFIG, type JobOptions } from './config';
import { generateToBase64 } from './client';
import { getActiveApiKey } from './db';

export interface GenerateResult {
  imageCount: number;
  savedFiles: Array<{ filename: string; size: number; path: string }>;
  referencesUsed: string[];
  promptUsed: string;
  elapsedMs: number;
}

function estimateBase64Size(base64: string): number {
  return base64.length * 0.75;
}

/** Call the nano-gpt image generation API and SAVE the results to disk (the image-gen
 *  app's flow): look the key up in Postgres, run the shared `generateToBase64` network
 *  call, then write each image as a JSON-base64 file the queue/gallery read back. */
export async function generateBatch(
  prompt: string,
  options: JobOptions,
  img2imgBase64Array: string[],
): Promise<GenerateResult> {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    throw new Error('No active API key configured. Add one in Settings.');
  }

  const startedAt = Date.now();
  const images = await generateToBase64(prompt, options, apiKey.key_value, img2imgBase64Array);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const promptPart = prompt.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const model = options.model || CONFIG.DEFAULT_MODEL;
  const savedFiles: Array<{ filename: string; size: number; path: string }> = [];

  for (let i = 0; i < images.length; i++) {
    const base64Data = images[i];
    const uniqueId = `${timestamp}_img${i}`;
    const filename = `generated_${uniqueId}_${promptPart}.json`;
    const filepath = `./cart/image-gen/data/generated_images/${filename}`;
    // Save as JSON with base64 since we can't write binary directly
    const { writeFile } = await import('./fs');
    const jsonContent = JSON.stringify({ base64: base64Data, prompt, model }, null, 2);
    writeFile(filepath, jsonContent);
    savedFiles.push({ filename, size: estimateBase64Size(base64Data), path: filepath });
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
