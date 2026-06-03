// assist3d/modelHistory — remember recently-used local .gguf paths so you don't
// have to paste the path every time. Persisted to a tiny JSON file next to the
// scene (disk = truth, like everything else here). Most-recent first, capped.

import { fs } from '@reactjit/hooks';
import { processCwd } from './scene';

const MAX = 8;
const historyPath = () => `${processCwd()}/cart/hmsc-int/assist3d/model-history.json`;

export function loadModelHistory(): string[] {
  try {
    const t = fs.readFile(historyPath());
    if (!t) return [];
    const j = JSON.parse(t);
    return Array.isArray(j) ? j.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
}

// Move `path` to the front (dedup), persist, return the new list.
export function rememberModelPath(path: string): string[] {
  const p = path.trim();
  if (!p) return loadModelHistory();
  const next = [p, ...loadModelHistory().filter((x) => x !== p)].slice(0, MAX);
  try { fs.writeFile(historyPath(), JSON.stringify(next, null, 2) + '\n'); } catch { /* ignore */ }
  return next;
}

export function forgetModelPath(path: string): string[] {
  const next = loadModelHistory().filter((x) => x !== path);
  try { fs.writeFile(historyPath(), JSON.stringify(next, null, 2) + '\n'); } catch { /* ignore */ }
  return next;
}

export const modelLabel = (path: string) => path.split('/').pop() || path;
