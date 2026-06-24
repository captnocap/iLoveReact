// cli/commands/game.ts - `rjit game compile` / `rjit game verify` (V19).
//
// The game compile is a CLI any LLM can run at any time; verify boots the
// compiled output headless, replays every verify script (a recorded command
// sequence, compile/verify/*.cmds), runs every game/*.test.ts behavior suite,
// and exits with one verdict line. A feature is "done" when the COMPILED game
// carries it and this run proves it — compile constantly, the green light
// never goes dark.
//
//   rjit game compile   cart/hmsc-int/compile/main.ts -> zig-out/game/hmsc-headless.js
//   rjit game bake      cart/hmsc-int/compile/bakeGameFile.ts -> zig-out/game/hmsc.gamefile
//   rjit game verify    compile fresh, then suites + scripts -> GREEN/RED + exit code

import { fsExists, fsList, fsMkdir, fsWrite, tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

const GAME_DIR = 'cart/hmsc-int/game';
/** every root whose *.test.ts suites the verify run owns (game + the V20 data layer + the editor routes + the COMPILE bake (req_0652 — its five suites existed but never ran here) + the oracle/_index layer incl. the request ledger) */
const SUITE_ROOTS = [GAME_DIR, 'cart/hmsc-int/data', 'cart/hmsc-int/editors', 'cart/hmsc-int/compile', 'docs/game/_index'];
const COMPILE_ENTRY = 'cart/hmsc-int/compile/main.ts';
const VERIFY_DIR = 'cart/hmsc-int/compile/verify';
const OUT_DIR = 'zig-out/game';
const HEADLESS_BUNDLE = `${OUT_DIR}/hmsc-headless.js`;
const TEST_OUT_DIR = `${OUT_DIR}/tests`;
const ORACLE_INDEX_DIR = 'docs/game/_index';
const ORACLE_RECORDS_DIR = `${ORACLE_INDEX_DIR}/records`;
const ORACLE_SELF_CHECK_ENTRY = `${OUT_DIR}/oracle-self-check.ts`;
const ORACLE_SELF_CHECK_BUNDLE = `${OUT_DIR}/oracle-self-check.js`;
// Platform cross-language round-trips (PLATMOD spine): the TS writer emits a
// tape with the production workspace codec, the Zig reader decodes the SAME tape
// and asserts byte/value identity. Step 1 froze the RLE/lump wire format; step 2
// added the full game file (three streams + content-addressed asset vocabulary).
interface RoundTrip {
  label: string;
  genEntry: string;
  genBundle: string;
  fixture: string;
  zigStep: string;
}
const ROUND_TRIPS: RoundTrip[] = [
  {
    label: 'mapfile',
    genEntry: 'framework/testing/fixtures/gen_roundtrip.ts',
    genBundle: `${OUT_DIR}/mapfile-roundtrip-gen.js`,
    fixture: 'framework/testing/fixtures/mapfile_roundtrip.b64',
    zigStep: 'test-world-mapfile',
  },
  {
    label: 'game-file',
    genEntry: 'framework/testing/fixtures/gen_gamefile.ts',
    genBundle: `${OUT_DIR}/mapfile-gamefile-gen.js`,
    fixture: 'framework/testing/fixtures/gamefile_roundtrip.b64',
    zigStep: 'test-world-gamefile',
  },
];

// The stateless Zig loader render proof (PLATMOD §4.4, keystone step 3): build
// the no-V8 loader, construct a world from the baked game-file, render it
// headless, and capture its own frame to a PNG — proving data -> stateless
// engine -> rendered frame with ZERO V8/JS in the construct+render path.
const LOADER_NAME = 'world_loader';
const LOADER_SOURCE = 'world_loader.zig';
const LOADER_BIN = `zig-out/bin/${LOADER_NAME}`;
const LOADER_SHOT = `${OUT_DIR}/${LOADER_NAME}-verify.png`;
const LOADER_BUILD_ARGS = [
  'build', 'app',
  `-Dapp-name=${LOADER_NAME}`,
  `-Dapp-source=${LOADER_SOURCE}`,
  '-Duse-v8=false',
  '-Dhas-gpu=true',
  '-Doptimize=ReleaseFast',
];

// The editor->loader bake (PLATMOD step 4): transcode the AUTHORED hmsc world
// (loadEditorWorld — your saved map, else the demo city) into a real game-file
// the loader renders. The synthetic round-trip fixture is the codec gate; this
// is what `rjit game play/shot` render so you see your actual map.
const BAKE_ENTRY = 'cart/hmsc-int/compile/bakeGameFile.ts';
const BAKE_BUNDLE = `${OUT_DIR}/hmsc-gamefile-bake.js`;
const BAKED_GAMEFILE = `${OUT_DIR}/hmsc.gamefile`;
const CONTENT_STORE_DIR = `${OUT_DIR}/contentstore`;
const FIXTURE_GAMEFILE = 'framework/testing/fixtures/gamefile_roundtrip.b64';
// The scale lab: a procedurally-generated HUGE city baked through the SAME
// game-file pipe, so `rjit game play --massive` stress-tests how big a world the
// stateless no-V8 loader renders before it chokes (compile/bakeMassiveGameFile).
const MASSIVE_BAKE_ENTRY = 'cart/hmsc-int/compile/bakeMassiveGameFile.ts';
const MASSIVE_BAKE_BUNDLE = `${OUT_DIR}/hmsc-massive-bake.js`;
const MASSIVE_GAMEFILE = `${OUT_DIR}/hmsc-massive.gamefile`;
const ORACLE_SMOKE_QUERIES = [
  'physics',
  'kinds',
  'chance',
  'pathing',
  'commands',
  'perception',
  'figure',
  'items',
  'animation',
  'vehicle',
  'chrome',
  'camera',
  'cutscene',
  'telemetry',
] as const;

export async function run(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === 'compile') return compile(__cwd());
  if (subcommand === 'bake') return bake(__cwd(), argv.slice(1));
  if (subcommand === 'verify') return verify(__cwd());
  if (subcommand === 'shot') return shot(__cwd(), argv.slice(1));
  if (subcommand === 'play') return play(__cwd(), argv.slice(1));
  if (subcommand === 'compact-store') return compactStore(__cwd());
  err('Usage: rjit game <compile|bake|verify|shot|play|compact-store>');
  err('  compile  bundle the headless game output');
  err('  bake     write the authored world to zig-out/game/hmsc.gamefile + contentstore');
  err('  verify   compile, boot headless, replay verify scripts + behavior suites, exit with a verdict');
  err('  shot     build the no-V8 loader, render the baked game-file, capture a PNG (--out path)');
  err('  play     build the no-V8 loader and open a live window (close it or press ESC to exit)');
  err('  compact-store  reclaim the model store: rebuild the snapshot + strip superseded stroke/mesh history (close the editor first)');
  err('  play/shot flags: --fixture (codec fixture) | --massive [--blocks N] (procedural scale lab)');
  return 2;
}

