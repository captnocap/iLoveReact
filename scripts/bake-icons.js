// scripts/bake-icons.js — pre-bake icon polylines into an SDF atlas.
//
// Run via: tools/v8cli scripts/bake-icons.js
//
// Pipeline:
//   1. Read runtime/icons/icons.ts, extract `export const Name: number[][] = [...]`
//   2. For each picked icon: rasterize strokes onto a HIRES (256×256) binary mask
//   3. Brute-force unsigned distance transform → SDF
//      Encoding: byte = clamp(255 * (1 - dist/SPREAD), 0, 255)
//        - 255 at stroke center (distance 0)
//        - 128 at distance = SPREAD/2 (the natural smoothstep threshold)
//        - 0 beyond SPREAD
//   4. Downsample to TILE (32×32) via 8×8 box-average. Anti-aliasing happens
//      naturally because we're averaging the high-res SDF, not the binary mask.
//   5. Pack into atlas grid (16 tiles wide → 512 px wide)
//   6. Emit: framework/gpu/icon_atlas.zig
//             - metadata table (icon name → {u, v, w, h})
//             - atlas bytes inlined as `pub const ATLAS = [_]u8{ 0, 12, 47, ... }`
//             Single text file → @embedFile not required, atlas is just a Zig const.
//           framework/gpu/icon_atlas_debug.ppm.txt
//             - hex dump of a P5 PGM image; convert to PNG via:
//               xxd -r -p framework/gpu/icon_atlas_debug.ppm.txt > /tmp/atlas.pgm
//
// The text-only output is a workaround for v8cli's __writeFile coercing
// through UTF-8 (corrupts bytes > 127). Adding a __writeBytesB64 binding
// would clean this up but isn't worth a v8cli rebuild for a build script.

const ROOT = __cwd();
const ICONS_TS = ROOT + '/runtime/icons/icons.ts';
const OUT_ZIG = ROOT + '/framework/gpu/icon_atlas.zig';
const OUT_PGM_HEX = ROOT + '/framework/gpu/icon_atlas_debug.ppm.txt';

// ── Tunables ──────────────────────────────────────────────────────────
const VIEWBOX = 24;          // Lucide source viewBox
const HIRES = 256;           // rasterization resolution per icon (high-quality SDF)
const TILE = 32;             // atlas tile size per icon (post-downsample)
const STROKE_HIRES = 22;     // stroke thickness in HIRES space (~2 in viewBox space → 22 in 256)
const SPREAD_HIRES = 32;     // distance encoding spread in HIRES px (= 4 px in TILE space)
const ATLAS_COLS = 16;       // tiles per row
const PADDING = 2;           // tile padding so neighbors don't bleed via bilinear sampling

// Vertical-slice icon list — extend later. These are confirmed in icons.ts.
const ICON_NAMES = [
  'Heart', 'Search', 'ArrowRight', 'Plus', 'X', 'Settings',
  'Star', 'Home', 'Eye', 'User', 'Bell', 'Bookmark',
];

// ── Boilerplate ───────────────────────────────────────────────────────
function die(msg) { __writeStderr('[bake-icons] ' + msg + '\n'); __exit(1); }
function log(msg) { __writeStderr('[bake-icons] ' + msg + '\n'); }

// ── Read icons.ts and extract named polylines ─────────────────────────
function loadIcon(src, name) {
  // Match: `export const Name: number[][] = [[...],[...]];`
  // Bracket-balance scan instead of regex (icon arrays contain commas/decimals).
  const needle = `export const ${name}: number[][] = `;
  const start = src.indexOf(needle);
  if (start < 0) return null;
  let i = start + needle.length;
  let depth = 0;
  let begin = i;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const literal = src.slice(begin, i + 1);
        return JSON.parse(literal);
      }
    }
    i++;
  }
  return null;
}

