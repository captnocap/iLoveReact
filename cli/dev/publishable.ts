// cli/dev/publishable.ts — say what belongs on GitHub before anything is committed.
//
// The sibling of dev/deletable.ts. That module answers "may this be deleted"; this one
// answers "may this be published". Both exist because the same mistake keeps happening in
// two directions: a path gets acted on because of what its NAME suggests, while nothing in
// the listing says what it actually IS.
//
// The disease this cures is specific and measurable. `.gitignore` grew to ~300 lines as a
// BLOCKLIST: every line is the scar of one incident where an artifact reached a commit and
// somebody appended a pattern afterwards. A blocklist can only ever describe junk that has
// already been published once, so it is permanently one incident behind — and by 2026-08-08
// the repo was publishing 586MB across 15,561 tracked files, including 86MB of 3D model
// JSON that a HARD RULE in CLAUDE.md has forbidden the whole time.
//
// So the decision is inverted here. This module is an ALLOWLIST: the trees this project
// publishes are DECLARED, with what each one is and why it earns a place in a clone.
// Anything tracked that no rule covers is `unknown` — which is REPORTED and never acted on
// automatically, in either direction. That asymmetry is deliberate:
//
//   deleting an unknown path      costs somebody's work        → deletable.ts KEEPS it
//   auto-untracking an unknown    costs a working fresh clone  → this module REPORTS it
//
// Both failure modes resolve to "a human looked at a line of output", which is the only
// outcome cheap enough to be wrong about.
//
// Classes:
//   source   — belongs in a clone. A contributor cannot build or understand this without it.
//   artifact — generated. Reproducible by a named command, so publishing it is pure weight.
//   asset    — 3D models, textures, captures. USER RULING req_3772: never published.
//   frozen   — a previous era kept for reference. Read, never built. Belongs in a zip.
//   oneoff   — a probe, a recovery dump, a one-session script. Served its purpose.
//   unknown  — no rule covers it. Requires a decision; gets one line of output, no action.

import { spawnSync } from '../host/process.ts';

export type PublishClass = 'source' | 'artifact' | 'asset' | 'frozen' | 'oneoff' | 'unknown';

export type PublishRule = {
  /** Repo-relative path prefix. The LONGEST matching prefix wins, so a rule inside a
   *  published tree can carve an exception out of it (e.g. tools/ publishes, tools/v8cli
   *  does not). */
  path: string;
  kind: PublishClass;
  /** What this path IS — printed next to it, so nobody has to guess from the name. */
  what: string;
  /** For non-source classes: the command that regenerates it, or where it should live
   *  instead. This is what makes an unpublish decision reviewable rather than a leap. */
  insteadOf?: string;
  /** Set when a path is NOT source but cannot leave yet, naming the missing capability.
   *  A blocked path stays published and stays visible — "provide before you ban". */
  blockedBy?: string;
  /** Inspected and confirmed source even though ARTIFACT_SHAPES would call it generated.
   *  Declaring a whole tree publishes its source but vouches for nothing about the shape of
   *  individual files inside it; this flag is how a rule written about ONE exact path says
   *  "somebody looked, shape detection must not second-guess this." */
  vouched?: boolean;
};

/** The declared shape of the published repository.
 *
 *  Adding a tree here is the ONLY way it becomes publishable. Forgetting to add one costs
 *  a line in the audit that says "undeclared"; forgetting to add it to a blocklist would
 *  have cost a silent 86MB commit. That is the whole trade this table exists to make. */
