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
//   rjit game verify    compile fresh, then suites + scripts -> GREEN/RED + exit code

import { fsExists, fsList, fsMkdir, tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

const GAME_DIR = 'cart/hmsc-int/game';
const COMPILE_ENTRY = 'cart/hmsc-int/compile/main.ts';
const VERIFY_DIR = 'cart/hmsc-int/compile/verify';
const OUT_DIR = 'zig-out/game';
const HEADLESS_BUNDLE = `${OUT_DIR}/hmsc-headless.js`;
const TEST_OUT_DIR = `${OUT_DIR}/tests`;

export async function run(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === 'compile') return compile(__cwd());
  if (subcommand === 'verify') return verify(__cwd());
  err('Usage: rjit game <compile|verify>');
  err('  compile  bundle the headless game output');
  err('  verify   compile, boot headless, replay verify scripts + behavior suites, exit with a verdict');
  return 2;
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

/** Every *.test.ts under game/, recursively — each is a P4 behavior suite. */
function findTestSuites(root: string, dir: string = GAME_DIR): string[] {
  const suites: string[] = [];
  for (const name of fsList(`${root}/${dir}`)) {
    const path = `${dir}/${name}`;
    const stat = tryFsStat(`${root}/${path}`);
    if (stat?.isDir) suites.push(...findTestSuites(root, path));
    else if (name.endsWith('.test.ts')) suites.push(path);
  }
  return suites.sort();
}

function verify(root: string): number {
  if (compile(root) !== 0) {
    err('[game] VERDICT RED — the game does not compile');
    return 1;
  }

  // ── the P4 behavior suites (dual-sided testing's TS side) ────────────────
  fsMkdir(`${root}/${TEST_OUT_DIR}`);
  const suites = findTestSuites(root);
  let suitesPassed = 0;
  for (const suite of suites) {
    const name = suite.slice(GAME_DIR.length + 1).replace(/\//g, '_').replace(/\.test\.ts$/, '.test.js');
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

  const green = suitesPassed === suites.length && scriptsPassed === scripts.length && scripts.length > 0;
  const tally = `${suitesPassed}/${suites.length} suites, ${scriptsPassed}/${scripts.length} scripts`;
  if (!green) {
    err(`[game] VERDICT RED — ${tally}`);
    return 1;
  }
  out(`[game] VERDICT GREEN — ${tally}`);
  return 0;
}