// ── Stroke rasterization (HIRES×HIRES binary mask) ────────────────────
// Drop a thick line segment (Bresenham-thickened with circular brush) onto mask.
// Using a circular brush gives round caps, matching Lucide's stroke-linecap=round.
function plotDisc(mask, w, h, cx, cy, r) {
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

function plotSegment(mask, w, h, x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) { plotDisc(mask, w, h, x0, y0, r); return; }
  const steps = Math.max(1, Math.ceil(len * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    plotDisc(mask, w, h, x0 + dx * t, y0 + dy * t, r);
  }
}

function rasterizePolylines(polylines) {
  const mask = new Uint8Array(HIRES * HIRES);
  const scale = HIRES / VIEWBOX;
  const r = STROKE_HIRES * 0.5;
  for (const poly of polylines) {
    if (poly.length < 2) continue;
    plotDisc(mask, HIRES, HIRES, poly[0] * scale, poly[1] * scale, r);
    for (let i = 2; i + 1 < poly.length; i += 2) {
      plotSegment(
        mask, HIRES, HIRES,
        poly[i - 2] * scale, poly[i - 1] * scale,
        poly[i] * scale,     poly[i + 1] * scale,
        r,
      );
    }
  }
  return mask;
}

// ── Distance transform (brute force, bounded by SPREAD) ───────────────
// For each pixel, find min distance to any 'on' pixel within SPREAD radius.
// Inner loop bounded to (2*SPREAD)² neighborhood — at SPREAD=32, ~4096 ops/px,
// 256² × 4096 = 268M ops per icon. ~120 ms / icon in JS. Build-time only.
function distanceTransform(mask) {
  const w = HIRES, h = HIRES;
  const sdf = new Float32Array(w * h);
  const r = SPREAD_HIRES;
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx]) { sdf[idx] = 0; continue; }
      let best = r2;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const y0v = Math.max(0, y - r);
      const y1v = Math.min(h - 1, y + r);
      for (let yy = y0v; yy <= y1v; yy++) {
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

// ── Encode SDF to byte field ──────────────────────────────────────────
// Encoding: byte = clamp(255 * (1 - dist/SPREAD), 0, 255)
//   dist 0   → byte 255 (stroke center, fully opaque)
//   dist S/2 → byte 128 (the smoothstep threshold)
//   dist S   → byte 0   (well outside)
function encodeSdf(sdf) {
  const out = new Uint8Array(sdf.length);
  for (let i = 0; i < sdf.length; i++) {
    const v = 1 - sdf[i] / SPREAD_HIRES;
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

// ── Box-downsample HIRES → TILE ───────────────────────────────────────
function downsample(hi) {
  const factor = HIRES / TILE;
  if (Math.floor(factor) !== factor) die('HIRES must be integer multiple of TILE');
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
          sum += hi[row + sx + dx];
        }
      }
      lo[y * TILE + x] = Math.round(sum / f2);
    }
  }
  return lo;
}

// ── Hex utilities (for text-only binary output) ───────────────────────
const HEX = '0123456789abcdef';
function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[b >> 4] + HEX[b & 15];
  }
  return out;
}

// ── Main bake ─────────────────────────────────────────────────────────
const srcRaw = __readFile(ICONS_TS);
if (!srcRaw) die('failed to read ' + ICONS_TS);

const polylines = {};
const missing = [];
for (const name of ICON_NAMES) {
  const data = loadIcon(srcRaw, name);
  if (!data) { missing.push(name); continue; }
  polylines[name] = data;
}
if (missing.length) die('missing icons in icons.ts: ' + missing.join(', '));

const cols = ATLAS_COLS;
const rows = Math.ceil(ICON_NAMES.length / cols);
const cellPx = TILE + PADDING * 2;
const atlasW = cols * cellPx;
const atlasH = rows * cellPx;
const atlas = new Uint8Array(atlasW * atlasH);
const meta = []; // { name, u, v, w, h }  (px, integer)

log(`baking ${ICON_NAMES.length} icons into ${atlasW}×${atlasH} R8 atlas (tile ${TILE}, hires ${HIRES})`);

for (let i = 0; i < ICON_NAMES.length; i++) {
  const name = ICON_NAMES[i];
  const t0 = Date.now();
  const mask = rasterizePolylines(polylines[name]);
  const sdf = distanceTransform(mask);
  const hi = encodeSdf(sdf);
  const tile = downsample(hi);

  const col = i % cols;
  const row = Math.floor(i / cols);
  const u = col * cellPx + PADDING;
  const v = row * cellPx + PADDING;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      atlas[(v + y) * atlasW + (u + x)] = tile[y * TILE + x];
    }
  }
  meta.push({ name, u, v, w: TILE, h: TILE });
  log(`  [${i + 1}/${ICON_NAMES.length}] ${name} (${Date.now() - t0}ms)`);
}