export const PUBLISH_RULES: PublishRule[] = [
  // ── Published: what a fresh clone needs to build and understand this project ──────────
  {
    path: 'framework',
    kind: 'source',
    what: 'Zig runtime — layout, engine, GPU, events, input, state, effects, text, windows',
  },
  { path: 'runtime', kind: 'source', what: 'JS cart-facing layer — JSX shim, primitives, hooks, host globals' },
  { path: 'renderer', kind: 'source', what: 'reconciler host config — emits the CREATE/APPEND/UPDATE stream' },
  // cart/ is deliberately NOT source as a whole. USER RULING (req_4096): "the only one
  // we're working on is editor/, so everything else can be archived." cart/editor is the
  // active surface (V32) and publishes; the other ~130 carts are previous eras. A NEW cart
  // therefore reports as frozen until someone declares it source — which is the allowlist
  // working as intended: it asks, rather than silently publishing whatever lands in cart/.
  { path: 'cart/editor', kind: 'source', what: 'THE active surface (V32) — the editor cart and its /play route' },
  {
    path: 'cart',
    kind: 'frozen',
    what: 'previous-era carts — labs, demos, probes, chat clients, hmsc-int. Only cart/editor is worked on',
    insteadOf: 'archive/carts-legacy.zip (tracked source only — cart/hmsc-int alone is 7.4GB on disk against 9.9MB in git)',
  },
  { path: 'docs', kind: 'source', what: 'the game knowledge layer — DECISIONS.md, per-cart audits, _index/, _requests/' },
  { path: 'plan', kind: 'source', what: 'architectural execution and closure records needed to understand landed systems' },
  { path: 'cli', kind: 'source', what: 'rjit CLI source — tools/rjit.js is BUILT from here, this is the truth' },
  { path: 'scripts', kind: 'source', what: 'build pipeline + git hooks — cart-bundle.js, fetch-*, install-hooks' },
  { path: 'tools', kind: 'source', what: 'agent entry points — rjit, seat, oracle, request, parity harnesses' },
  { path: 'tui', kind: 'source', what: 'TUI stack' },
  { path: 'sdk', kind: 'source', what: 'packaged SDK surface' },
  { path: 'stb', kind: 'source', what: 'vendored single-header C libs — build.zig adds these include paths' },
  { path: 'deps', kind: 'source', what: 'external deps the build links against (zig-v8, wgpu, whisper, onnxruntime, ...)' },
  { path: '.github', kind: 'source', what: 'CI + repo config' },
  { path: '.claude', kind: 'source', what: 'project skills, hooks, agent config' },
  { path: '.agents', kind: 'source', what: 'agent skill definitions (agent-seat, agent-skin)' },
  { path: '.codex', kind: 'source', what: 'codex CLI config for the delegation handoff' },
  { path: 'build.zig', kind: 'source', what: 'the root build — every cart host, dev module and test root' },
  { path: 'build.zig.zon', kind: 'source', what: 'dependency manifest' },
  { path: 'README.md', kind: 'source', what: 'repo overview' },
  { path: 'CLAUDE.md', kind: 'source', what: 'the rules — hard rules, ship path, where features live' },
  { path: 'AGENTS.md', kind: 'source', what: 'agent entry contract' },
  { path: 'GUIDING_LIGHT.md', kind: 'source', what: 'the architectural north star' },
  { path: 'install.sh', kind: 'source', what: 'clone-side setup' },
  { path: '.gitignore', kind: 'source', what: 'ignore rules (the blocklist half — this module is the allowlist half)' },
  { path: '.gitattributes', kind: 'source', what: 'git attributes' },
  { path: '.hardened-paths', kind: 'source', what: 'paths guarded against sweeps' },
  { path: 'vocabulary.yaml', kind: 'source', what: 'ContextForge vocabulary — what words mean in this project' },
  { path: 'plan_store.yaml', kind: 'source', what: 'ContextForge plan store' },
  { path: 'questions.yaml', kind: 'source', what: 'ContextForge Q&A store' },

  // ── Carved out of published trees. Longest-prefix wins, so these override the rules
  //    above for their exact subtree. Each names what regenerates it. ─────────────────────
  {
    path: 'tools/v8cli',
    kind: 'artifact',
    what: 'prebuilt 55MB V8 script host binary',
    insteadOf: 'a scripts/fetch-v8cli.sh alongside fetch-zig.sh / fetch-v8-prebuilt.sh',
    blockedBy: 'nothing fetches or builds it — untracking it breaks `tools/rjit` on a fresh clone',
  },
  {
    path: 'tools/esbuild',
    kind: 'artifact',
    what: 'prebuilt 11MB esbuild binary',
    insteadOf: 'a fetch script pinning the esbuild version',
    blockedBy: 'nothing fetches it — untracking it breaks cart bundling on a fresh clone',
  },
  {
    path: 'tools/rjit.js',
    kind: 'artifact',
    what: '430KB bundle of cli/ — generated, not authored',
    insteadOf: 'tools/esbuild cli/main.ts --bundle --outfile=tools/rjit.js --format=iife --platform=neutral --target=es2022',
    blockedBy: 'building it needs tools/esbuild, which is itself unfetched — unpublish these three together',
  },
  {
    path: 'framework/gpu/icon_atlas.zig',
    kind: 'artifact',
    what: '9.7MB of generated Zig — a baked SDF icon atlas, @import-ed by the GPU path',
    insteadOf: 'rjit bake-icons',
    blockedBy: 'the build @import-s it, so a clone cannot compile until bake-icons has run',
  },
  {
    path: 'framework/gpu/icon_atlas_debug.ppm.txt',
    kind: 'artifact',
    what: '5MB debug dump of the icon atlas — a visual aid, not an input',
    insteadOf: 'rjit bake-icons',
  },
  {
    path: 'deps/duckdb',
    kind: 'artifact',
    what: '114MB prebuilt DuckDB (libduckdb_static.a + the linux-amd64 zip) with ZERO references in build.zig, framework/, cli/ or scripts/',
    insteadOf: 'nothing — no code links it. Re-fetch from the DuckDB release page if it is ever wanted',
  },
  {
    path: 'cart/hmsc-int/exports',
    kind: 'asset',
    what: 'baked .rjpkg export output including a 15MB city.map',
    insteadOf: 'rjit game bake — and the previous-era surface is not the build site anyway',
  },
  {
    // Reinstated as source against the binary SHAPE rule below: these are vendored
    // cross-compilation inputs, not build output. Nothing in this repo can produce them.
    path: 'deps/windows',
    kind: 'source',
    vouched: true,
    what: 'vendored Windows import libraries (SDL2, FreeType) — cross-compile inputs the build links',
  },
  {
    path: 'cart/app-jsx-backup',
    kind: 'oneoff',
    what: 'a .jsx snapshot of cart/app taken during the TS migration — and cart/ is .tsx/.ts only',
    insteadOf: 'git history, which already holds it',
  },
  {
    // Note the trailing space in the directory name — it is real, and git quotes the path
    // in `status` output because of it.
    path: 'bunch of dogshit ',
    kind: 'oneoff',
    what: "the user's own sweep of ~200 esbuild bundles and metafiles off the repo root (372 files, ~195MB)",
    insteadOf: 'nothing — every one of them is rebuilt by `rjit ship` / `rjit dev`',
  },
  {
    path: 'torso_quad.glb',
    kind: 'asset',
    what: 'a 3D model sitting at the repo root, untracked but UNIGNORED — one `git add -A` from publication',
    insteadOf: 'local disk. CLAUDE.md: "do not commit 3d models to github" (USER RULING req_3772)',
  },

  // ── Frozen eras. Read for reference, never built. The repo already zips these into
  //    archive/*.zip and gitignores the zip (editor/experiments/images/os did this) — that
  //    informal move is what `rjit repo archive` makes into a real, announcing verb. ──────
  {
    path: 'tsz',
    kind: 'frozen',
    what: 'Smith era — .tsz compiler, d-suite conformance, cockpit carts. 4163 files, FROZEN by CLAUDE.md',
    insteadOf: 'archive/tsz.zip (build.zig only references tsz/zig-out/lib, a gitignored build output — no tracked file here is load-bearing)',
  },
  {
    path: 'love2d',
    kind: 'frozen',
    what: 'the Lua reference stack — the proven reconciler-on-Lua implementation. 1894 files, FROZEN by CLAUDE.md',
    insteadOf: 'archive/love2d.zip',
  },
  {
    path: 'archive',
    kind: 'frozen',
    what: 'old compiler iterations (v1 tsz, v2 tsz-gen) + the evicted QJS stack. Already the archive, but tracked',
    insteadOf: 'archive/*.zip, which .gitignore already expects — build.zig mentions archive/qjs-stack only in comments',
  },

  // ── One-offs. Each served one session and then stopped being anybody's input. ──────────
  {
    path: 'recovered-models',
    kind: 'asset',
    what: '86MB of 3D mesh JSON from a recovery dump — 32MB in a single file',
    insteadOf: 'local disk. CLAUDE.md: "do not commit 3d models to github"; USER RULING req_3772 says the same',
  },
  {
    path: 'shots',
    kind: 'asset',
    what: '16MB of PNG frame captures from self-shot verification runs',
    insteadOf: 'local disk — `rjit shot` regenerates any of them on demand',
  },
  {
    path: 'research_runs',
    kind: 'oneoff',
    what: 'output of one-off research sweeps',
    insteadOf: 'local disk; conclusions belong in docs/ if they matter',
  },
  {
    path: 'dead',
    kind: 'oneoff',
    what: 'a graveyard directory',
    insteadOf: 'deletion — git history is the graveyard',
  },
  {
    path: 'verify-zig016-bins.sh',
    kind: 'oneoff',
    what: 'one-off verification script from the 0.16 migration, left at repo root',
    insteadOf: 'scripts/ if still useful, otherwise nothing',
  },
  {
    path: 'verify-zig016-editor.sh',
    kind: 'oneoff',
    what: 'one-off verification script from the 0.16 migration, left at repo root',
    insteadOf: 'scripts/ if still useful, otherwise nothing',
  },
  {
    path: 'verify-zig016-lane0.sh',
    kind: 'oneoff',
    what: 'one-off verification script from the 0.16 migration, left at repo root',
    insteadOf: 'scripts/ if still useful, otherwise nothing',
  },
  {
    path: 'verify-zig016-tests.sh',
    kind: 'oneoff',
    what: 'one-off verification script from the 0.16 migration, left at repo root',
    insteadOf: 'scripts/ if still useful, otherwise nothing',
  },
];

