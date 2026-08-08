// cli/dev/deletable.ts — say what a path IS before anything deletes it.
//
// On 2026-08-08 a hand-written `rm -rf zig-out/lib zig-out/game …` destroyed a full-scale
// authored world map and a set of symlinks into the LM Studio llama.cpp backend, because
// `zig-out` reads as "build output" and nothing in the listing said otherwise (req_4083,
// req_4084). The user's ruling: deletion belongs in a SCRIPT, not in freestyle shell,
// "because otherwise someone will end up wiping the fs for all we know."
//
// This module is the script's conscience. It classifies every path before the delete and
// hands back a verdict:
//
//   regenerable — a build product. Deleting it costs a rebuild.
//   authored    — somebody's work. Deleting it costs the work. NEVER auto-deleted.
//   external    — a link or handle into something outside the repo.
//   unknown     — not recognised. Treated as authored, because the cost of guessing
//                 wrong in that direction is a rebuild, and in the other it is a map.

import { fsExists, fsList } from '../host/fs.ts';
import { spawnSync } from '../host/process.ts';

export type DeletableClass = 'regenerable' | 'authored' | 'external' | 'unknown';

export type DeletableVerdict = {
  path: string;
  kind: DeletableClass;
  what: string;
  size: string;
  /** False for anything a bulk clean must leave alone. */
  safeToDelete: boolean;
};

/** What each known child of an output directory actually is. Anything absent from this
 *  table is `unknown` and therefore protected — new artifacts must be declared here to
 *  become sweepable, so the failure mode of forgetting is a kept file, not a lost one. */
const ZIG_OUT_CONTENTS: Record<string, { kind: DeletableClass; what: string }> = {
  bin: { kind: 'regenerable', what: 'compiled cart binaries — rebuilt by `rjit ship` / `rjit dev`' },
  'dev-modules': { kind: 'regenerable', what: 'hot-loadable dev host modules — rebuilt by `rjit dev`' },
  lib: { kind: 'external', what: 'symlinks into external runtimes (LM Studio llama.cpp); build.zig links libllama_ffi.so from here' },
  game: { kind: 'authored', what: 'BAKE OUTPUT + historically the authored editor maps — inspect before touching' },
  tools: { kind: 'regenerable', what: 'built helper tools' },
  tests: { kind: 'regenerable', what: 'built test binaries' },
  manifest: { kind: 'regenerable', what: 'build manifests' },
};

export function classifyOutputChild(name: string): { kind: DeletableClass; what: string } {
  return ZIG_OUT_CONTENTS[name] ?? { kind: 'unknown', what: 'not a declared build artifact — treated as authored work' };
}

export function humanSize(path: string): string {
  const du = spawnSync('du', ['-sh', path]);
  return du.code === 0 ? (du.stdout.trim().split('\t')[0] ?? '?') : '?';
}

/** Classify every child of `dir`, newest classification rules applied. */
export function surveyOutputDir(rjitHome: string, rel: string): DeletableVerdict[] {
  const root = `${rjitHome}/${rel}`;
  if (!fsExists(root)) return [];
  return fsList(root).map((name) => {
    const { kind, what } = classifyOutputChild(name);
    return {
      path: `${rel}/${name}`,
      kind,
      what,
      size: humanSize(`${root}/${name}`),
      safeToDelete: kind === 'regenerable',
    };
  });
}

/** The announcement. Every path, what it is, and what will happen to it — printed BEFORE
 *  a single delete, so a wrong call is visible while it is still a plan. */
export function announce(verdicts: readonly DeletableVerdict[], emit: (line: string) => void): void {
  if (verdicts.length === 0) {
    emit('[clean] nothing to survey');
    return;
  }
  const width = Math.max(...verdicts.map((row) => row.path.length));
  for (const row of verdicts) {
    const action = row.safeToDelete ? 'DELETE' : 'KEEP  ';
    emit(`[clean] ${action} ${row.path.padEnd(width)}  ${row.size.padStart(6)}  ${row.kind} — ${row.what}`);
  }
  const kept = verdicts.filter((row) => !row.safeToDelete);
  if (kept.length > 0) {
    emit(`[clean] ${kept.length} path(s) KEPT: only declared build artifacts are ever deleted. Remove anything else by hand, after looking inside it.`);
  }
}