// ── Write Zig source: metadata + inlined atlas bytes ──────────────────
let zig = `// Auto-generated by scripts/bake-icons.js — do not edit.\n`;
zig += `// Source: runtime/icons/icons.ts\n`;
zig += `// Atlas: ${atlasW}×${atlasH} R8, ${ICON_NAMES.length} icons, tile=${TILE}, hires=${HIRES}.\n`;
zig += `// SDF encoding: byte = clamp(255 * (1 - dist/${SPREAD_HIRES}_hires_px), 0, 255).\n`;
zig += `// Effective spread in tile space: ${SPREAD_HIRES * TILE / HIRES} px.\n`;
zig += `// Smoothstep edge sits at byte 128 (== distance ${SPREAD_HIRES / 2} hires px).\n\n`;
zig += `pub const ATLAS_W: u32 = ${atlasW};\n`;
zig += `pub const ATLAS_H: u32 = ${atlasH};\n`;
zig += `pub const TILE: u32 = ${TILE};\n`;
zig += `pub const SPREAD_TILE_PX: f32 = ${(SPREAD_HIRES * TILE / HIRES).toFixed(4)};\n\n`;
zig += `pub const IconUv = struct { name: []const u8, u: u32, v: u32, w: u32, h: u32 };\n\n`;
zig += `pub const ICONS = [_]IconUv{\n`;
for (const m of meta) {
  zig += `    .{ .name = "${m.name}", .u = ${m.u}, .v = ${m.v}, .w = ${m.w}, .h = ${m.h} },\n`;
}
zig += `};\n\n`;

// Inline atlas bytes as a compact Zig const. 16 bytes per line.
zig += `pub const ATLAS = [_]u8{\n`;
for (let i = 0; i < atlas.length; i += 16) {
  let row = '   ';
  for (let j = 0; j < 16 && i + j < atlas.length; j++) {
    row += ' ' + atlas[i + j] + ',';
  }
  zig += row + '\n';
}
zig += `};\n`;
if (!__writeFile(OUT_ZIG, zig)) die('failed to write ' + OUT_ZIG);
log(`wrote ${OUT_ZIG} (${meta.length} icons + ${atlas.length}-byte atlas inlined)`);

// ── Write debug PGM as hex (so xxd -r -p reproduces a valid binary PGM) ──
const header = `P5\n${atlasW} ${atlasH}\n255\n`;
let hexDump = '';
for (let i = 0; i < header.length; i++) {
  const b = header.charCodeAt(i);
  hexDump += HEX[b >> 4] + HEX[b & 15];
}
hexDump += bytesToHex(atlas);
// 64 hex chars per line (== 32 bytes per line) — easy on the eyes.
let wrapped = '';
for (let i = 0; i < hexDump.length; i += 64) {
  wrapped += hexDump.slice(i, i + 64) + '\n';
}
if (!__writeFile(OUT_PGM_HEX, wrapped)) die('failed to write ' + OUT_PGM_HEX);
log(`wrote ${OUT_PGM_HEX} — preview via:`);
log(`  xxd -r -p ${OUT_PGM_HEX} > /tmp/icon_atlas.pgm && xdg-open /tmp/icon_atlas.pgm`);

// ── Emit TS sidecar so runtime/icons/Icon.tsx can decide whether the SDF ──
// path is available without a host roundtrip. Lookup is by exact PascalCase
// name (matches the keys in icons.ts and sdf_icons.zig).
const OUT_TS = ROOT + '/runtime/icons/baked-names.ts';
let ts = `// Auto-generated by scripts/bake-icons.js — do not edit.\n`;
ts += `// Names of icons present in the SDF atlas (framework/gpu/icon_atlas.zig).\n`;
ts += `// Icon.tsx checks membership before routing to the SDF primitive; misses\n`;
ts += `// fall through to the legacy <Graph.Path> renderer.\n\n`;
ts += `export const BAKED_ICON_NAMES: ReadonlySet<string> = new Set([\n`;
for (const m of meta) ts += `  "${m.name}",\n`;
ts += `]);\n`;
if (!__writeFile(OUT_TS, ts)) die('failed to write ' + OUT_TS);
log(`wrote ${OUT_TS}`);

log(`done.`);
__exit(0);
