import { existsSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

export async function updateCommand(args) {
  const cwd = process.cwd();

  // Sanity check: are we inside an iLoveReact project?
  const hasMain = existsSync(join(cwd, 'main.lua')) || existsSync(join(cwd, 'src'));
  if (!hasMain) {
    console.error('  This does not look like an iLoveReact project.');
    console.error('  Run this command from inside a project created with `ilovereact init`.');
    process.exit(1);
  }

  const runtimeLua = join(CLI_ROOT, 'runtime', 'lua');
  const runtimeLib = join(CLI_ROOT, 'runtime', 'lib');
  const runtimePkgs = join(CLI_ROOT, 'runtime', 'ilovereact');

  if (!existsSync(runtimeLua) || !existsSync(runtimePkgs)) {
    console.error('  CLI runtime not found. Run `make cli-setup` first.');
    process.exit(1);
  }

  console.log('\n  Updating iLoveReact runtime...\n');

  // Update lua/
  const destLua = join(cwd, 'lua');
  if (existsSync(destLua)) {
    rmSync(destLua, { recursive: true });
  }
  cpSync(runtimeLua, destLua, { recursive: true });
  console.log('  Updated lua/');

  // Update lib/
  if (existsSync(runtimeLib)) {
    const destLib = join(cwd, 'lib');
    if (existsSync(destLib)) {
      rmSync(destLib, { recursive: true });
    }
    cpSync(runtimeLib, destLib, { recursive: true });
    console.log('  Updated lib/');
  }

  // Update bin/ (tor binary)
  const runtimeBin = join(CLI_ROOT, 'runtime', 'bin');
  if (existsSync(runtimeBin)) {
    const destBin = join(cwd, 'bin');
    if (existsSync(destBin)) {
      rmSync(destBin, { recursive: true });
    }
    cpSync(runtimeBin, destBin, { recursive: true });
    console.log('  Updated bin/');
  }

  // Update ilovereact/ (shared + native packages)
  if (existsSync(runtimePkgs)) {
    const destPkgs = join(cwd, 'ilovereact');
    if (existsSync(destPkgs)) {
      rmSync(destPkgs, { recursive: true });
    }
    cpSync(runtimePkgs, destPkgs, { recursive: true });
    console.log('  Updated ilovereact/');
  }

  console.log('\n  Done! Runtime files are up to date.\n');
}
