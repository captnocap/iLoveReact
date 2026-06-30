// cli/commands/shot.ts — headless self-capture of a cart's rendered frame
// (SELFSHOT-0606).
//
// USER RULING (2026-06-06, the all-lanes stop): "if anyone wants to get
// screenshots. they need to figure it out without using my desktop. make a
// command to get the proper screenshot of whatever u need, dont look at the
// system." Desktop/X11 capture (import -window, scrot, etc.) is BANNED.
//
// This verb is the replacement for HEADLESS verification: boot the cart's
// shipped binary with a HIDDEN window (ZIGOS_HEADLESS=1 — never mapped on
// any desktop), optionally navigate to a route (RJIT_BOOT_ROUTE), let the
// app render N frames, capture its OWN swapchain (framework/gpu/capture.zig
// env mode), write the PNG, exit. The verb then ASSERTS the artifact: file
// exists, PNG magic, plausible size, parsed dimensions — exit non-zero
// otherwise, so `rjit shot` doubles as the capability's smoke test.
//
//   rjit shot <cart> [--out path.png] [--route /r] [--frames N] [--timeout S]
//
// The live-app sibling is the in-app console verb `shot [path]`
// (__capture_frame — same readback, host-fn-driven, no exit).

import { fsExists, fsList, fsMkdir, fsStat, tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';

export async function run(argv: string[]): Promise<number> {
  let name: string | null = null;
  let outPath: string | null = null;
  let route: string | null = null;
  let frames = 60;
  let timeoutS = 120;
  const binaryArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      binaryArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--out' || arg === '-o') { outPath = argv[++i] ?? null; continue; }
    if (arg === '--route' || arg === '-r') { route = argv[++i] ?? null; continue; }
    if (arg === '--frames') { frames = Math.max(1, Number(argv[++i] ?? 60) || 60); continue; }
    if (arg === '--timeout') { timeoutS = Math.max(5, Number(argv[++i] ?? 120) || 120); continue; }
    if (arg.startsWith('-')) return usage(`unknown flag: ${arg}`);
    if (name === null) { name = arg; continue; }
    return usage('too many positional args');
  }
  if (!name) return usage('missing cart name');

  const root = __cwd();
  const cartEntry = resolveCartEntry(root, name);
  if (!cartEntry) return fail(`[shot] no cart found for ${name} (expected cart/${name}/index.tsx or cart/${name}.tsx)`);

  const binary = `${root}/zig-out/bin/${name}`;
  if (!binaryCurrent(binary, cartEntry)) {
    out(`[shot] ${name} binary is stale/missing — building via ship...`);
    const build = spawnSync(`${root}/tools/rjit`, ['ship', name]);
    if (build.stderr) __writeStderr(build.stderr);
    if (build.code !== 0) return fail('[shot] BUILD FAILED');
  }
  if (!fsExists(binary)) return fail(`[shot] binary not found at zig-out/bin/${name}`);

  const png = outPath ?? `${root}/shots/${name}-${dateStamp()}.png`;
  fsMkdir(dirname(png));

  // ZIGOS_HEADLESS=1: SDL_WINDOW_HIDDEN — the window is never shown on any
  // desktop; the GPU renders offscreen-equivalent and the capture reads back
  // the composed frame. ZERO desktop access by construction.
  const env = [
    'ZIGOS_HEADLESS=1',
    'ZIGOS_SCREENSHOT=1',
    `ZIGOS_SCREENSHOT_OUTPUT=${shellQuote(png)}`,
    `ZIGOS_SCREENSHOT_FRAMES=${frames}`,
    ...(route ? [`RJIT_BOOT_ROUTE=${shellQuote(route)}`] : []),
  ].join(' ');
  out(`[shot] booting ${name} hidden${route ? ` at ${route}` : ''}, capturing after ${frames} frames...`);
  const argText = binaryArgs.map(shellQuote).join(' ');
  const cmd = `${env} timeout -s KILL ${timeoutS} ${shellQuote(binary)} ${argText}`;
  out(`[shot] command: ${cmd}`);
  const result = spawnSync('sh', ['-c', `${cmd} 2>&1 | grep -E "SCREENSHOT|capture|RJIT_PLAYER_ARGV" || true`]);
  if (result.stdout) __writeStdout(result.stdout);

  // ── the assertion: a non-empty, plausibly-sized, well-formed PNG ──
  if (!fsExists(png)) return fail(`[shot] FAIL — no PNG at ${png} (did the app crash before frame ${frames}?)`);
  const size = fsStat(png).size;
  if (size < 1024) return fail(`[shot] FAIL — ${png} is ${size} bytes (implausibly small for a rendered frame)`);
  const dims = pngDims(png);
  if (!dims) return fail(`[shot] FAIL — ${png} is not a well-formed PNG (bad magic/IHDR)`);
  out(`[shot] PASS — ${png} (${dims.w}x${dims.h}, ${size} bytes)`);
  return 0;
}

function resolveCartEntry(root: string, name: string): string | null {
  const dirEntry = `${root}/cart/${name}/index.tsx`;
  if (fsExists(dirEntry)) return dirEntry;
  const fileEntry = `${root}/cart/${name}.tsx`;
  if (fsExists(fileEntry)) return fileEntry;
  return null;
}

function binaryCurrent(binary: string, cartEntry: string): boolean {
  if (!fsExists(binary)) return false;
  // A decomposed cart bundles EVERY file under its directory, not just index.tsx.
  // Comparing the binary only against the entry file silently serves a stale
  // binary whenever an imported component/data file changed (the entry didn't).
  // So compare against the NEWEST mtime across the whole cart source.
  const dirCart = cartEntry.endsWith('/index.tsx');
  const sourceRoot = dirCart ? dirname(cartEntry) : cartEntry;
  return fsStat(binary).mtimeMs >= newestMtime(sourceRoot);
}

// Newest mtime in a file or directory tree (recursive). 0 if missing.
function newestMtime(path: string): number {
  const st = tryFsStat(path);
  if (!st) return 0;
  if (!st.isDir) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of fsList(path)) {
    if (entry === '.' || entry === '..') continue;
    const m = newestMtime(`${path}/${entry}`);
    if (m > newest) newest = m;
  }
  return newest;
}

/** Parse PNG magic + IHDR width/height — the well-formedness assertion.
 *  The CLI host's __fs_read is string-typed (would mangle binary), so the
 *  24 header bytes come through `od` as decimal text. */
function pngDims(path: string): { w: number; h: number } | null {
  const dump = spawnSync('sh', ['-c', `head -c 24 ${shellQuote(path)} | od -An -v -tu1`]);
  const bytes = dump.stdout.trim().split(/\s+/).map((token) => Number(token));
  if (bytes.length < 24 || bytes.some((value) => !Number.isFinite(value))) return null;
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== magic[i]) return null;
  // IHDR is always the first chunk: length(4) 'IHDR'(4) then w(4) h(4)
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null;
  const w = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
  const h = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

function dateStamp(): string {
  const result = spawnSync('date', ['+%Y%m%d_%H%M%S']);
  return result.stdout.trim() || String(Math.floor(__nowMs()));
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function usage(message: string): number {
  err(`[shot] ${message}`);
  err('Usage: rjit shot <cart> [--out path.png] [--route /r] [--frames N] [--timeout S] [-- app-args...]');
  err('  Captures the cart\'s OWN rendered frame headless (hidden window — the');
  err('  user\'s desktop is never touched). Asserts a well-formed PNG; exit 0 = PASS.');
  return 2;
}

function fail(message: string): number {
  err(message);
  return 1;
}