/** Patterns that are never source wherever they appear. These catch the NEXT incident —
 *  a file shaped like an artifact inside an otherwise-published tree — which is exactly
 *  the case a per-tree allowlist alone would wave through. */
export const ARTIFACT_SHAPES: { test: (path: string) => boolean; what: string }[] = [
  // Any `<prefix>bundle-<cart>.js`, not just a bare `bundle-` start. The .gitignore rule was
  // written as `bundle-*.js` on the day someone got burned, so the later `gdev-bundle-*.js`
  // and `tui-bundle-*.js` outputs walked straight past it and sat unignored at the repo root.
  // `cart-bundle.js` and friends are safe: this needs a hyphen AFTER "bundle".
  { test: (p) => /(^|\/)(bundle(-[^/]*)?|[A-Za-z0-9_]+-bundle-[^/]*)\.js$/.test(p), what: 'esbuild cart bundle — rebuilt by `rjit ship` / `rjit dev`' },
  { test: (p) => /\.metafile\.json$/.test(p), what: 'esbuild metafile — rebuilt with the bundle' },
  { test: (p) => /\.(png|jpg|jpeg|ppm|gif|webp)$/i.test(p), what: 'raster image — an asset or a capture, never source' },
  { test: (p) => /\.(glb|gltf|obj|fbx|blend)$/i.test(p), what: '3D model — CLAUDE.md forbids publishing these' },
  { test: (p) => /\.(a|so|dylib|dll|o|wasm)$/i.test(p), what: 'compiled binary object' },
  { test: (p) => /\.(zip|tar|tar\.gz|tgz|iso)$/i.test(p), what: 'archive blob' },
  { test: (p) => /\.(db|sqlite)(-wal|-shm)?$/i.test(p), what: 'database file — runtime state' },
  { test: (p) => /(^|\/)_?tmp[^/]*\//.test(p), what: 'temp directory' },
  { test: (p) => /\.(log|bak|orig|rej|swp)$/i.test(p), what: 'editor or process leftover' },
  { test: (p) => /_old\.[a-z]+$/i.test(p), what: 'a `_old` rewrite breadcrumb — meant to be diffed then dropped' },
];

export type PublishVerdict = {
  path: string;
  kind: PublishClass;
  what: string;
  insteadOf?: string;
  blockedBy?: string;
  /** The rule prefix that decided this, so a surprising verdict is traceable to a line. */
  ruledBy: string;
};

/** Longest declared prefix wins; then artifact SHAPES; then unknown. */
export function classifyTracked(path: string): PublishVerdict {
  let best: PublishRule | null = null;
  for (const rule of PUBLISH_RULES) {
    const isPrefix = path === rule.path || path.startsWith(`${rule.path}/`);
    if (!isPrefix) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }

  if (best && best.kind !== 'source') {
    return { path, kind: best.kind, what: best.what, insteadOf: best.insteadOf, blockedBy: best.blockedBy, ruledBy: best.path };
  }

  // Inside a published tree, a file can still be shaped like an artifact — unless a rule
  // written about this exact path already vouched for it.
  if (best?.vouched) return { path, kind: 'source', what: best.what, ruledBy: best.path };
  for (const shape of ARTIFACT_SHAPES) {
    if (!shape.test(path)) continue;
    return { path, kind: 'artifact', what: shape.what, insteadOf: 'regenerate it; add an ignore rule', ruledBy: 'artifact shape' };
  }

  if (best) return { path, kind: 'source', what: best.what, ruledBy: best.path };

  return {
    path,
    kind: 'unknown',
    what: 'no rule in cli/dev/publishable.ts covers this path',
    insteadOf: 'declare it in PUBLISH_RULES (source) or unpublish it — a decision, not a default',
    ruledBy: '(undeclared)',
  };
}

export type TrackedEntry = { path: string; bytes: number };

/** Every tracked blob at HEAD with its real git size. Not `du` — git's own accounting is
 *  what GitHub actually stores, and gitlinks (submodules) have no blob size at all. */
export function trackedEntries(): TrackedEntry[] {
  const listed = spawnSync('git', ['ls-tree', '-r', '-l', 'HEAD']);
  if (listed.code !== 0) return [];
  const entries: TrackedEntry[] = [];
  for (const line of listed.stdout.split('\n')) {
    if (!line) continue;
    // <mode> <type> <sha> <size>\t<path>   — size is "-" for gitlinks
    const [meta, path] = line.split('\t');
    if (!meta || !path) continue;
    const fields = meta.split(/\s+/);
    const size = fields[3];
    if (size === undefined || size === '-') continue;
    entries.push({ path, bytes: Number(size) });
  }
  return entries;
}

/** Untracked and NOT ignored — one `git add -A` away from being published. This is the
 *  leading indicator; everything else in this module is the trailing one. */
export function unpublishedCandidates(): string[] {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal']);
  if (status.code !== 0) return [];
  return status.stdout
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((path) => path.length > 0);
}

export type TreeFinding = {
  /** The rule prefix, or the top-level path for undeclared trees. */
  tree: string;
  kind: PublishClass;
  what: string;
  insteadOf?: string;
  blockedBy?: string;
  files: number;
  bytes: number;
  /** A few example paths, so a one-line finding can still be checked. */
  examples: string[];
};

/** Roll per-file verdicts up to the tree that ruled them. A 4163-file finding must read as
 *  one line with a total, or nobody reads any of it. */
export function surveyTracked(entries: TrackedEntry[]): { findings: TreeFinding[]; sourceFiles: number; sourceBytes: number } {
  const grouped = new Map<string, TreeFinding>();
  let sourceFiles = 0;
  let sourceBytes = 0;

  for (const entry of entries) {
    const verdict = classifyTracked(entry.path);
    if (verdict.kind === 'source') {
      sourceFiles += 1;
      sourceBytes += entry.bytes;
      continue;
    }
    const key = verdict.kind === 'unknown' || verdict.ruledBy === 'artifact shape'
      ? topLevel(entry.path)
      : verdict.ruledBy;
    const existing = grouped.get(`${verdict.kind}:${key}`);
    if (existing) {
      existing.files += 1;
      existing.bytes += entry.bytes;
      if (existing.examples.length < 3) existing.examples.push(entry.path);
      continue;
    }
    grouped.set(`${verdict.kind}:${key}`, {
      tree: key,
      kind: verdict.kind,
      what: verdict.what,
      insteadOf: verdict.insteadOf,
      blockedBy: verdict.blockedBy,
      files: 1,
      bytes: entry.bytes,
      examples: [entry.path],
    });
  }

  const findings = [...grouped.values()].sort((a, b) => b.bytes - a.bytes);
  return { findings, sourceFiles, sourceBytes };
}

function topLevel(path: string): string {
  const cut = path.indexOf('/');
  return cut === -1 ? path : path.slice(0, cut);
}

export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1073741824).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

