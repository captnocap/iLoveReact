// cli/commands/bake-icons.ts - pre-bake icon polylines into an SDF atlas.

import { fsRead, fsWrite } from '../host/fs.ts';
import { err } from '../host/log.ts';

type Polyline = number[];
type IconPolylines = Polyline[];

interface IconMeta {
  name: string;
  u: number;
  v: number;
  w: number;
  h: number;
}

const ROOT = __cwd();
const ICONS_TS = `${ROOT}/runtime/icons/icons.ts`;
const OUT_ZIG = `${ROOT}/framework/gpu/icon_atlas.zig`;
const OUT_PGM_HEX = `${ROOT}/framework/gpu/icon_atlas_debug.ppm.txt`;
const OUT_TS = `${ROOT}/runtime/icons/baked-names.ts`;

const VIEWBOX = 24;
const HIRES = 256;
const TILE = 32;
const STROKE_HIRES = 4;
const SPREAD_HIRES = 18;
const ATLAS_COLS = 16;
const PADDING = 2;

const ICON_NAMES = [
  'Heart', 'Search', 'ArrowRight', 'Plus', 'X', 'Settings',
  'Star', 'Home', 'Eye', 'User', 'Bell', 'Bookmark',
  'Upload', 'Download', 'Save', 'FileImage', 'Image',
  'Hand', 'Brush', 'WandSparkles', 'Eraser', 'RotateCcw', 'Palette',
  'Minus', 'Square', 'Maximize', 'Minimize', 'Scissors',
  'FolderOpen', 'FolderInput', 'PanelTop', 'PanelLeft',
  'Undo2', 'Redo2', 'RefreshCw', 'RefreshCcw',
  'Copy', 'ArrowUp', 'ArrowDown', 'Merge', 'Trash2', 'Package',
  'ScanLine', 'Spline',
];

const HEX = '0123456789abcdef';

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    __writeStdout('Usage: rjit bake-icons\n');
    return 0;
  }
  if (argv.length !== 0) {
    err('[bake-icons] usage: rjit bake-icons');
    return 1;
  }

  const srcRaw = fsRead(ICONS_TS);
  const polylines: Record<string, IconPolylines> = {};
  const missing: string[] = [];
  for (const name of ICON_NAMES) {
    const data = loadIcon(srcRaw, name);
    if (!data) {
      missing.push(name);
      continue;
    }
    polylines[name] = data;
  }
  if (missing.length) return fail(`missing icons in icons.ts: ${missing.join(', ')}`);

  const cols = ATLAS_COLS;
  const rows = Math.ceil(ICON_NAMES.length / cols);
  const cellPx = TILE + PADDING * 2;
  const atlasW = cols * cellPx;
  const atlasH = rows * cellPx;
  const atlas = new Uint8Array(atlasW * atlasH);
  const meta: IconMeta[] = [];

  log(`baking ${ICON_NAMES.length} icons into ${atlasW}×${atlasH} R8 atlas (tile ${TILE}, hires ${HIRES})`);

  for (let i = 0; i < ICON_NAMES.length; i++) {
    const name = ICON_NAMES[i]!;
    const t0 = Date.now();
    const mask = rasterizePolylines(polylines[name]!);
    const sdf = distanceTransform(mask);
    const hi = encodeSdf(sdf);
    const tile = downsample(hi);

    const col = i % cols;
    const row = Math.floor(i / cols);
    const u = col * cellPx + PADDING;
    const v = row * cellPx + PADDING;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        atlas[(v + y) * atlasW + (u + x)] = tile[y * TILE + x]!;
      }
    }
    meta.push({ name, u, v, w: TILE, h: TILE });
    log(`  [${i + 1}/${ICON_NAMES.length}] ${name} (${Date.now() - t0}ms)`);
  }

  fsWrite(OUT_ZIG, emitZig(atlas, meta, atlasW, atlasH));
  log(`wrote ${OUT_ZIG} (${meta.length} icons + ${atlas.length}-byte atlas inlined)`);

  fsWrite(OUT_PGM_HEX, emitPgmHex(atlas, atlasW, atlasH));
  log(`wrote ${OUT_PGM_HEX} - preview via:`);
  log(`  xxd -r -p ${OUT_PGM_HEX} > /tmp/icon_atlas.pgm && xdg-open /tmp/icon_atlas.pgm`);

  fsWrite(OUT_TS, emitNamesTs(meta));
  log(`wrote ${OUT_TS}`);
  log('done.');
  return 0;
}

function loadIcon(src: string, name: string): IconPolylines | null {
  const needle = `export const ${name}: number[][] = `;
  const start = src.indexOf(needle);
  if (start < 0) return null;
  let i = start + needle.length;
  let depth = 0;
  const begin = i;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(src.slice(begin, i + 1)) as IconPolylines;
      }
    }
    i++;
  }
  return null;
}

function plotDisc(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
    }
  }
}

function plotSegment(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    plotDisc(mask, w, h, x0, y0, r);
    return;
  }
  const steps = Math.max(1, Math.ceil(len * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    plotDisc(mask, w, h, x0 + dx * t, y0 + dy * t, r);
  }
}

