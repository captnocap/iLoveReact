// editor/agent/seatCorpus.ts — the on-disk home of the Agent Seat's phase docs.
//
// The corpus stays MARKDOWN in the repo (.agents/skills/agent-seat/corpus/) rather than
// string literals in TypeScript: these are documents people review, diff, and edit, and
// burying them in a bundle would make every wording fix a code change. seatOracle.ts
// routes them and never reads a file itself, which is what keeps the router pure and
// testable; this module is the one place that touches disk.

import { readFile } from '../../../runtime/hooks/fs';

export const SEAT_CORPUS_DIR = '.agents/skills/agent-seat/corpus';

/** Phase docs change only when someone edits the repo, so one read per name per editor
 *  process is enough. A missing slice caches as null too — repeatedly probing a file
 *  that does not exist is the same wasted syscall every reply. */
const cache = new Map<string, string | null>();

/** Names are corpus file stems, never caller-supplied paths: the oracle asks for
 *  "topology", not for something that could walk out of the corpus directory. */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function readSeatCorpusDoc(name: string): string | null {
  if (!NAME_PATTERN.test(name)) return null;
  if (cache.has(name)) return cache.get(name)!;
  const text = readFile(`${SEAT_CORPUS_DIR}/${name}.md`);
  const value = text && text.trim() ? text : null;
  cache.set(name, value);
  return value;
}

/** Drop the cache so an edited corpus takes effect without restarting the editor —
 *  the docs hot-reload like the rest of the cart. */
export function invalidateSeatCorpus(): void {
  cache.clear();
}