const CLASS_HEADER: Record<PublishClass, string> = {
  source: 'PUBLISHED — declared source',
  artifact: 'ARTIFACT — generated, reproducible by a named command',
  asset: 'ASSET — models, textures, captures. USER RULING req_3772: never published',
  frozen: 'FROZEN ERA — reference only. Belongs in a zip under archive/',
  oneoff: 'ONE-OFF — served one session',
  unknown: 'UNDECLARED — no rule covers this. Decide, do not default',
};

/** The announcement. Prints what every finding IS and what would replace it, BEFORE any
 *  verb runs. `rjit repo` stops here; the fix verbs print this same block first. */
export function announce(
  findings: TreeFinding[],
  sourceFiles: number,
  sourceBytes: number,
  write: (line: string) => void,
): void {
  write('');
  write(`[repo] published source: ${sourceFiles} files, ${humanBytes(sourceBytes)}`);

  if (findings.length === 0) {
    write('[repo] nothing tracked outside the declared publish manifest. Clean.');
    return;
  }

  const order: PublishClass[] = ['unknown', 'asset', 'artifact', 'frozen', 'oneoff'];
  for (const kind of order) {
    const group = findings.filter((finding) => finding.kind === kind);
    if (group.length === 0) continue;
    const files = group.reduce((sum, finding) => sum + finding.files, 0);
    const bytes = group.reduce((sum, finding) => sum + finding.bytes, 0);
    write('');
    write(`  ${CLASS_HEADER[kind]}  —  ${files} files, ${humanBytes(bytes)}`);
    for (const finding of group) {
      write(`    ${finding.tree}  (${finding.files} files, ${humanBytes(finding.bytes)})`);
      write(`        is:      ${finding.what}`);
      if (finding.insteadOf) write(`        instead: ${finding.insteadOf}`);
      if (finding.blockedBy) write(`        BLOCKED: ${finding.blockedBy}`);
      if (finding.tree === topLevel(finding.examples[0] ?? '') && finding.examples.length > 0 && finding.kind === 'unknown') {
        write(`        e.g.     ${finding.examples.join(', ')}`);
      }
    }
  }

  const totalFiles = findings.reduce((sum, finding) => sum + finding.files, 0);
  const totalBytes = findings.reduce((sum, finding) => sum + finding.bytes, 0);
  const blocked = findings.filter((finding) => finding.blockedBy);
  write('');
  write(`[repo] ${totalFiles} tracked files (${humanBytes(totalBytes)}) do not belong on GitHub`);
  if (blocked.length > 0) {
    write(`[repo] ${blocked.length} of those are BLOCKED — they stay published until the named capability exists`);
  }
}
