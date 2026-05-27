// App configuration — mirrors the Node script's CONFIG object.
// Values are defaults; UI settings can override per-job.

export const CONFIG = {
  API_URL: 'https://nano-gpt.com/api/generate-image',
  DEFAULT_MODEL: 'seedream-v4',
  DEFAULT_WIDTH: 4096,
  DEFAULT_HEIGHT: 4096,
  DEFAULT_IMAGES: 1,
  DEFAULT_BATCHES: 1,
  MAX_IMG2IMG_REFS: 10,
  MAX_PAYLOAD_SIZE: 4 * 1024 * 1024,
  TARGET_IMAGE_SIZE: 400 * 1024,
  MAX_IMAGE_DIMENSION: 1440,
  AUTO_RETRY_TOLERANCE: 3,
  MAX_CONCURRENT_JOBS: 3,
  MEDIA_SERVER_URL: 'http://10.0.0.5:9999',
  MEDIA_SERVER_MAX_ID: 657959,
} as const;

// Models that use resolution string + aspect_ratio instead of width/height
export const RESOLUTION_BASED_MODELS = [
  'nano-banana-pro-ultra',
  'nano-banana-pro',
  'riverflow-2-max',
  'wan-2.6-image-edit',
];

export const MODELS_8K_CAPABLE = ['nano-banana-pro-ultra'];
export const VALID_ASPECT_RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:3', '3:4', '2:3', '3:2', 'square', 'auto'];
export const VALID_RESOLUTIONS = ['1k', '2k', '4k', '8k', 'auto'];

export function isResolutionBasedModel(model: string): boolean {
  return RESOLUTION_BASED_MODELS.some((m) => model.toLowerCase().startsWith(m.toLowerCase()));
}

export interface JobOptions {
  width?: number;
  height?: number;
  numImages?: number;
  numBatches?: number;
  model?: string;
  style?: string | null;
  resolution?: string | null;
  aspect_ratio?: string | null;
  steps?: number | null;
  CFGScale?: number | null;
  strength?: number | null;
  seed?: number | null;
  guidanceScale?: number | null;
  safetyChecker?: boolean | null;
}