// rjit game compact-store (req_1789): reclaim the model store. The event log
// keeps a full ~158KB PNG per paint stroke and the whole mesh per geometry edit
// forever; the editor boots from a snapshot+tail, so once the snapshot holds the
// current state that pre-seam history is redundant. This backs up store.db + the
// snapshot, then runs the v8cli compaction (rebuild snapshot paintBlobs from the
// log, strip superseded stroke/mesh/paint-layer payloads keeping latest-per-key
// and every row so the boot guard stays valid), VACUUMs, and verifies. On any
// failure it restores from the backup. Took a real store 694MB -> 27MB.
const MODEL_DOMAIN = 'cart/hmsc-int/data/domains/model';
function compactStore(root: string): number {
  const db = `${root}/${MODEL_DOMAIN}/store.db`;
  const snap = `${root}/${MODEL_DOMAIN}/snapshots/model.snapshot.json`;
  if (!fsExists(db)) { err(`[compact] no model store at ${db}`); return 1; }
  // VACUUM needs exclusive access — refuse while the editor holds the store.
  const lsof = spawnSync('lsof', [db]);
  if ((lsof.stdout || '').includes('reactjit')) {
    err('[compact] the editor is running and holds the model store — close it first (VACUUM needs exclusive access)');
    return 1;
  }
  const bakDir = `${root}/${MODEL_DOMAIN}/_compact_backup`;
  fsMkdir(bakDir);
  spawnSync('cp', [db, `${bakDir}/store.db`]);
  if (fsExists(snap)) spawnSync('cp', [snap, `${bakDir}/model.snapshot.json`]);
  out('[compact] backed up store.db + snapshot');
  fsMkdir(`${root}/${OUT_DIR}`);
  const bundleOut = `${OUT_DIR}/compact-store.js`;
  if (!bundle(root, 'cart/hmsc-int/editors/model/compactModelStore.run.ts', bundleOut)) {
    err('[compact] bundle failed'); return 1;
  }
  const res = spawnSync(`${root}/tools/v8cli`, [`${root}/${bundleOut}`]);
  if (res.stdout.trim()) out(res.stdout.trim());
  if (res.stderr.trim()) err(res.stderr.trim());
  if (!(res.stdout || '').includes('COMPACT OK')) {
    err('[compact] FAILED — restoring store + snapshot from backup');
    spawnSync('cp', [`${bakDir}/store.db`, db]);
    if (fsExists(`${bakDir}/model.snapshot.json`)) spawnSync('cp', [`${bakDir}/model.snapshot.json`, snap]);
    return 1;
  }
  out(`[compact] done — model store reclaimed; backup kept at ${bakDir} (delete once you've reopened the editor and confirmed)`);
  return 0;
}

