// cli/commands/play.ts — run a .rjpkg through the package player.

import { fsExists } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

export async function run(argv: string[]): Promise<number> {
  const pkg = argv[0];
  if (!pkg || argv.length > 1) return usage(pkg ? 'too many arguments' : 'missing package path');
  const root = __cwd();
  const binary = `${root}/zig-out/bin/rjit-player`;
  if (!fsExists(binary)) {
    out('[play] rjit-player binary missing — building via rjit ship...');
    const build = spawnSync('env', ['SHIP_RUN_PACKAGE=0', `${root}/tools/rjit`, 'ship', 'rjit-player']);
    writeSpawnOutput(build);
    if (build.code !== 0) return build.code || 1;
  }
  const result = spawnSync(binary, [pkg]);
  writeSpawnOutput(result);
  return result.code;
}

function usage(message: string): number {
  err(`[play] ${message}`);
  err('Usage: rjit play path/to/game.rjpkg');
  return 2;
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}
