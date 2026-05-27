// Img2Img reference loading — wildcards, directories, media server.
// Adapted from the Node script; works with JSON base64 files + file paths.

import { CONFIG } from './config';
import {
  IMG2IMG_DIR,
  loadImg2ImgJson,
  listImg2ImgFiles,
  listImg2ImgDirs,
  listImg2ImgInDir,
} from './fs';
import { getAsync } from '../../runtime/hooks/fetch';

export interface LoadedRefs {
  base64Array: string[];
  filenamesArray: string[];
}

// ── Wildcard processing ──

export async function processImg2ImgWildcards(
  refsString: string,
): Promise<string[]> {
  if (!refsString) return [];
  const refs = refsString.split(',').map((s) => s.trim()).filter(Boolean);
  const processed: string[] = [];

  for (const ref of refs) {
    // @#N = pick N random images from media server
    const mediaNumMatch = ref.match(/^@#(\d+)$/);
    if (mediaNumMatch) {
      let num = parseInt(mediaNumMatch[1], 10);
      if (num > 10) num = 10;
      if (num < 1) continue;
      const ids = new Set<number>();
      while (ids.size < num) {
        ids.add(Math.floor(Math.random() * CONFIG.MEDIA_SERVER_MAX_ID) + 1);
      }
      for (const id of ids) processed.push(`@${id}`);
      continue;
    }

    // @? or @random = one random media server image
    if (ref === '@?' || ref.toLowerCase() === '@random') {
      const id = Math.floor(Math.random() * CONFIG.MEDIA_SERVER_MAX_ID) + 1;
      processed.push(`@${id}`);
      continue;
    }

    // @123 = specific media server image
    const mediaIdMatch = ref.match(/^@(\d+)$/);
    if (mediaIdMatch) {
      processed.push(ref);
      continue;
    }

    // !#N = pick N random images from all img2img recursively
    const numMatch = ref.match(/^!#(\d+)$/);
    if (numMatch) {
      let num = parseInt(numMatch[1], 10);
      if (num > 10) num = 10;
      if (num < 1) continue;
      const allImages = listAllImg2ImgNames();
      if (allImages.length === 0) continue;
      const shuffled = [...allImages].sort(() => 0.5 - Math.random());
      processed.push(...shuffled.slice(0, num));
      continue;
    }

    // !!folder!! = use ALL images from folder (non-recursive)
    if (ref.startsWith('!!') && ref.endsWith('!!')) {
      const dirName = ref.substring(2, ref.length - 2);
      const images = listImg2ImgInDir(dirName);
      processed.push(...images.map((n) => `${dirName}/${n}`));
      continue;
    }

    // !!folder = use ONE random image from folder recursively
    if (ref.startsWith('!!') && !ref.endsWith('!!')) {
      const dirName = ref.substring(2);
      const images = listAllImg2ImgNamesInDir(dirName);
      if (images.length > 0) {
        processed.push(images[Math.floor(Math.random() * images.length)]);
      }
      continue;
    }

    // !folder = use ONE random image from folder (non-recursive)
    if (ref.startsWith('!')) {
      const dirName = ref.substring(1);
      const images = listImg2ImgInDir(dirName);
      if (images.length > 0) {
        processed.push(`${dirName}/${images[Math.floor(Math.random() * images.length)]}`);
      }
      continue;
    }

    // {option1|option2} = random choice
    const wildcardMatch = ref.match(/^\{([^}]+)\}$/);
    if (wildcardMatch) {
      const options = wildcardMatch[1].split('|').map((s) => s.trim());
      processed.push(options[Math.floor(Math.random() * options.length)]);
      continue;
    }

    processed.push(ref);
  }

  return processed;
}

function listAllImg2ImgNames(): string[] {
  const names: string[] = [];
  const files = listImg2ImgFiles();
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, '');
    if (!names.includes(base)) names.push(base);
  }
  const dirs = listImg2ImgDirs();
  for (const dir of dirs) {
    const sub = listImg2ImgInDir(dir);
    for (const n of sub) {
      const full = `${dir}/${n}`;
      if (!names.includes(full)) names.push(full);
    }
  }
  return names;
}

function listAllImg2ImgNamesInDir(dirName: string): string[] {
  const names: string[] = [];
  const sub = listImg2ImgInDir(dirName);
  for (const n of sub) names.push(`${dirName}/${n}`);
  // one-level deep for now (framework fs doesn't have recursive walk)
  return names;
}

// ── Loading ──

/** Fetch a media server image by ID and return base64. */
export async function fetchMediaServerImage(id: number): Promise<string> {
  const url = `${CONFIG.MEDIA_SERVER_URL}/image/${id}/image`;
  const response = await getAsync(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Media server returned ${response.status} for image @${id}`);
  }
  // response.body is a string; for binary images this is lossy.
  // We assume the media server can return base64 or the framework handles it.
  // For now, we store the body as-is and hope it's usable.
  return response.body; // may need base64 encoding depending on framework behavior
}

/** Load a single img2img reference (JSON base64, media server, or raw path). */
export async function loadImg2ImgRef(name: string): Promise<string | null> {
  // Media server reference
  if (name.startsWith('@')) {
    const id = parseInt(name.substring(1), 10);
    if (isNaN(id) || id < 1) return null;
    try {
      return await fetchMediaServerImage(id);
    } catch {
      return null;
    }
  }

  // Try JSON base64 file first
  const json = loadImg2ImgJson(name);
  if (json && json.base64) return json.base64;

  // For raw image files, we can't read binary through __fs_readfile.
  // Return null; caller should handle gracefully.
  return null;
}

/** Load multiple img2img references with wildcard expansion. */
export async function loadMultipleImg2Img(
  refsPattern: string,
): Promise<LoadedRefs> {
  const resolved = await processImg2ImgWildcards(refsPattern);
  const base64Array: string[] = [];
  const filenamesArray: string[] = [];

  for (const ref of resolved) {
    try {
      const b64 = await loadImg2ImgRef(ref);
      if (b64) {
        base64Array.push(b64);
        filenamesArray.push(ref);
      }
    } catch {
      // skip failed refs
    }
  }

  if (base64Array.length === 0) {
    throw new Error('No valid img2img references loaded');
  }
  if (base64Array.length > CONFIG.MAX_IMG2IMG_REFS) {
    return {
      base64Array: base64Array.slice(0, CONFIG.MAX_IMG2IMG_REFS),
      filenamesArray: filenamesArray.slice(0, CONFIG.MAX_IMG2IMG_REFS),
    };
  }

  return { base64Array, filenamesArray };
}