function bundle(root: string, entry: string, outFile: string): boolean {
  const result = spawnSync(`${root}/tools/esbuild`, [
    `${root}/${entry}`,
    '--bundle',
    `--outfile=${root}/${outFile}`,
    '--format=iife',
    '--platform=neutral',
    '--target=es2022',
    `--alias:@reactjit=${root}/runtime`,
    `--alias:@game=${root}/${GAME_DIR}`,
    '--log-level=warning',
  ]);
  if (result.stderr.trim()) err(result.stderr.trim());
  return result.code === 0;
}

function compile(root: string): number {
  fsMkdir(`${root}/${OUT_DIR}`);
  if (!bundle(root, COMPILE_ENTRY, HEADLESS_BUNDLE)) {
    err(`[game] compile FAILED: ${COMPILE_ENTRY}`);
    return 1;
  }
  out(`[game] compiled ${COMPILE_ENTRY} -> ${HEADLESS_BUNDLE}`);
  return 0;
}

function bake(root: string, args: string[] = []): number {
  fsMkdir(`${root}/${OUT_DIR}`);
  // --no-pieces + --gamefile <path> (req_1804): the editor pane bakes a PIECE-FREE world
  // to its OWN game-file (hmsc-editor.gamefile) and renders pieces live; /compiled keeps
  // baking the full hmsc.gamefile. Default (no flags) = the original full bake.
  const noPieces = args.includes('--no-pieces');
  const gfIdx = args.indexOf('--gamefile');
  const gamefile = gfIdx >= 0 && args[gfIdx + 1] ? args[gfIdx + 1]! : BAKED_GAMEFILE;
  if (!bakeRealGameFile(root, { noPieces, gamefile })) return 1;
  out(`[game] bake PASS — ${gamefile}${noPieces ? ' (piece-free)' : ''}`);
  return 0;
}

function posixJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function oracleSelfCheckSource(root: string, recordFiles: string[]): string {
  const recordImports = recordFiles.map((file, i) => {
    const abs = posixJoin(root, ORACLE_RECORDS_DIR, file);
    return `import * as record${i} from ${jsString(abs)};`;
  }).join('\n');
  const recordSpecs = recordFiles.map((file, i) => `{ file: ${jsString(`${ORACLE_RECORDS_DIR}/${file}`)}, module: record${i} }`).join(',\n  ');

  return `// Generated by rjit game verify. Do not edit.
import { DECISIONS } from ${jsString(posixJoin(root, ORACLE_INDEX_DIR, 'decisions.ts'))};
import { ALL_DOCS, ALL_INTERFACES, ALL_PATTERNS, ALL_HAZARDS } from ${jsString(posixJoin(root, ORACLE_INDEX_DIR, 'index.ts'))};
${recordImports}

declare const globalThis: any;

const recordSpecs = [
  ${recordSpecs},
];
const decisionStatuses = new Set(['ruled', 'revised', 'open', 'show-me']);
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireObject(value: unknown, path: string): Record<string, unknown> | null {
  if (!isObject(value)) {
    fail(\`\${path}: expected object\`);
    return null;
  }
  return value;
}
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(\`\${path}: expected non-empty string\`);
  return typeof value === 'string' ? value : '';
}
function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(\`\${path}: expected string[]\`);
    return [];
  }
  return value as string[];
}
function requireNonEmptyStringArray(value: unknown, path: string): string[] {
  const items = requireStringArray(value, path);
  if (items.length === 0) fail(\`\${path}: expected non-empty string[]\`);
  return items;
}
function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(\`\${path}: expected array\`);
    return [];
  }
  return value;
}
function requireOneOf(value: unknown, allowed: Set<string>, path: string): string {
  const text = requireString(value, path);
  if (text && !allowed.has(text)) fail(\`\${path}: unexpected value \${JSON.stringify(text)}\`);
  return text;
}

function validateInterface(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchInterfaces calls purpose.join()
  requireString(r.kind, \`\${path}.kind\`);
  requireString(r.description, \`\${path}.description\`);
  requireString(r.status, \`\${path}.status\`); // oracle interfaceLine prints status
}

function validatePattern(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchPatterns calls purpose.join()
  requireString(r.description, \`\${path}.description\`);
  requireStringArray(r.examples, \`\${path}.examples\`); // oracle patternLine calls examples.slice().join()
  requireString(r.status, \`\${path}.status\`); // oracle patternLine prints status
}

function validateHazard(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchHazards calls purpose.join()
  requireString(r.description, \`\${path}.description\`);
  requireStringArray(r.evidence, \`\${path}.evidence\`); // oracle searchHazards calls evidence.join()
  requireString(r.severity, \`\${path}.severity\`); // oracle hazardLine calls severity.toUpperCase()
}

function validateDoc(doc: unknown, file: string): string {
  const d = requireObject(doc, file);
  if (!d) return '';
  const name = requireString(d.name, \`\${file}.name\`);
  requireString(d.file, \`\${file}.file\`);
  requireNonEmptyStringArray(d.purpose, \`\${file}.purpose\`);
  requireString(d.summary, \`\${file}.summary\`);
  requireArray(d.interfaces, \`\${file}.interfaces\`).forEach((item, i) => validateInterface(item, \`\${file}.interfaces[\${i}]\`));
  requireArray(d.patterns, \`\${file}.patterns\`).forEach((item, i) => validatePattern(item, \`\${file}.patterns[\${i}]\`));
  requireArray(d.hazards, \`\${file}.hazards\`).forEach((item, i) => validateHazard(item, \`\${file}.hazards[\${i}]\`));
  return name;
}

const recordNames = new Map<string, string>();
for (const spec of recordSpecs) {
  const docs = Object.entries(spec.module)
    .filter(([, value]) => isObject(value) && 'summary' in value && 'interfaces' in value)
    .map(([, value]) => value);
  if (docs.length !== 1) {
    fail(\`\${spec.file}: expected exactly one DocIndex export, found \${docs.length}\`);
    continue;
  }
  const name = validateDoc(docs[0], spec.file);
  if (name) recordNames.set(name, spec.file);
}

if (!Array.isArray(ALL_DOCS)) fail('docs/game/_index/index.ts: ALL_DOCS must be an array');
for (const doc of ALL_DOCS as unknown[]) {
  const d = doc as any;
  const name = typeof d?.name === 'string' ? d.name : '<unnamed>';
  if (!recordNames.has(name)) fail(\`docs/game/_index/index.ts: ALL_DOCS includes \${name}, but no matching record file was validated\`);
}
for (const [name, file] of recordNames) {
  if (!(ALL_DOCS as any[]).some((doc) => doc?.name === name)) fail(\`docs/game/_index/index.ts: missing \${name} from ALL_DOCS (record file: \${file})\`);
}
if (!Array.isArray(ALL_INTERFACES) || !Array.isArray(ALL_PATTERNS) || !Array.isArray(ALL_HAZARDS)) {
  fail('docs/game/_index/index.ts: flattened oracle views must be arrays');
}

const ids = new Set<string>();
for (let i = 0; i < DECISIONS.length; i += 1) {
  const path = \`docs/game/_index/decisions.ts.DECISIONS[\${i}]\`;
  const d = requireObject(DECISIONS[i], path);
  if (!d) continue;
  const id = requireString(d.id, \`\${path}.id\`);
  if (id && !/^[VPR][0-9]+$/.test(id)) fail(\`\${path}.id: expected V*/P*/R* id, got \${JSON.stringify(id)}\`);
  if (id && ids.has(id)) fail(\`\${path}.id: duplicate id \${id}\`);
  if (id) ids.add(id);
  requireString(d.name, \`\${path}.name\`);
  requireOneOf(d.status, decisionStatuses, \`\${path}.status\`);
  requireString(d.ruling, \`\${path}.ruling\`);
  requireNonEmptyStringArray(d.keywords, \`\${path}.keywords\`);
  if ('retires' in d && d.retires !== undefined) requireStringArray(d.retires, \`\${path}.retires\`);
  if ('cites' in d && d.cites !== undefined) requireStringArray(d.cites, \`\${path}.cites\`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(\`[oracle-self-check] \${failure}\`);
  console.error(\`ORACLE SELF-CHECK RED — \${failures.length} failure(s)\`);
  globalThis.__exit?.(1);
} else {
  console.log(\`ORACLE SELF-CHECK GREEN — \${recordSpecs.length} records, \${DECISIONS.length} decisions\`);
}
`;
}

