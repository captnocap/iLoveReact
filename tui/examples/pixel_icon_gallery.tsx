// pixel_icon_gallery (TUI) — same idea as cart/pixel_icon_gallery.tsx,
// but in the terminal. Walks cart/pixel_icons/*.64*.json at startup and
// renders each one through a single WGSL shader via <Effect>.
//
// Each terminal cell is split top/bottom with ▀, so a 32-cell wide × 16-cell
// tall Effect samples 32×32 uv positions. With nearest-neighbor sampling that
// undersamples a 64² source badly at small sizes — the cell picks one of ~8
// candidate pixels and the rest are dropped. Toggle "filter" on to box-
// average every source pixel covered by a cell instead; small sizes get a
// soft photographic shrink, large sizes are unchanged (one source pixel per
// sample, no neighbors to average).
//
// Run from the repo root so `cart/pixel_icons` resolves:
//   ./scripts/ship-tui tui/examples/pixel_icon_gallery.tsx
//   ./zig-out/bin/pixel_icon_gallery

import * as React from 'react';
import { Box, Row, Col, Text, ScrollView, Pressable, Effect } from '../../runtime/primitives';

declare const __fs_read: (path: string) => string;
declare const __fs_list_json: (path: string) => string; // JSON string[]

const ICON_DIR = 'cart/pixel_icons';

const BG     = '#0b1018';
const INK    = '#e8eef8';
const DIM    = '#7f93b1';
const ACCENT = '#3da9ff';
const CARD   = '#11182a';

// ── shader ─────────────────────────────────────────────────────────────
// data layout:
//   [0] size              source pixel grid (e.g. 64)
//   [1] pal_count
//   [2] filter_mode       0 = nearest, 1 = box-average covered source pixels
//   [3] footprint_x       source pixels per fragment in x (= size / samplesX)
//   [4] footprint_y       source pixels per fragment in y (= size / samplesY)
//   [5 .. 5+pc*3]         palette RGB
//   [5+pc*3 ..]           per-cell palette index, -1 = null
//
// Why pass footprint instead of using fwidth: the TUI sampler in tui/wgsl.ts
// stubs fwidth to a constant (1e-3), so we can't derive per-fragment uv extent
// from derivatives. The cart host could use fwidth, but matching footprints
// exactly with what JS knows is simpler than two code paths.
const SHADER = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

