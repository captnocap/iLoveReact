// Queue parser — reads queue.txt and turns lines into job configs.
// Format: [prompt][WxH][numImages][numBatches][model][img2imgRefs][style][key=value,...]

import { CONFIG, type JobOptions } from './config';

export interface QueueJobConfig {
  prompt: string;
  width: number;
  height: number;
  numImages: number;
  numBatches: number;
  model: string;
  img2imgRefsPattern: string | null;
  style: string | null;
  autoRetry: boolean;
  disabled: boolean;
  resolution: string | null;
  aspect_ratio: string | null;
  steps: number | null;
  CFGScale: number | null;
  strength: number | null;
  seed: number | null;
}

export function parseQueueLine(line: string): QueueJobConfig | null {
  const trimmed = line.trim();
  const isDisabled = trimmed.startsWith('?');
  const withoutFlag = isDisabled ? trimmed.substring(1).trim() : trimmed;
  const hasRetryFlag = withoutFlag.endsWith('!');
  const clean = withoutFlag.replace(/!$/, '').trim();

  const regex = /\[([^\]]+)\]/g;
  const matches = [...clean.matchAll(regex)].map((m) => m[1].trim());
  if (matches.length < 1) return null;

  const config: QueueJobConfig = {
    prompt: matches[0],
    width: CONFIG.DEFAULT_WIDTH,
    height: CONFIG.DEFAULT_HEIGHT,
    numImages: CONFIG.DEFAULT_IMAGES,
    numBatches: CONFIG.DEFAULT_BATCHES,
    model: CONFIG.DEFAULT_MODEL,
    img2imgRefsPattern: null,
    style: null,
    autoRetry: hasRetryFlag,
    disabled: isDisabled,
    resolution: null,
    aspect_ratio: null,
    steps: null,
    CFGScale: null,
    strength: null,
    seed: null,
  };

  if (matches[4]) config.model = matches[4] || CONFIG.DEFAULT_MODEL;

  if (matches[1]) {
    const resValue = matches[1].trim();
    const resParts = resValue.toLowerCase().split('x');
    if (
      resParts.length === 2 &&
      !isNaN(parseInt(resParts[0], 10)) &&
      !isNaN(parseInt(resParts[1], 10))
    ) {
      config.width = parseInt(resParts[0], 10) || CONFIG.DEFAULT_WIDTH;
      config.height = parseInt(resParts[1], 10) || CONFIG.DEFAULT_HEIGHT;
    } else {
      config.resolution = resValue;
    }
  }

  if (matches[2]) config.numImages = parseInt(matches[2], 10) || CONFIG.DEFAULT_IMAGES;
  if (matches[3]) config.numBatches = parseInt(matches[3], 10) || CONFIG.DEFAULT_BATCHES;
  if (matches[5] && matches[5].toLowerCase() !== 'none') config.img2imgRefsPattern = matches[5];
  if (matches[6] && matches[6].toLowerCase() !== 'none') config.style = matches[6];

  if (matches[7]) {
    const extParams = matches[7].split(',').map((p) => p.trim());
    extParams.forEach((param) => {
      const [key, value] = param.split('=').map((s) => s.trim());
      if (!key || !value) return;
      switch (key.toLowerCase()) {
        case 'aspect_ratio':
        case 'aspectratio':
        case 'ar':
          config.aspect_ratio = value;
          break;
        case 'steps':
          config.steps = parseInt(value, 10);
          break;
        case 'cfgscale':
        case 'cfg':
          config.CFGScale = parseFloat(value);
          break;
        case 'strength':
          config.strength = parseFloat(value);
          break;
        case 'seed':
          config.seed = parseInt(value, 10);
          break;
        case 'resolution':
        case 'res':
          config.resolution = value;
          break;
      }
    });
  }

  return config;
}

export function parseQueueFile(content: string): QueueJobConfig[] {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const jobs: QueueJobConfig[] = [];
  lines.forEach((line) => {
    const job = parseQueueLine(line);
    if (job && job.prompt && !job.disabled) {
      jobs.push(job);
    }
  });
  return jobs;
}

export function buildQueueLine(config: QueueJobConfig): string {
  const parts: string[] = [];
  parts.push(`[${config.prompt}]`);
  if (config.resolution) {
    parts.push(`[${config.resolution}]`);
  } else {
    parts.push(`[${config.width}x${config.height}]`);
  }
  parts.push(`[${config.numImages}]`);
  parts.push(`[${config.numBatches}]`);
  parts.push(`[${config.model}]`);
  parts.push(`[${config.img2imgRefsPattern ?? 'none'}]`);
  parts.push(`[${config.style ?? 'none'}]`);

  const extParams: string[] = [];
  if (config.aspect_ratio) extParams.push(`aspect_ratio=${config.aspect_ratio}`);
  if (config.steps != null) extParams.push(`steps=${config.steps}`);
  if (config.CFGScale != null) extParams.push(`CFGScale=${config.CFGScale}`);
  if (config.strength != null) extParams.push(`strength=${config.strength}`);
  if (config.seed != null) extParams.push(`seed=${config.seed}`);
  if (extParams.length > 0) parts.push(`[${extParams.join(',')}]`);

  let line = parts.join(' ');
  if (config.autoRetry) line += '!';
  return line;
}