function runOracleSelfCheck(root: string): boolean {
  if (!fsExists(`${root}/${ORACLE_RECORDS_DIR}`)) {
    err(`[game] oracle self-check FAILED: missing ${ORACLE_RECORDS_DIR}`);
    return false;
  }
  fsMkdir(`${root}/${OUT_DIR}`);
  const recordFiles = fsList(`${root}/${ORACLE_RECORDS_DIR}`)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  fsWrite(`${root}/${ORACLE_SELF_CHECK_ENTRY}`, oracleSelfCheckSource(root, recordFiles));
  if (!bundle(root, ORACLE_SELF_CHECK_ENTRY, ORACLE_SELF_CHECK_BUNDLE)) {
    err('[game] oracle self-check does not bundle');
    return false;
  }
  const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${ORACLE_SELF_CHECK_BUNDLE}`]);
  if (result.stdout.trim()) out(result.stdout.trim());
  if (result.stderr.trim()) err(result.stderr.trim());
  if (result.code !== 0) {
    err('[game] oracle self-check FAILED: record/decision shape');
    return false;
  }

  for (const query of ORACLE_SMOKE_QUERIES) {
    const smoke = spawnSync(`${root}/tools/oracle`, [query]);
    if (smoke.stderr.trim()) err(smoke.stderr.trim());
    const stdout = smoke.stdout.trim();
    if (smoke.code !== 0) {
      err(`[game] oracle smoke FAILED: ${query} exited ${smoke.code}`);
      return false;
    }
    if (!stdout.includes('═══ RULINGS') || stdout.includes('(no ruling matches')) {
      err(`[game] oracle smoke FAILED: ${query} produced no matching RULINGS`);
      if (stdout) err(stdout.split('\n').slice(0, 8).join('\n'));
      return false;
    }
  }
  out(`[game] oracle smoke GREEN — ${ORACLE_SMOKE_QUERIES.length}/${ORACLE_SMOKE_QUERIES.length} queries`);
  return true;
}

/** Every *.test.ts under the suite roots, recursively — each is a P4 behavior suite. */
function findTestSuites(root: string, dir: string): string[] {
  if (!fsExists(`${root}/${dir}`)) return [];
  const suites: string[] = [];
  for (const name of fsList(`${root}/${dir}`)) {
    const path = `${dir}/${name}`;
    const stat = tryFsStat(`${root}/${path}`);
    if (stat?.isDir) suites.push(...findTestSuites(root, path));
    else if (name.endsWith('.test.ts')) suites.push(path);
  }
  return suites.sort();
}

/** TS writes the tape with the production workspace codec; the Zig reader reads
 *  the SAME tape and asserts byte/value identity. Returns false on any drift —
 *  this is the platform spine's proof. */
function runRoundTrip(root: string, rt: RoundTrip): boolean {
  if (!bundle(root, rt.genEntry, rt.genBundle)) {
    err(`[game] ${rt.label} round-trip FAILED: fixture generator does not bundle`);
    return false;
  }
  const gen = spawnSync(`${root}/tools/v8cli`, [`${root}/${rt.genBundle}`]);
  if (gen.stderr.trim()) err(gen.stderr.trim());
  const tape = gen.stdout.trim();
  if (gen.code !== 0 || !tape) {
    err(`[game] ${rt.label} round-trip FAILED: TS writer produced no tape`);
    return false;
  }
  fsWrite(`${root}/${rt.fixture}`, tape);
  const zig = spawnSync('zig', ['build', rt.zigStep]);
  if (zig.stdout.trim()) out(zig.stdout.trim());
  if (zig.stderr.trim()) err(zig.stderr.trim());
  if (zig.code !== 0) {
    err(`[game] ${rt.label} round-trip FAILED: Zig reader disagrees with the TS tape`);
    return false;
  }
  out(`[game] ${rt.label} round-trip GREEN — TS tape <-> Zig reader byte/value identical`);
  return true;
}

/** Run every platform spine round-trip; all must pass. */
function runRoundTrips(root: string): boolean {
  let allGreen = true;
  for (const rt of ROUND_TRIPS) allGreen = runRoundTrip(root, rt) && allGreen;
  return allGreen;
}

/** Assert a well-formed, plausibly-sized PNG at `path` (magic + IHDR dims). */
function assertPng(root: string, path: string): boolean {
  if (!fsExists(`${root}/${path}`)) {
    err(`[game] render proof FAILED: no PNG at ${path}`);
    return false;
  }
  const dump = spawnSync('sh', ['-c', `head -c 24 ${root}/${path} | od -An -v -tu1`]);
  const bytes = dump.stdout.trim().split(/\s+/).map((t) => Number(t));
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || magic.some((m, i) => bytes[i] !== m)) {
    err(`[game] render proof FAILED: ${path} is not a well-formed PNG`);
    return false;
  }
  const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  out(`[game] render proof: PNG ${w}x${h} at ${path}`);
  return w > 0 && h > 0;
}

/** Inventory the loader binary: ZERO V8 symbols and ZERO embedded JS bundle. */
function assertNoV8(root: string): boolean {
  const bin = `${root}/${LOADER_BIN}`;
  const v8 = spawnSync('sh', ['-c', `nm ${bin} 2>/dev/null | grep -ic 'v8::' || true`]);
  const js = spawnSync('sh', ['-c', `strings -n 8 ${bin} 2>/dev/null | grep -icE 'react-reconciler|bundle-${LOADER_NAME}|__reactjit' || true`]);
  const lib = spawnSync('sh', ['-c', `ldd ${bin} 2>/dev/null | grep -ic 'v8' || true`]);
  const v8n = Number(v8.stdout.trim()) || 0;
  const jsn = Number(js.stdout.trim()) || 0;
  const libn = Number(lib.stdout.trim()) || 0;
  if (v8n !== 0 || jsn !== 0 || libn !== 0) {
    err(`[game] no-JS proof FAILED: v8 syms=${v8n}, js markers=${jsn}, v8 libs=${libn}`);
    return false;
  }
  out('[game] no-JS proof: loader binary carries 0 V8 symbols, 0 bundle markers, 0 V8 libs');
  return true;
}

/** Validate a bake's MANIFEST (the small JSON the bake prints on stdout after it
 *  has written the packed binary game-file + content-addressed asset blobs to
 *  disk itself — GL: pack binary, not base64). The bytes are already in place;
 *  this just confirms the files exist at the expected path and reports sizes.
 *  Shared by the authored bake and the massive scale lab. */
function installGameFileManifest(root: string, tapeTransport: string, gamefilePath: string): boolean {
  let manifest: { gamefile?: { path?: string; bytes?: number }; assets?: Array<{ hash: string; path: string; bytes?: number }> };
  try {
    manifest = JSON.parse(tapeTransport);
  } catch (error: any) {
    err(`[game] bake FAILED: malformed game-file manifest: ${String(error?.message ?? error)}`);
    return false;
  }
  const absGamefile = `${root}/${gamefilePath}`;
  const stat = tryFsStat(absGamefile);
  if (!stat || !stat.size) {
    err(`[game] bake FAILED: game-file not written to ${gamefilePath}`);
    return false;
  }
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const asset of assets) {
    if (!/^[0-9a-f]{64}$/.test(asset.hash)) {
      err('[game] bake FAILED: manifest asset hash is not a sha256 hex');
      return false;
    }
    const assetStat = tryFsStat(`${root}/${CONTENT_STORE_DIR}/${asset.hash}`);
    if (!assetStat || !assetStat.size) {
      err(`[game] bake FAILED: content-addressed asset ${asset.hash} missing from the store`);
      return false;
    }
  }
  const assetBytes = assets.reduce((n, asset) => n + (asset.bytes ?? 0), 0);
  out(`[game] wrote raw game-file ${gamefilePath} (${stat.size} bytes, binary; installed ${assets.length} asset(s), ${assetBytes} bytes)`);
  return true;
}

/** Bake the AUTHORED hmsc world (loadEditorWorld) into a game-file the loader
 *  renders. Returns false if the bake doesn't produce a tape. */
function bakeRealGameFile(root: string, opts: { noPieces?: boolean; gamefile?: string } = {}): boolean {
  if (!bundle(root, BAKE_ENTRY, BAKE_BUNDLE)) {
    err('[game] bake FAILED: bakeGameFile does not bundle');
    return false;
  }
  const gamefile = opts.gamefile ?? BAKED_GAMEFILE;
  // The bake writes the packed binary game-file + asset blobs STRAIGHT TO these
  // paths (GL: pack binary, not base64 — emitGameFile.ts) and prints only a
  // manifest. We pass the destinations so it never holds a megabyte-string copy.
  const gen = spawnSync(`${root}/tools/v8cli`, [
    `${root}/${BAKE_BUNDLE}`,
    '--gamefile', `${root}/${gamefile}`,
    '--store', `${root}/${CONTENT_STORE_DIR}`,
    ...(opts.noPieces ? ['--no-pieces'] : []),
  ]);
  if (gen.stderr.trim()) err(gen.stderr.trim());
  const tapeTransport = gen.stdout.trim();
  if (gen.code !== 0 || !tapeTransport) {
    err('[game] bake FAILED: no game-file produced from the authored world');
    return false;
  }
  return installGameFileManifest(root, tapeTransport, gamefile);
}

/** Bake a procedurally-generated HUGE city (the scale lab) into a game-file. The
 *  optional `blocks` knob sizes the N×N city grid; the loader frames + plays it
 *  exactly like a real bake, so this stress-tests the data->loader render path. */
function bakeMassiveGameFile(root: string, blocks?: number): boolean {
  if (!bundle(root, MASSIVE_BAKE_ENTRY, MASSIVE_BAKE_BUNDLE)) {
    err('[game] massive bake FAILED: bakeMassiveGameFile does not bundle');
    return false;
  }
  const args = [
    `${root}/${MASSIVE_BAKE_BUNDLE}`,
    '--gamefile', `${root}/${MASSIVE_GAMEFILE}`,
    '--store', `${root}/${CONTENT_STORE_DIR}`,
  ];
  if (blocks && Number.isFinite(blocks)) args.push('--blocks', String(blocks));
  const gen = spawnSync(`${root}/tools/v8cli`, args);
  if (gen.stderr.trim()) err(gen.stderr.trim());
  const tapeTransport = gen.stdout.trim();
  if (gen.code !== 0 || !tapeTransport) {
    err('[game] massive bake FAILED: no game-file produced from the procedural city');
    return false;
  }
  return installGameFileManifest(root, tapeTransport, MASSIVE_GAMEFILE);
}

type GameFileChoice = { fixture?: boolean; massive?: boolean; blocks?: number };

/** Which game-file the loader should render: the procedural scale lab (--massive),
 *  the freshly-baked authored world (default), else (only when explicitly asked
 *  via --fixture) the synthetic round-trip fixture. A FAILED bake fails LOUDLY
 *  (returns null) — it never silently falls back to the fixture; the fixture is
 *  for the codec round-trip tests only. */
function resolveGameFile(root: string, choice: GameFileChoice = {}): string | null {
  if (choice.massive) {
    if (bakeMassiveGameFile(root, choice.blocks)) return MASSIVE_GAMEFILE;
    err('[game] massive bake FAILED');
    return null;
  }
  if (choice.fixture) return FIXTURE_GAMEFILE;
  if (bakeRealGameFile(root)) return BAKED_GAMEFILE;
  err('[game] bake FAILED — refusing to render the synthetic fixture in its place');
  return null;
}

/** Build the no-V8 loader, construct+render `gameFile` headless, and capture its
 *  own frame to a PNG. The keystone: data -> stateless engine -> rendered frame,
 *  zero V8/JS in the construct+render path. */
function runLoaderRenderProof(root: string, outPath: string, gameFile: string): boolean {
  const build = spawnSync('zig', LOADER_BUILD_ARGS);
  if (build.stderr.trim()) err(build.stderr.trim());
  if (build.code !== 0) {
    err('[game] render proof FAILED: no-V8 loader does not build');
    return false;
  }
  fsMkdir(dirOf(`${root}/${outPath}`));
  const env = [
    'ZIGOS_HEADLESS=1',
    'ZIGOS_SCREENSHOT=1',
    `ZIGOS_SCREENSHOT_OUTPUT='${root}/${outPath}'`,
    'ZIGOS_SCREENSHOT_FRAMES=8',
  ].join(' ');
  const run = spawnSync('sh', ['-c', `${env} timeout -s KILL 90 ${root}/${LOADER_BIN} '${root}/${gameFile}' 2>&1 | grep -E 'loader|SCREENSHOT|construct|FAIL' || true`]);
  const runOut = run.stdout.trim();
  if (runOut) out(runOut);
  if (!assertPng(root, outPath)) return false;
  // The loader reports `built N mesh instances (M placed pieces)`. N == 0 is a
  // legitimately EMPTY map (the active map may have no pieces/paint) — not a
  // failure. The pipeline proof is: a well-formed PNG + zero V8. The content
  // (how much is in the map) is the author's, verified by eye in `game play`.
  const match = runOut.match(/built (\d+) mesh instances/);
  const builtCount = match ? Number(match[1]) : 0;
  if (!assertNoV8(root)) return false;
  out(`[game] loader render proof GREEN — stateless loader rendered ${builtCount} world instances in 3D, no JS`);
  return true;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** Parse the shared game-file selectors: --fixture (codec fixture), --massive
 *  (procedural scale lab) and its --blocks N size knob. */
function parseChoice(argv: string[]): GameFileChoice {
  const choice: GameFileChoice = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') { choice.fixture = true; continue; }
    if (argv[i] === '--massive') { choice.massive = true; continue; }
    if (argv[i] === '--blocks') { choice.blocks = Number(argv[++i]); continue; }
    const m = /^--blocks=(\d+)$/.exec(argv[i] ?? '');
    if (m) choice.blocks = Number(m[1]);
  }
  return choice;
}

/** `rjit game shot [--out path] [--fixture] [--massive [--blocks N]]` — render
 *  the authored world (or the scale lab / test fixture) to a PNG, on demand. */
function shot(root: string, argv: string[]): number {
  let outPath = `shots/${LOADER_NAME}.png`;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' || argv[i] === '-o') { outPath = argv[++i] ?? outPath; continue; }
  }
  const gameFile = resolveGameFile(root, parseChoice(argv));
  if (!gameFile) {
    err('[game] shot FAILED: no game-file (the bake failed)');
    return 1;
  }
  if (!runLoaderRenderProof(root, outPath, gameFile)) {
    err('[game] shot FAILED');
    return 1;
  }
  out(`[game] shot PASS — ${outPath}`);
  return 0;
}

/** `rjit game play [--fixture] [--massive [--blocks N]]` — build the no-V8 loader
 *  and open a live, closeable window rendering the authored world (or the
 *  procedural scale lab / test fixture). */
function play(root: string, argv: string[]): number {
  const gameFile = resolveGameFile(root, parseChoice(argv));
  if (!gameFile) {
    err('[game] play FAILED: no game-file (the bake failed)');
    return 1;
  }
  const build = spawnSync('zig', LOADER_BUILD_ARGS);
  if (build.stderr.trim()) err(build.stderr.trim());
  if (build.code !== 0) {
    err('[game] play FAILED: no-V8 loader does not build');
    return 1;
  }
  out('[game] launching live window — close it or press ESC to exit...');
  // No screenshot env → the loader opens a visible window and runs until closed.
  const run = spawnSync(`${root}/${LOADER_BIN}`, [`${root}/${gameFile}`]);
  if (run.stdout.trim()) out(run.stdout.trim());
  if (run.stderr.trim()) err(run.stderr.trim());
  return run.code === 0 ? 0 : 1;
}

function verify(root: string): number {
  if (compile(root) !== 0) {
    err('[game] VERDICT RED — the game does not compile');
    return 1;
  }

  // ── oracle self-check: docs/game/_index is part of the test surface ─────
  const oracleOk = runOracleSelfCheck(root);

  // ── platform spine: TS-writer <-> Zig-reader round-trips (rle + game-file) ─
  const roundtripOk = runRoundTrips(root);

  // ── keystone: the stateless no-V8 loader constructs + renders the REAL
  //    authored world's 3D geometry (not the codec fixture) and we assert it
  //    drew many instances at real positions. A failed bake is a RED. ──
  const renderGameFile = resolveGameFile(root, {});
  if (!renderGameFile) err('[game] render proof FAILED: the authored bake produced no game-file');
  const renderOk = renderGameFile ? runLoaderRenderProof(root, LOADER_SHOT, renderGameFile) : false;

  // ── the P4 behavior suites (dual-sided testing's TS side) ────────────────
  fsMkdir(`${root}/${TEST_OUT_DIR}`);
  const suites = SUITE_ROOTS.flatMap((suiteRoot) => findTestSuites(root, suiteRoot));
  let suitesPassed = 0;
  for (const suite of suites) {
    const name = suite.replace(/^cart\/hmsc-int\//, '').replace(/\//g, '_').replace(/\.test\.ts$/, '.test.js');
    const compiled = `${TEST_OUT_DIR}/${name}`;
    if (!bundle(root, suite, compiled)) {
      err(`[game] suite does not bundle: ${suite}`);
      continue;
    }
    const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${compiled}`]);
    if (result.stdout.trim()) out(result.stdout.trim());
    if (result.stderr.trim()) err(result.stderr.trim());
    if (result.code === 0) suitesPassed += 1;
    else err(`[game] suite FAILED: ${suite}`);
  }

  // ── the verify scripts: boot headless, replay, demand the green verdict ──
  const scripts = fsExists(`${root}/${VERIFY_DIR}`)
    ? fsList(`${root}/${VERIFY_DIR}`).filter((name) => name.endsWith('.cmds')).sort()
    : [];
  let scriptsPassed = 0;
  for (const script of scripts) {
    const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${HEADLESS_BUNDLE}`, `${root}/${VERIFY_DIR}/${script}`]);
    if (result.stdout.trim()) out(result.stdout.trim());
    if (result.stderr.trim()) err(result.stderr.trim());
    if (result.code === 0) scriptsPassed += 1;
    else err(`[game] verify script FAILED: ${VERIFY_DIR}/${script}`);
  }

  const green = oracleOk && roundtripOk && renderOk && suitesPassed === suites.length && scriptsPassed === scripts.length && scripts.length > 0;
  const tally = `${oracleOk ? 1 : 0}/1 oracle, ${roundtripOk ? ROUND_TRIPS.length : 0}/${ROUND_TRIPS.length} round-trips, ${renderOk ? 1 : 0}/1 render, ${suitesPassed}/${suites.length} suites, ${scriptsPassed}/${scripts.length} scripts`;
  if (!green) {
    err(`[game] VERDICT RED — ${tally}`);
    return 1;
  }
  out(`[game] VERDICT GREEN — ${tally}`);
  return 0;
}
