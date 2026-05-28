// cli/commands/firecracker-build.ts - TS recipe to bootable Firecracker rootfs.

import { fsExists, fsMkdir, fsWrite } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

interface RecipeSpec {
  id: string;
  base: string;
  arch: string;
  apt: string[];
  npmGlobal?: string[];
  steps?: RecipeStep[];
  output: { kind: 'ext4' | 'squashfs'; path: string; sizeMb?: number };
}

type RecipeStep =
  | { run: string }
  | { writeFile: { path: string; content: string; mode?: number } }
  | { copyFromHost: { src: string; dest: string } };

export async function run(argv: string[]): Promise<number> {
  const root = __cwd();
  const parsed = parseArgs(argv, root);
  if (typeof parsed === 'number') return parsed;

  log(`bundling recipe: ${parsed}`);
  const bundled = spawnSync(`${root}/tools/esbuild`, [
    '--bundle',
    '--format=cjs',
    '--platform=neutral',
    '--target=es2022',
    '--log-level=warning',
    parsed,
  ]);
  if (bundled.stderr) __writeStderr(bundled.stderr);
  if (bundled.code !== 0) return fail(`esbuild failed: ${bundled.code}`, bundled.code || 1);

  const spec = evalRecipe(bundled.stdout);
  if (!spec) return fail('recipe must default-export an object');
  const valid = validateSpec(spec);
  if (valid) return fail(valid);

  log(`recipe: id=${spec.id} base=${spec.base} apt=${spec.apt.length} steps=${(spec.steps || []).length}`);

  const outPath = abs(root, spec.output.path);
  const outDir = dirname(outPath);
  fsMkdir(outDir);
  if (fsExists(outPath)) spawnSync('/bin/rm', ['-f', outPath]);

  const hooks = buildCustomizeHooks(root, spec);
  if (typeof hooks === 'number') return hooks;

  const mmdbArgs = [
    '--variant=minbase',
    '--components=main,universe',
    `--include=${spec.apt.join(',')}`,
    ...hooks.map((hook) => `--customize-hook=${hook}`),
    spec.base,
    outPath,
  ];

  log(`mmdebstrap -> ${outPath}`);
  const t0 = __nowMs();
  const mmdb = runTee('/usr/bin/mmdebstrap', mmdbArgs);
  if (mmdb !== 0) return mmdb;
  log(`mmdebstrap done in ${((__nowMs() - t0) / 1000).toFixed(1)}s`);

  if (spec.output.kind === 'ext4' && spec.output.sizeMb) {
    const cur = fileSize(outPath);
    const targetBytes = spec.output.sizeMb * 1024 * 1024;
    if (targetBytes > cur) {
      log(`growing ext4: ${cur >> 20}MB -> ${spec.output.sizeMb}MB`);
      const trunc = runTee('/usr/bin/truncate', ['-s', `${spec.output.sizeMb}M`, outPath]);
      if (trunc !== 0) return trunc;
      const resize = runTee('/usr/sbin/resize2fs', [outPath]);
      if (resize !== 0) return resize;
    }
  }

  const sizeBytes = fileSize(outPath);
  const manifest = {
    id: spec.id,
    builtAt: new Date().toISOString(),
    recipePath: parsed.startsWith(`${root}/`) ? parsed.slice(root.length + 1) : parsed,
    base: spec.base,
    arch: spec.arch,
    apt: spec.apt,
    npmGlobal: spec.npmGlobal || [],
    output: { kind: spec.output.kind, path: spec.output.path, sizeBytes },
    buildElapsedMs: __nowMs() - t0,
  };
  const manifestPath = outPath.replace(/\.[^.]+$/, '') + '.manifest.json';
  fsWrite(manifestPath, JSON.stringify(manifest, null, 2));
  log(`manifest -> ${manifestPath}`);
  log(`done. output: ${outPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
  return 0;
}

function parseArgs(argv: string[], root: string): string | number {
  let recipePath = '';
  for (const arg of argv) {
    if (arg.startsWith('--')) return fail(`unknown flag: ${arg}`);
    if (!recipePath) recipePath = arg;
    else return fail(`extra positional arg: ${arg}`);
  }
  if (!recipePath) return fail('usage: firecracker-build.js <recipe.ts>');
  const resolved = abs(root, recipePath);
  if (!fsExists(resolved)) return fail(`recipe not found: ${resolved}`);
  return resolved;
}

function evalRecipe(code: string): RecipeSpec | null {
  const moduleObj = { exports: {} as any };
  try {
    new Function('module', 'exports', code)(moduleObj, moduleObj.exports);
  } catch (error) {
    throw new Error(`failed to eval recipe: ${(error as Error).message || String(error)}`);
  }
  const spec = moduleObj.exports.default || moduleObj.exports;
  return spec && typeof spec === 'object' ? spec as RecipeSpec : null;
}

function validateSpec(spec: RecipeSpec): string {
  for (const field of ['id', 'base', 'arch', 'apt', 'output'] as const) {
    if (!spec[field]) return `recipe missing required field: ${field}`;
  }
  if (!Array.isArray(spec.apt)) return 'recipe.apt must be string[]';
  if (!spec.output.kind || !spec.output.path) return 'recipe.output must have {kind, path}';
  if (spec.output.kind === 'ext4' && !spec.output.sizeMb) return 'ext4 output requires sizeMb';
  if (spec.arch !== 'amd64') return `only amd64 is supported in v0 (got ${spec.arch})`;
  return '';
}

function buildCustomizeHooks(root: string, spec: RecipeSpec): string[] | number {
  const hooks: string[] = [];
  for (const pkg of spec.npmGlobal || []) {
    hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`npm install -g ${pkg}`)}`);
  }
  for (const step of spec.steps || []) {
    if ('run' in step) {
      hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(step.run)}`);
    } else if ('writeFile' in step) {
      const wf = step.writeFile;
      const cmd = `mkdir -p "$(dirname "$1${wf.path}")" && echo ${shellEscape(b64encode(wf.content))} | base64 -d > "$1${wf.path}"` +
        (wf.mode ? ` && chmod ${wf.mode.toString(8)} "$1${wf.path}"` : '');
      hooks.push(cmd);
    } else if ('copyFromHost' in step) {
      const cf = step.copyFromHost;
      const src = abs(root, cf.src);
      if (!fsExists(src)) return fail(`copyFromHost src not found: ${src}`);
      const kind = spawnSync('/usr/bin/stat', ['-c', '%F', src]).stdout.trim();
      if (kind === 'directory') {
        hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`mkdir -p ${cf.dest}`)}`);
        hooks.push(`sync-in ${src} ${cf.dest}`);
      } else {
        const parent = cf.dest.substring(0, cf.dest.lastIndexOf('/')) || '/';
        hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`mkdir -p ${parent}`)}`);
        hooks.push(`upload ${src} ${cf.dest}`);
      }
    } else {
      return fail(`unknown step shape: ${JSON.stringify(step)}`);
    }
  }
  return hooks;
}

function runTee(bin: string, args: string[]): number {
  const result = spawnSync(bin, args);
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
  if (result.code !== 0) return fail(`${bin} exited ${result.code}`, result.code || 1);
  return 0;
}

function fileSize(path: string): number {
  const result = spawnSync('/usr/bin/stat', ['-c', '%s', path]);
  return parseInt(result.stdout.trim(), 10) || 0;
}

function abs(root: string, path: string): string {
  if (path.startsWith('/')) return path;
  const trimmed = path.startsWith('./') ? path.slice(2) : path;
  return `${root}/${trimmed}`;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function b64encode(value: string): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < value.length; i += 3) {
    const b0 = value.charCodeAt(i) & 0xff;
    const b1 = i + 1 < value.length ? value.charCodeAt(i + 1) & 0xff : 0;
    const b2 = i + 2 < value.length ? value.charCodeAt(i + 2) & 0xff : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += table[(n >> 18) & 63];
    out += table[(n >> 12) & 63];
    out += i + 1 < value.length ? table[(n >> 6) & 63] : '=';
    out += i + 2 < value.length ? table[n & 63] : '=';
  }
  return out;
}

function log(message: string): void {
  out(`[fc-build] ${message}`);
}

function fail(message: string, code: number = 1): number {
  err(`[fc-build] ${message}`);
  return code;
}
