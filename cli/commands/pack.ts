// cli/commands/pack.ts — build a game package (.rjpkg).

import { bundleCart } from '../cart/bundle.ts';
import { fsMkdir, fsWrite } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

export async function run(argv: string[]): Promise<number> {
  const name = argv[0];
  let outDir = '';
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--out' || arg === '-o') {
      outDir = argv[++i] ?? '';
    } else {
      return usage(`unknown argument: ${arg}`);
    }
  }
  if (!name) return usage('missing package name');
  if (name !== 'hmsc') return usage(`unsupported package for slice 1: ${name}`);

  const root = __cwd();
  const rjitHome = __env('RJIT_HOME') || root;
  const packageDir = outDir || `${root}/cart/hmsc-int/exports/hmsc.rjpkg`;
  fsMkdir(packageDir);

  const helperOut = `${root}/zig-out/game/hmsc-pack-package.js`;
  fsMkdir(`${root}/zig-out/game`);
  const helper = spawnSync(`${root}/tools/esbuild`, [
    `${root}/cart/hmsc-int/compile/packPackage.ts`,
    '--bundle',
    `--outfile=${helperOut}`,
    '--format=iife',
    '--platform=neutral',
    '--target=es2022',
    `--alias:@reactjit=${root}/runtime`,
    '--log-level=warning',
  ]);
  writeSpawnOutput(helper);
  if (helper.code !== 0) return helper.code || 1;

  const runHelper = spawnSync(`${root}/tools/v8cli`, [helperOut]);
  if (runHelper.stderr) __writeStderr(runHelper.stderr);
  if (runHelper.code !== 0) return runHelper.code || 1;
  const emitted = JSON.parse(runHelper.stdout) as { manifest: unknown; mapBase64: string };
  fsMkdir(`${packageDir}/maps`);
  fsMkdir(`${packageDir}/assets`);
  fsWrite(`${packageDir}/manifest.json`, `${JSON.stringify(emitted.manifest, null, 2)}\n`);
  const mapPath = `${packageDir}/maps/city.map`;
  const mapWrite = spawnSync('sh', ['-c', `base64 -d > ${shellQuote(mapPath)}`], emitted.mapBase64);
  writeSpawnOutput(mapWrite);
  if (mapWrite.code !== 0) return mapWrite.code || 1;

  const bundleOut = `${packageDir}/bundle.js`;
  const bundle = bundleCart({
    rjitHome,
    cartEntry: `${root}/cart/hmsc/index.tsx`,
    outFile: bundleOut,
    mode: 'cartridge',
  });
  writeSpawnOutput(bundle);
  if (bundle.code !== 0) return bundle.code || 1;
  out(`[pack] done -> ${packageDir}`);
  return 0;
}

function usage(message: string): number {
  err(`[pack] ${message}`);
  err('Usage: rjit pack hmsc [--out path/to/hmsc.rjpkg]');
  return 2;
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
