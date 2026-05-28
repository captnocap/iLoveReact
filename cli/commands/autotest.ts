// cli/commands/autotest.ts - build and run headless witness tests.

import { fsExists, fsMkdir, fsStat, tryFsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

interface CartPaths {
  entry: string;
}

export async function run(argv: string[]): Promise<number> {
  const name = argv[0];
  if (!name) {
    err('Usage: scripts/autotest <name>');
    err('  e.g.: scripts/autotest sweatshop');
    return 1;
  }
  if (argv.length > 1) {
    err(`[autotest] unexpected argument: ${argv[1]}`);
    return 1;
  }

  const root = __cwd();
  const testFile = `${root}/tests/${name}.autotest`;
  const cart = resolveCart(root, name);
  if (!fsExists(testFile)) return fail(`[autotest] ERROR: no test file at tests/${name}.autotest`);
  if (!cart) return fail(`[autotest] ERROR: no cart found for ${name} (expected cart/${name}/index.tsx or cart/${name}.tsx)`);

  const binary = `${root}/zig-out/bin/${name}`;
  if (binaryCurrent(binary, cart.entry)) {
    out(`[autotest] ${name} binary is current, skipping build`);
    out(`[autotest] regenerating tests/${name}.autotest from current binary...`);
    spawnSync('env', [
      'ZIGOS_HEADLESS=1',
      'ZIGOS_WITNESS=snapshot',
      `ZIGOS_WITNESS_FILE=${testFile}`,
      'timeout',
      '-s',
      'KILL',
      '300',
      binary,
    ]);
    if (!fileNonEmpty(testFile)) return fail('[autotest] ERROR: snapshot regeneration produced no test file');
  } else {
    out(`[autotest] building ${name}...`);
    const build = spawnSync(`${root}/tools/rjit`, ['ship', name]);
    if (build.code !== 0) {
      out('[autotest] BUILD FAILED');
      return 1;
    }
  }

  if (!fsExists(binary)) return fail(`[autotest] ERROR: binary not found at zig-out/bin/${name}`);

  const timestamp = dateStamp();
  const flatDir = `${root}/tests/screenshots/${name}`;
  const outDir = `${flatDir}/${timestamp}`;
  fsMkdir(flatDir);
  cleanFlatDir(flatDir);

  out('[autotest] running...');
  runWitness(root, name, binary, testFile);

  if (!fsExists(`${flatDir}/manifest.txt`)) {
    out('[autotest] WARNING: no manifest - screenshots may not have been captured');
    return 1;
  }

  const grid = spawnSync('python3', [`${root}/scripts/autotest-grid`, name]);
  writeSpawnOutput(grid);

  const tag = (tryFsRead(`${flatDir}/verdict.txt`) ?? 'FAIL').trim() || 'FAIL';
  const exit = tag === 'PASS' ? 0 : 1;
  const taggedDir = `${outDir}_${tag}`;
  fsMkdir(taggedDir);
  moveProofFiles(flatDir, taggedDir);
  spawnSync('ln', ['-sfn', basename(taggedDir), `${flatDir}/latest`]);

  if (tag === 'PASS') {
    out(`[autotest] PASS - proof: ${rel(root, taggedDir)}/proof.png`);
  } else {
    out(`[autotest] FAIL - proof: ${rel(root, taggedDir)}/proof.png`);
  }
  return exit;
}

function resolveCart(root: string, name: string): CartPaths | null {
  const dirEntry = `${root}/cart/${name}/index.tsx`;
  if (fsExists(dirEntry)) return { entry: dirEntry };
  const fileEntry = `${root}/cart/${name}.tsx`;
  if (fsExists(fileEntry)) return { entry: fileEntry };
  return null;
}

function binaryCurrent(binary: string, cartEntry: string): boolean {
  if (!fsExists(binary)) return false;
  return fsStat(binary).mtimeMs > fsStat(cartEntry).mtimeMs;
}

function fileNonEmpty(path: string): boolean {
  return fsExists(path) && fsStat(path).size > 0;
}

function dateStamp(): string {
  const result = spawnSync('date', ['+%Y%m%d_%H%M%S']);
  return result.stdout.trim() || String(Math.floor(__nowMs()));
}

function cleanFlatDir(flatDir: string): void {
  spawnSync('sh', ['-c', `rm -f "${flatDir}"/step_*.png "${flatDir}"/manifest.txt "${flatDir}"/proof.png "${flatDir}"/verdict.txt`]);
}

function runWitness(root: string, name: string, binary: string, testFile: string): void {
  const sourceFiles: string[] = [];
  for (const candidate of [`${root}/cart/${name}/data.ts`, `${root}/cart/${name}/data.tsx`]) {
    if (fsExists(candidate)) sourceFiles.push(rel(root, candidate));
  }

  const env = [
    'ZIGOS_HEADLESS=1',
    'ZIGOS_WITNESS=autotest',
    `ZIGOS_WITNESS_FILE=${shellQuote(testFile)}`,
    `ZIGOS_SOURCE=${shellQuote(sourceFiles.join(':'))}`,
  ].join(' ');
  const filter = 'grep --line-buffered -v "AUTOTEST RESULT" | grep --line-buffered -E "expect|click|reject|color|bg|border|styles|PASS|FAIL|OK|VERIFY|audit|MISSING|changed"';
  const cmd = `${env} stdbuf -oL timeout -s KILL 600 ${shellQuote(binary)} 2>&1 | ${filter}`;
  const result = spawnSync('sh', ['-c', `${cmd} || true`]);
  writeSpawnOutput(result);
}

function moveProofFiles(flatDir: string, taggedDir: string): void {
  spawnSync('sh', ['-c', `mv "${flatDir}"/step_*.png "${flatDir}"/manifest.txt "${flatDir}"/proof.png "${flatDir}"/verdict.txt "${taggedDir}"/ 2>/dev/null || true`]);
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

function rel(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function fail(message: string): number {
  err(message);
  return 1;
}
