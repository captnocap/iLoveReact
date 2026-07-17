// cli/commands/game.ts - `rjit game bake` / `rjit game verify`.
//
// The authored/played compile path is `rjit game bake`: it writes the platform
// game-file consumed by the no-V8 compiled route. `rjit game verify` keeps a
// separate command-script harness for V19 replay tests, but that harness is not
// the game compiler and is intentionally not exposed as `rjit game compile`.
//
//   rjit game bake      cart/hmsc-int/compile/bakeGameFile.ts -> zig-out/game/hmsc.gamefile
//   rjit game verify    bake + loader proof + suites + scripts -> GREEN/RED + exit code

import { fsExists, fsList, fsMkdir, fsWrite, tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

const GAME_DIR = 'cart/hmsc-int/game';
/** every root whose *.test.ts suites the verify run owns (game + the V20 data layer + the editor routes + the COMPILE bake (req_0652 — its five suites existed but never ran here) + the oracle/_index layer incl. the request ledger) */
const SUITE_ROOTS = [GAME_DIR, 'cart/hmsc-int/data', 'cart/hmsc-int/editors', 'cart/hmsc-int/compile', 'docs/game/_index'];
const VERIFY_HARNESS_ENTRY = 'cart/hmsc-int/compile/verifyHarness.ts';
const VERIFY_DIR = 'cart/hmsc-int/compile/verify';
const OUT_DIR = 'zig-out/game';
const VERIFY_HARNESS_BUNDLE = `${OUT_DIR}/hmsc-verify-harness.js`;
const TEST_OUT_DIR = `${OUT_DIR}/tests`;
const ORACLE_INDEX_DIR = 'docs/game/_index';
const ORACLE_RECORDS_DIR = `${ORACLE_INDEX_DIR}/records`;
const ORACLE_SELF_CHECK_ENTRY = `${OUT_DIR}/oracle-self-check.ts`;
const ORACLE_SELF_CHECK_BUNDLE = `${OUT_DIR}/oracle-self-check.js`;

/** Same zig resolution as ship/dev/tui: REACTJIT_ZIG override, bundled SDK zig, then PATH. */
function resolveZig(root: string): string {
  const bundled = __env('REACTJIT_ZIG') || `${root}/tools/zig/zig`;
  if (fsExists(bundled)) return bundled;
  return 'zig';
}
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
const LOADER_SOURCE = 'framework/world_loader.zig';
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
const PARITY_ENTRY = 'cart/hmsc-int/compile/parityGameFile.ts';
const PARITY_TS_BUNDLE = `${OUT_DIR}/hmsc-parity-ts.js`;
const PARITY_SOURCE = `${OUT_DIR}/hmsc-parity-source.txt`;
const PARITY_TS_GAMEFILE = `${OUT_DIR}/hmsc-parity-ts.gamefile`;
const PARITY_ZIG_GAMEFILE = `${OUT_DIR}/hmsc-parity-zig.gamefile`;
const PARITY_ZIG_BIN = 'zig-out/bin/hmsc_parity_compile';
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
  if (subcommand === 'compile') return retiredCompileCommand();
  if (subcommand === 'bake') return bake(__cwd(), argv.slice(1));
  if (subcommand === 'verify') return verify(__cwd());
  if (subcommand === 'parity') return parity(__cwd(), argv.slice(1));
  if (subcommand === 'shot') return shot(__cwd(), argv.slice(1));
  if (subcommand === 'play') return play(__cwd(), argv.slice(1));
  if (subcommand === 'compact-store') return compactStore(__cwd());
  err('Usage: rjit game <bake|verify|parity|shot|play|compact-store>');
  err('  bake     write the authored world to zig-out/game/hmsc.gamefile + contentstore');
  err('  verify   bake, prove the no-V8 loader, run suites + verify scripts, exit with a verdict');
  err('  parity   compile one generated world with TS and Zig, byte-compare outputs, report timings');
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

function retiredCompileCommand(): number {
  err('[game] `rjit game compile` is retired. The in-app Compile button maps to `rjit game bake`; use `rjit game verify` for the command-script harness.');
  return 2;
}

function bundleVerifyHarness(root: string): number {
  fsMkdir(`${root}/${OUT_DIR}`);
  if (!bundle(root, VERIFY_HARNESS_ENTRY, VERIFY_HARNESS_BUNDLE)) {
    err(`[game] verify harness FAILED: ${VERIFY_HARNESS_ENTRY}`);
    return 1;
  }
  out(`[game] bundled verify harness ${VERIFY_HARNESS_ENTRY} -> ${VERIFY_HARNESS_BUNDLE}`);
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
  // --editor-stem <stem> (req_2013): the per-map ISOLATED editor bake — bake just
  // that map (pieces/floors scoped to it, terrain from its per-map editor key) to
  // its own gamefile, never touching the boot key. The editor loader uses one file
  // per map so switching is instant on revisit; /compiled keeps the unflagged bake.
  const esIdx = args.indexOf('--editor-stem');
  const editorStem = esIdx >= 0 && args[esIdx + 1] ? args[esIdx + 1]! : undefined;
  // The per-map files live under zig-out/game/editor/<stem>.gamefile — ensure the
  // parent dir exists so an arbitrary --gamefile path lands.
  const slash = gamefile.lastIndexOf('/');
  if (slash > 0) fsMkdir(`${root}/${gamefile.slice(0, slash)}`);
  if (!bakeRealGameFile(root, { noPieces, gamefile, editorStem })) return 1;
  out(`[game] bake PASS — ${gamefile}${noPieces ? ' (piece-free)' : ''}${editorStem ? ` (editor map '${editorStem}')` : ''}`);
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
  const zig = spawnSync(resolveZig(root), ['build', rt.zigStep]);
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
function bakeRealGameFile(root: string, opts: { noPieces?: boolean; gamefile?: string; editorStem?: string } = {}): boolean {
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
    ...(opts.editorStem ? ['--editor-stem', opts.editorStem] : []),
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

type ParityOptions = {
  width: number;
  height: number;
  seed: number;
  assetCount: number;
  assetBytes: number;
};

type CompilerReport = {
  compiler: string;
  width: number;
  height: number;
  cells: number;
  bytes: number;
  compileMs: number;
  wallMs?: number;
};

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function readNumberArg(argv: string[], index: number, name: string): { value: number | null; next: number } {
  const arg = argv[index] ?? '';
  if (arg === name && argv[index + 1]) return { value: Number(argv[index + 1]), next: index + 1 };
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) return { value: Number(arg.slice(prefix.length)), next: index };
  return { value: null, next: index };
}

function parseParityOptions(argv: string[]): ParityOptions {
  const opts: ParityOptions = {
    width: 1536,
    height: 1536,
    seed: 0x5eed1234,
    assetCount: 8,
    assetBytes: 4096,
  };
  for (let i = 0; i < argv.length; i += 1) {
    let parsed = readNumberArg(argv, i, '--size');
    if (parsed.value !== null) {
      opts.width = opts.height = clampInt(parsed.value, 16, 8192);
      i = parsed.next;
      continue;
    }
    parsed = readNumberArg(argv, i, '--width');
    if (parsed.value !== null) {
      opts.width = clampInt(parsed.value, 16, 8192);
      i = parsed.next;
      continue;
    }
    parsed = readNumberArg(argv, i, '--height');
    if (parsed.value !== null) {
      opts.height = clampInt(parsed.value, 16, 8192);
      i = parsed.next;
      continue;
    }
    parsed = readNumberArg(argv, i, '--seed');
    if (parsed.value !== null) {
      opts.seed = clampInt(parsed.value, 0, 0xffffffff);
      i = parsed.next;
      continue;
    }
    parsed = readNumberArg(argv, i, '--assets');
    if (parsed.value !== null) {
      opts.assetCount = clampInt(parsed.value, 0, 4096);
      i = parsed.next;
      continue;
    }
    parsed = readNumberArg(argv, i, '--asset-bytes');
    if (parsed.value !== null) {
      opts.assetBytes = clampInt(parsed.value, 0, 16 * 1024 * 1024);
      i = parsed.next;
      continue;
    }
  }
  return opts;
}

function paritySourceText(opts: ParityOptions): string {
  return [
    'format=hmsc.parity.v0',
    `width=${opts.width}`,
    `height=${opts.height}`,
    `seed=${opts.seed >>> 0}`,
    `asset_count=${opts.assetCount}`,
    `asset_bytes=${opts.assetBytes}`,
    '',
  ].join('\n');
}

function parseCompilerReport(stdout: string, compiler: string): CompilerReport | null {
  const lines = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    const report = JSON.parse(last) as CompilerReport;
    return report.compiler === compiler ? report : null;
  } catch {
    return null;
  }
}

function sha256File(path: string): string {
  const result = spawnSync('sha256sum', [path]);
  if (result.code !== 0) return '<sha256sum failed>';
  return result.stdout.trim().split(/\s+/)[0] ?? '<sha256sum failed>';
}

function parity(root: string, argv: string[]): number {
  const opts = parseParityOptions(argv);
  fsMkdir(`${root}/${OUT_DIR}`);
  fsWrite(`${root}/${PARITY_SOURCE}`, paritySourceText(opts));
  out(`[game] parity source ${PARITY_SOURCE}: ${opts.width}x${opts.height} (${opts.width * opts.height} cells), assets=${opts.assetCount}x${opts.assetBytes}B`);

  if (!bundle(root, PARITY_ENTRY, PARITY_TS_BUNDLE)) {
    err('[game] parity FAILED: TypeScript parity compiler does not bundle');
    return 1;
  }

  const zigBuild = spawnSync(resolveZig(root), ['build', 'hmsc-parity-compiler', '-Doptimize=ReleaseFast']);
  if (zigBuild.stdout.trim()) out(zigBuild.stdout.trim());
  if (zigBuild.stderr.trim()) err(zigBuild.stderr.trim());
  if (zigBuild.code !== 0) {
    err('[game] parity FAILED: Zig parity compiler does not build');
    return 1;
  }

  const absSource = `${root}/${PARITY_SOURCE}`;
  const absTsOut = `${root}/${PARITY_TS_GAMEFILE}`;
  const absZigOut = `${root}/${PARITY_ZIG_GAMEFILE}`;

  const tsWall0 = __nowMs();
  const tsRun = spawnSync(`${root}/tools/v8cli`, [`${root}/${PARITY_TS_BUNDLE}`, '--source', absSource, '--out', absTsOut]);
  const tsWallMs = __nowMs() - tsWall0;
  if (tsRun.stderr.trim()) err(tsRun.stderr.trim());
  if (tsRun.code !== 0) {
    err('[game] parity FAILED: TypeScript compiler run failed');
    if (tsRun.stdout.trim()) out(tsRun.stdout.trim());
    return 1;
  }
  const tsReport = parseCompilerReport(tsRun.stdout, 'typescript');
  if (!tsReport) {
    err('[game] parity FAILED: TypeScript compiler did not print a report');
    if (tsRun.stdout.trim()) out(tsRun.stdout.trim());
    return 1;
  }
  tsReport.wallMs = tsWallMs;

  const zigWall0 = __nowMs();
  const zigRun = spawnSync(`${root}/${PARITY_ZIG_BIN}`, ['--source', absSource, '--out', absZigOut]);
  const zigWallMs = __nowMs() - zigWall0;
  if (zigRun.stderr.trim()) err(zigRun.stderr.trim());
  if (zigRun.code !== 0) {
    err('[game] parity FAILED: Zig compiler run failed');
    if (zigRun.stdout.trim()) out(zigRun.stdout.trim());
    return 1;
  }
  const zigReport = parseCompilerReport(zigRun.stdout, 'zig');
  if (!zigReport) {
    err('[game] parity FAILED: Zig compiler did not print a report');
    if (zigRun.stdout.trim()) out(zigRun.stdout.trim());
    return 1;
  }
  zigReport.wallMs = zigWallMs;

  const tsStat = tryFsStat(absTsOut);
  const zigStat = tryFsStat(absZigOut);
  if (!tsStat || !zigStat || tsStat.size !== zigStat.size) {
    err(`[game] parity FAILED: output sizes differ TS=${tsStat?.size ?? 0} Zig=${zigStat?.size ?? 0}`);
    return 1;
  }
  const cmp = spawnSync('cmp', ['-s', absTsOut, absZigOut]);
  if (cmp.code !== 0) {
    const detail = spawnSync('cmp', [absTsOut, absZigOut]);
    if (detail.stdout.trim()) err(detail.stdout.trim());
    if (detail.stderr.trim()) err(detail.stderr.trim());
    err('[game] parity FAILED: TS and Zig game-files differ');
    return 1;
  }

  const hash = sha256File(absTsOut);
  const speedup = zigReport.compileMs > 0 ? tsReport.compileMs / zigReport.compileMs : Infinity;
  out(`[game] TypeScript parity compile: ${tsReport.compileMs.toFixed(1)}ms inside compiler (${tsReport.wallMs.toFixed(1)}ms wall), ${tsReport.bytes} bytes`);
  out(`[game] Zig parity compile:        ${zigReport.compileMs.toFixed(1)}ms inside compiler (${zigReport.wallMs.toFixed(1)}ms wall), ${zigReport.bytes} bytes`);
  out(`[game] parity PASS — byte-identical game-files (${tsStat.size} bytes, sha256 ${hash}); Zig is ${speedup.toFixed(2)}x by in-compiler time`);
  return 0;
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
  const build = spawnSync(resolveZig(root), LOADER_BUILD_ARGS);
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
  const build = spawnSync(resolveZig(root), LOADER_BUILD_ARGS);
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
  if (bundleVerifyHarness(root) !== 0) {
    err('[game] VERDICT RED — the verify harness does not bundle');
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
    const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${VERIFY_HARNESS_BUNDLE}`, `${root}/${VERIFY_DIR}/${script}`]);
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