fn sample_nearest(uv: vec2f, size: f32, isize: u32, p_offset: u32) -> vec4f {
  let cx = u32(clamp(floor(uv.x * size), 0.0, size - 1.0));
  let cy = u32(clamp(floor(uv.y * size), 0.0, size - 1.0));
  let raw = data[p_offset + cy * isize + cx];
  if (raw < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let base = 2u + u32(raw) * 3u + 3u; // +3 to skip the filter/footprint header extension
  return vec4f(data[base], data[base + 1u], data[base + 2u], 1.0);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let size = data[0];
  let pal_count = u32(data[1]);
  let filter_mode = data[2];
  let footprint_x = data[3];
  let footprint_y = data[4];
  let isize = u32(size);
  // Palette starts after the 5-float header.
  let pal_base_offset = 5u;
  let p_offset = pal_base_offset + pal_count * 3u;

  if (filter_mode < 0.5) {
    // Nearest-neighbor (original behavior).
    let cx = u32(clamp(floor(in.uv.x * size), 0.0, size - 1.0));
    let cy = u32(clamp(floor(in.uv.y * size), 0.0, size - 1.0));
    let raw = data[p_offset + cy * isize + cx];
    if (raw < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
    let base = pal_base_offset + u32(raw) * 3u;
    return vec4f(data[base], data[base + 1u], data[base + 2u], 1.0);
  }

  // Box filter: average every source pixel whose center falls inside this
  // fragment's uv footprint. Clamped to a hard ceiling so we don't blow the
  // sampler walking a tiny icon onto a giant terminal — 8×8 = 64 taps is
  // plenty for any reasonable shrink (64² source into 8² cells = 8×8).
  let cx_center = in.uv.x * size;
  let cy_center = in.uv.y * size;
  let half_x = max(footprint_x * 0.5, 0.5);
  let half_y = max(footprint_y * 0.5, 0.5);
  let x_min_f = floor(cx_center - half_x);
  let x_max_f = floor(cx_center + half_x);
  let y_min_f = floor(cy_center - half_y);
  let y_max_f = floor(cy_center + half_y);
  let span_x = min(x_max_f - x_min_f, 7.0);
  let span_y = min(y_max_f - y_min_f, 7.0);

  var rsum = 0.0;
  var gsum = 0.0;
  var bsum = 0.0;
  var asum = 0.0;
  var count = 0.0;

  for (var dy = 0.0; dy <= span_y; dy = dy + 1.0) {
    let yi = y_min_f + dy;
    if (yi < 0.0 || yi >= size) { continue; }
    let yu = u32(yi);
    for (var dx = 0.0; dx <= span_x; dx = dx + 1.0) {
      let xi = x_min_f + dx;
      if (xi < 0.0 || xi >= size) { continue; }
      let xu = u32(xi);
      count = count + 1.0;
      let raw = data[p_offset + yu * isize + xu];
      if (raw < 0.0) { continue; }
      let base = pal_base_offset + u32(raw) * 3u;
      rsum = rsum + data[base];
      gsum = gsum + data[base + 1u];
      bsum = bsum + data[base + 2u];
      asum = asum + 1.0;
    }
  }

  if (count <= 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let inv = 1.0 / count;
  let a = asum * inv;
  if (a <= 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let cinv = 1.0 / asum;
  return vec4f(rsum * cinv, gsum * cinv, bsum * cinv, a);
}
`;

// ── disk format → flat pixels ──────────────────────────────────────────
type EncodedRunEntry = number | null | [number, number | null];
type EncodedMatrix = { size: number; palette: string[]; rows: EncodedRunEntry[][] };
type EncodedAnim   = { size: number; palette: string[]; fps: number; frames: Array<{ rows: EncodedRunEntry[][] }> };

type PixelMatrix = { size: number; palette: string[]; pixels: Array<number | null> };
type AnimIconLike = { size: number; palette: string[]; fps: number; frames: Array<{ pixels: Array<number | null> }> };

function decodeMatrix(obj: EncodedMatrix): PixelMatrix {
  const { size, palette, rows } = obj;
  const pixels: Array<number | null> = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    let x = 0;
    const row = rows[y] || [];
    for (const entry of row) {
      if (Array.isArray(entry)) {
        const [count, v] = entry;
        for (let i = 0; i < count; i++) pixels[y * size + x++] = v;
      } else {
        pixels[y * size + x++] = entry;
      }
    }
  }
  return { size, palette, pixels };
}

type StaticIcon = { kind: 'static'; stem: string; matrix: PixelMatrix };
type AnimIcon   = { kind: 'anim'; stem: string; data: AnimIconLike };
type Loaded = StaticIcon | AnimIcon;

function stemOf(filename: string): string {
  return filename.replace(/\.64(\.anim)?\.json$/, '');
}

function loadIcons(): { items: Loaded[]; errors: string[] } {
  const errors: string[] = [];
  const items: Loaded[] = [];
  let names: string[] = [];
  try { names = JSON.parse(__fs_list_json(ICON_DIR)) as string[]; } catch { names = []; }
  const sorted = names.filter((fn) => /\.64(\.anim)?\.json$/.test(fn)).sort();
  for (const fn of sorted) {
    const path = `${ICON_DIR}/${fn}`;
    let txt = '';
    try { txt = __fs_read(path); } catch { errors.push(`read ${path}`); continue; }
    if (!txt) { errors.push(`empty ${path}`); continue; }
    try {
      const obj = JSON.parse(txt);
      if (Array.isArray(obj.frames)) {
        const a = obj as EncodedAnim;
        const frames = a.frames.map((f) =>
          decodeMatrix({ size: a.size, palette: a.palette, rows: f.rows }),
        );
        items.push({
          kind: 'anim',
          stem: stemOf(fn),
          data: {
            size: a.size,
            palette: a.palette,
            fps: a.fps || 12,
            frames: frames.map((m) => ({ pixels: m.pixels })),
          },
        });
      } else {
        items.push({ kind: 'static', stem: stemOf(fn), matrix: decodeMatrix(obj) });
      }
    } catch (e: any) {
      errors.push(`parse ${fn}: ${e?.message ?? e}`);
    }
  }
  return { items, errors };
}

// ── pack PixelMatrix → storage buffer ──────────────────────────────────
const HEADER_LEN = 5;

function paletteToFloats(palette: string[]): number[] {
  const out = new Array<number>(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i];
    out[i * 3 + 0] = parseInt(hex.slice(1, 3), 16) / 255;
    out[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
    out[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
  }
  return out;
}

// Footprint = source pixels per fragment in each axis. Half-block doubles
// vertical resolution, so samplesY = cellH * 2.
function footprintFor(size: number, cellW: number, cellH: number): { fx: number; fy: number } {
  const samplesX = Math.max(1, cellW);
  const samplesY = Math.max(1, cellH * 2);
  return { fx: size / samplesX, fy: size / samplesY };
}

function packMatrix(m: PixelMatrix, filter: 0 | 1, fx: number, fy: number): number[] {
  const palFloats = paletteToFloats(m.palette);
  const out = new Array<number>(HEADER_LEN + palFloats.length + m.pixels.length);
  out[0] = m.size;
  out[1] = m.palette.length;
  out[2] = filter;
  out[3] = fx;
  out[4] = fy;
  for (let i = 0; i < palFloats.length; i++) out[HEADER_LEN + i] = palFloats[i];
  const off = HEADER_LEN + palFloats.length;
  for (let i = 0; i < m.pixels.length; i++) {
    const p = m.pixels[i];
    out[off + i] = p == null ? -1 : p;
  }
  return out;
}

// ── tile components ────────────────────────────────────────────────────

function StaticTile({ icon, cellW, filter }: { icon: StaticIcon; cellW: number; filter: 0 | 1 }) {
  const cellH = Math.max(1, Math.floor(cellW / 2));
  const packed = React.useMemo(() => {
    const { fx, fy } = footprintFor(icon.matrix.size, cellW, cellH);
    return packMatrix(icon.matrix, filter, fx, fy);
  }, [icon, cellW, cellH, filter]);
  return <Effect shader={SHADER} data={packed} style={{ width: cellW, height: cellH }} />;
}

function AnimTile({ icon, cellW, filter }: { icon: AnimIcon; cellW: number; filter: 0 | 1 }) {
  const [idx, setIdx] = React.useState(0);
  const d = icon.data;
  React.useEffect(() => {
    if (d.frames.length <= 1) return;
    const h = setInterval(() => {
      setIdx((i) => (i + 1) % d.frames.length);
    }, Math.max(33, Math.floor(1000 / d.fps)));
    return () => clearInterval(h);
  }, [d]);

  const cellH = Math.max(1, Math.floor(cellW / 2));

  const header = React.useMemo(() => {
    const { fx, fy } = footprintFor(d.size, cellW, cellH);
    const palFloats = paletteToFloats(d.palette);
    const h = new Array<number>(HEADER_LEN + palFloats.length);
    h[0] = d.size;
    h[1] = d.palette.length;
    h[2] = filter;
    h[3] = fx;
    h[4] = fy;
    for (let i = 0; i < palFloats.length; i++) h[HEADER_LEN + i] = palFloats[i];
    return h;
  }, [d, cellW, cellH, filter]);

  const packed = React.useMemo(() => {
    const frame = d.frames[idx] ?? d.frames[0];
    const out = new Array<number>(header.length + frame.pixels.length);
    for (let i = 0; i < header.length; i++) out[i] = header[i];
    const off = header.length;
    for (let i = 0; i < frame.pixels.length; i++) {
      const p = frame.pixels[i];
      out[off + i] = p == null ? -1 : p;
    }
    return out;
  }, [header, idx, d.frames]);

  return <Effect shader={SHADER} data={packed} style={{ width: cellW, height: cellH }} />;
}

// ── app ────────────────────────────────────────────────────────────────
const SIZES = [16, 24, 32, 48] as const;

export default function PixelIconGalleryTui() {
  const [cellW, setCellW] = React.useState<number>(24);
  const [filter, setFilter] = React.useState<0 | 1>(1);
  const [reloadKey, setReloadKey] = React.useState(0);
  const loaded = React.useMemo(() => loadIcons(), [reloadKey]);
  const { items, errors } = loaded;
  const animCount = items.filter((i) => i.kind === 'anim').length;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG, flexDirection: 'column' }}>
      <Row style={{ paddingLeft: 1, paddingRight: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: ACCENT, fontWeight: 'bold' }}>tui pixel-icon gallery</Text>
        <Text style={{ color: DIM }}>· {ICON_DIR} · {items.length} icon{items.length === 1 ? '' : 's'} ({animCount} animated)</Text>
      </Row>

      <Row style={{ paddingLeft: 1, paddingRight: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: DIM }}>cells wide:</Text>
        {SIZES.map((s) => (
          <Pressable key={s} onPress={() => setCellW(s)}>
            <Box style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: cellW === s ? ACCENT : CARD }}>
              <Text style={{ color: cellW === s ? '#0b1018' : INK, fontWeight: 'bold' }}>{s}</Text>
            </Box>
          </Pressable>
        ))}
        <Box style={{ width: 2 }} />
        <Text style={{ color: DIM }}>filter:</Text>
        {([['nearest', 0], ['box', 1]] as const).map(([label, val]) => (
          <Pressable key={label} onPress={() => setFilter(val)}>
            <Box style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: filter === val ? ACCENT : CARD }}>
              <Text style={{ color: filter === val ? '#0b1018' : INK, fontWeight: 'bold' }}>{label}</Text>
            </Box>
          </Pressable>
        ))}
        <Pressable onPress={() => setReloadKey((k) => k + 1)}>
          <Box style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: CARD }}>
            <Text style={{ color: INK }}>reload</Text>
          </Box>
        </Pressable>
      </Row>

      {errors.length > 0 ? (
        <Col style={{ paddingLeft: 1, paddingRight: 1 }}>
          {errors.slice(0, 5).map((e, i) => (
            <Text key={i} style={{ color: '#ff8080' }}>{e}</Text>
          ))}
        </Col>
      ) : null}

      <ScrollView style={{ flexGrow: 1, flexShrink: 1, paddingLeft: 1, paddingRight: 1 }}>
        <Row style={{ gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {items.map((it) => (
            <Col key={it.stem + (it.kind === 'anim' ? '.anim' : '')} style={{ alignItems: 'center' }}>
              <Box style={{ backgroundColor: CARD }}>
                {it.kind === 'static'
                  ? <StaticTile icon={it} cellW={cellW} filter={filter} />
                  : <AnimTile   icon={it} cellW={cellW} filter={filter} />}
              </Box>
              <Text style={{ color: INK, fontWeight: 'bold' }}>{it.stem}</Text>
              <Text style={{ color: DIM }}>
                {it.kind === 'anim' ? `${it.data.frames.length}f @ ${it.data.fps}fps` : 'static'}
              </Text>
            </Col>
          ))}
        </Row>
        {items.length === 0 ? (
          <Text style={{ color: DIM }}>
            No icons found. Run cart/pixel_icon_demo first, or launch from the repo root.
          </Text>
        ) : null}
      </ScrollView>
    </Box>
  );
}