function rasterizePolylines(polylines: IconPolylines): Uint8Array {
  const mask = new Uint8Array(HIRES * HIRES);
  const scale = HIRES / VIEWBOX;
  const r = STROKE_HIRES * 0.5;
  for (const poly of polylines) {
    if (poly.length < 2) continue;
    plotDisc(mask, HIRES, HIRES, poly[0]! * scale, poly[1]! * scale, r);
    for (let i = 2; i + 1 < poly.length; i += 2) {
      plotSegment(
        mask,
        HIRES,
        HIRES,
        poly[i - 2]! * scale,
        poly[i - 1]! * scale,
        poly[i]! * scale,
        poly[i + 1]! * scale,
        r,
      );
    }
  }
  return mask;
}

function distanceTransform(mask: Uint8Array): Float32Array {
  const w = HIRES;
  const h = HIRES;
  const sdf = new Float32Array(w * h);
  const r = SPREAD_HIRES;
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx]) {
        sdf[idx] = 0;
        continue;
      }
      let best = r2;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        const dy2 = dy * dy;
        if (dy2 >= best) continue;
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (!mask[row + xx]) continue;
          const dx = xx - x;
          const d2 = dx * dx + dy2;
          if (d2 < best) best = d2;
        }
      }
      sdf[idx] = Math.sqrt(best);
    }
  }
  return sdf;
}

function encodeSdf(sdf: Float32Array): Uint8Array {
  const out = new Uint8Array(sdf.length);
  for (let i = 0; i < sdf.length; i++) {
    const v = 1 - sdf[i]! / SPREAD_HIRES;
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

function downsample(hi: Uint8Array): Uint8Array {
  const factor = HIRES / TILE;
  if (Math.floor(factor) !== factor) throw new Error('HIRES must be integer multiple of TILE');
  const lo = new Uint8Array(TILE * TILE);
  const f2 = factor * factor;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let sum = 0;
      const sy = y * factor;
      const sx = x * factor;
      for (let dy = 0; dy < factor; dy++) {
        const row = (sy + dy) * HIRES;
        for (let dx = 0; dx < factor; dx++) {
          sum += hi[row + sx + dx]!;
        }
      }
      lo[y * TILE + x] = Math.round(sum / f2);
    }
  }
  return lo;
}

function emitZig(atlas: Uint8Array, meta: IconMeta[], atlasW: number, atlasH: number): string {
  let zig = '// Auto-generated by scripts/bake-icons.js — do not edit.\n';
  zig += '// Source: runtime/icons/icons.ts\n';
  zig += `// Atlas: ${atlasW}×${atlasH} R8, ${ICON_NAMES.length} icons, tile=${TILE}, hires=${HIRES}.\n`;
  zig += `// SDF encoding: byte = clamp(255 * (1 - dist/${SPREAD_HIRES}_hires_px), 0, 255).\n`;
  zig += `// Effective spread in tile space: ${SPREAD_HIRES * TILE / HIRES} px.\n`;
  zig += `// Smoothstep edge sits at byte 128 (== distance ${SPREAD_HIRES / 2} hires px).\n\n`;
  zig += `pub const ATLAS_W: u32 = ${atlasW};\n`;
  zig += `pub const ATLAS_H: u32 = ${atlasH};\n`;
  zig += `pub const TILE: u32 = ${TILE};\n`;
  zig += `pub const SPREAD_TILE_PX: f32 = ${(SPREAD_HIRES * TILE / HIRES).toFixed(4)};\n\n`;
  zig += 'pub const IconUv = struct { name: []const u8, u: u32, v: u32, w: u32, h: u32 };\n\n';
  zig += 'pub const ICONS = [_]IconUv{\n';
  for (const m of meta) {
    zig += `    .{ .name = "${m.name}", .u = ${m.u}, .v = ${m.v}, .w = ${m.w}, .h = ${m.h} },\n`;
  }
  zig += '};\n\n';
  zig += 'pub const ATLAS = [_]u8{\n';
  for (let i = 0; i < atlas.length; i += 16) {
    let row = '   ';
    for (let j = 0; j < 16 && i + j < atlas.length; j++) {
      row += ` ${atlas[i + j]!},`;
    }
    zig += `${row}\n`;
  }
  zig += '};\n';
  return zig;
}

function emitPgmHex(atlas: Uint8Array, atlasW: number, atlasH: number): string {
  const header = `P5\n${atlasW} ${atlasH}\n255\n`;
  let hexDump = '';
  for (let i = 0; i < header.length; i++) hexDump += hexByte(header.charCodeAt(i));
  hexDump += bytesToHex(atlas);
  let wrapped = '';
  for (let i = 0; i < hexDump.length; i += 64) {
    wrapped += `${hexDump.slice(i, i + 64)}\n`;
  }
  return wrapped;
}

function emitNamesTs(meta: IconMeta[]): string {
  let ts = '// Auto-generated by scripts/bake-icons.js — do not edit.\n';
  ts += '// Names of icons present in the SDF atlas (framework/gpu/icon_atlas.zig).\n';
  ts += '// Icon.tsx checks membership before routing to the SDF primitive; misses\n';
  ts += '// fall through to the legacy <Graph.Path> renderer.\n\n';
  ts += 'export const BAKED_ICON_NAMES: ReadonlySet<string> = new Set([\n';
  for (const m of meta) ts += `  "${m.name}",\n`;
  ts += ']);\n';
  return ts;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += hexByte(bytes[i]!);
  return out;
}

function hexByte(value: number): string {
  return HEX[value >> 4]! + HEX[value & 15]!;
}

function log(message: string): void {
  __writeStderr(`[bake-icons] ${message}\n`);
}

function fail(message: string): number {
  err(`[bake-icons] ${message}`);
  return 1;
}
