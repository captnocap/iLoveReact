// MaskQuad — single Effect-shader quad that renders the cutout mask as a
// live, GPU-rasterized layer. Replaces the DOM-box MaskOverlay's per-cell
// rectangles with one draw call.
//
// Surface modes: each mode is its own fragment shader composed against the
// mask flag (in-selection cells get the effect, others stay transparent).
// Toggleable from the Inspector — switch the visual identity without
// changing the underlying mask data.
//
// Data layout (f32 storage buffer):
//   [0]              grid_size_w   (e.g. 128.0)
//   [1]              grid_size_h
//   [2]              dim_alpha     (overlay opacity 0..1)
//   [3]              hue_offset    (per-layer hue rotation, 0..1)
//   [4]              phase_offset  (per-layer animation phase shift in seconds)
//   [5]              reserved
//   [6]              reserved
//   [7]              reserved
//   [8 .. 8+w*h]     mask flags (0 = keep, 1 = in-selection).
//
// The framework auto-prepends:
//   struct Uniforms { size_w, size_h, time, dt, frame, mouse_x, mouse_y, mouse_inside }
//   @group(0) @binding(0) var<uniform> U: Uniforms;
//   struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
//   @vertex fn vs_main(...) -> VsOut { ... }
//   + the effect_math.wgsl library (snoise, fbm, voronoi, hsv2rgb, hsl2rgb).
// So we only declare binding(1) (our storage buffer) and `fs_main`.

import { useMemo } from 'react';
import { Effect } from '@reactjit/runtime/primitives';

export type MaskSurface = 'rainbow' | 'plasma' | 'voronoi' | 'fbm' | 'solid' | 'edges';
export type SurfaceId = MaskSurface | string;
export interface CustomSurface {
  id: string;
  label: string;
  shader: string;
}

const SURFACE_LABEL: Record<MaskSurface, string> = {
  rainbow: 'Rainbow',
  plasma:  'Plasma',
  voronoi: 'Voronoi',
  fbm:     'FBM',
  solid:   'Solid',
  edges:   'Edges',
};

export const MASK_SURFACES: MaskSurface[] = ['rainbow', 'plasma', 'voronoi', 'fbm', 'solid', 'edges'];
export function maskSurfaceLabel(m: MaskSurface): string { return SURFACE_LABEL[m]; }
export function isBuiltinSurface(m: SurfaceId): m is MaskSurface {
  return (MASK_SURFACES as string[]).includes(m);
}

// ── Color slots ────────────────────────────────────────────────────────
// Every surface (built-in + custom) exposes the same fixed number of color
// slots in its data buffer. Built-in shaders multiply their final per-pixel
// color by slot[0] so the existing hue-cycle/plasma/voronoi animations stay
// intact and slot[0] acts as a tint — default `#ffffff` is identity, so old
// layers look the same as before. Custom shaders can read both slots
// directly out of the data buffer (the comment at the top of CUSTOM_EFFECT_
// TEMPLATE points at the right offsets).
export const NUM_COLOR_SLOTS = 2;

export const SLOT_LABELS: string[] = ['Primary', 'Secondary'];

/** Sentinel "no tint" color. Layer configs start at this for every slot so
 *  a freshly-created layer matches the legacy visual exactly. The Tools
 *  palette swaps these out when the user picks a swatch. */
export const SLOT_DEFAULTS: string[] = Array.from({ length: NUM_COLOR_SLOTS }, () => '#ffffff');

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length !== 6) return [1, 1, 1];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 1,
    Number.isFinite(b) ? b : 1,
  ];
}

// ── Shared shader scaffolding ─────────────────────────────────────────
// All modes share the same skeleton:
//   1. Read header (gw, gh, dim, hue_offset, phase_offset).
//   2. Sample the mask flag at the current uv → cell.
//   3. If outside: discard (return alpha=0).
//   4. If inside: compute the mode-specific color, then optionally check
//      neighbors for an edge highlight.
// Only the body inside step 4 differs between modes.

const COMMON_PRELUDE = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

fn sampleCell(cx: u32, cy: u32, igw: u32, total: u32) -> f32 {
  let idx = 8u + cy * igw + cx;
  if (idx >= total) { return 0.0; }
  return data[idx];
}

fn isEdge(cx: u32, cy: u32, igw: u32, igh: u32, total: u32) -> bool {
  let cx_l = select(cx - 1u, cx, cx == 0u);
  let cx_r = select(cx + 1u, cx, cx >= igw - 1u);
  let cy_u = select(cy - 1u, cy, cy == 0u);
  let cy_d = select(cy + 1u, cy, cy >= igh - 1u);
  let vl = sampleCell(cx_l, cy, igw, total);
  let vr = sampleCell(cx_r, cy, igw, total);
  let vu = sampleCell(cx, cy_u, igw, total);
  let vd = sampleCell(cx, cy_d, igw, total);
  return (vl < 0.5 || vr < 0.5 || vu < 0.5 || vd < 0.5);
}

// Color slots — packed after the mask flags. Layout:
//   header [0..8] + mask [8..8+w*h] + colors [8+w*h..8+w*h+NUM_SLOTS*3]
// Default slot color is (1,1,1) which acts as identity tint, so existing
// surfaces look the same when the user hasn't picked anything.
fn slotColor(slot: u32, igw: u32, igh: u32) -> vec3f {
  let off = 8u + igw * igh + slot * 3u;
  return vec3f(data[off], data[off + 1u], data[off + 2u]);
}

// 6-stop rainbow LUT — branchless-ish, used by the rainbow mode.
fn rainbow(t: f32) -> vec3f {
  let s = fract(t);
  let h = s * 6.0;
  let i = floor(h);
  let f = h - i;
  if (i < 1.0) { return vec3f(1.0, f, 0.0); }
  if (i < 2.0) { return vec3f(1.0 - f, 1.0, 0.0); }
  if (i < 3.0) { return vec3f(0.0, 1.0, f); }
  if (i < 4.0) { return vec3f(0.0, 1.0 - f, 1.0); }
  if (i < 5.0) { return vec3f(f, 0.0, 1.0); }
  return vec3f(1.0, 0.0, 1.0 - f);
}
`;

// ── Per-surface shader bodies ─────────────────────────────────────────
// Each returns a vec3f color (0..1) for an in-mask pixel. The caller
// applies alpha + edge highlight.

const SHADER_BODY: Record<MaskSurface, string> = {
  rainbow: `
    let pos_hue = (cx_f + cy_f) / (gw + gh);
    let color = rainbow(pos_hue + t * 0.15 + hue_off);
  `,
  // Port of cart/plasma.tsx — four-wave sine plasma, scaled to fit the mask.
  plasma: `
    let fx = cx_f * 0.05;
    let fy = cy_f * 0.05;
    let v1 = sin(fx + t);
    let v2 = sin(fy + t * 0.7);
    let v3 = sin(fx + fy + t * 0.5);
    let v4 = sin(sqrt(fx * fx + fy * fy) + t);
    let v = (v1 + v2 + v3 + v4) * 0.25 + 0.5;
    let color = hsv2rgb(fract(v + hue_off), 1.0, 1.0);
  `,
  // Cellular noise. Animates by moving the lookup grid through time.
  voronoi: `
    let v = voronoi(cx_f * 0.08 + t * 0.3, cy_f * 0.08 - t * 0.2);
    let color = hsv2rgb(fract(v.x * 0.5 + hue_off), 0.85, mix(0.4, 1.0, v.x));
  `,
  // Fractal Brownian Motion — silky animated noise.
  fbm: `
    let n = fbm(cx_f * 0.06 + t * 0.4, cy_f * 0.06 - t * 0.3, 4.0);
    let color = hsv2rgb(fract(n * 0.5 + hue_off + t * 0.05), 0.7, 0.7 + 0.3 * n);
  `,
  // Boring baseline — flat color with slow hue rotation. Useful for
  // visual A/B against the noisy modes.
  solid: `
    let color = hsv2rgb(fract(hue_off + t * 0.08), 0.7, 0.85);
  `,
  // Hollow / edges-only — interior is transparent, only the silhouette
  // contour glows. Lets you see the source image clearly with just a
  // highlighted outline.
  edges: `
    let color = hsv2rgb(fract(hue_off + t * 0.2), 1.0, 1.0);
  `,
};

// `solid` mode skips the alpha pulse to feel "static-ish"; other modes
// breathe. `edges` paints ONLY on edge cells.
const SURFACE_FLAGS: Record<MaskSurface, { pulse: boolean; interiorAlpha: number; edgeAlpha: number }> = {
  rainbow: { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  plasma:  { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  voronoi: { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  fbm:     { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  solid:   { pulse: false, interiorAlpha: 1.0, edgeAlpha: 1.0 },
  edges:   { pulse: true,  interiorAlpha: 0.0, edgeAlpha: 1.0 },
};

function buildShader(mode: MaskSurface): string {
  const f = SURFACE_FLAGS[mode];
  const pulseExpr = f.pulse
    ? `0.55 + 0.45 * (0.5 + 0.5 * sin(U.time * 2.4 + phase_off))`
    : `1.0`;
  return `${COMMON_PRELUDE}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let gw = data[0];
  let gh = data[1];
  let dim = data[2];
  let hue_off = data[3];
  let phase_off = data[4];

  let igw = u32(gw);
  let igh = u32(gh);
  let total = 8u + igw * igh;

  let cx_f = in.uv.x * gw;
  let cy_f = in.uv.y * gh;
  let cx = u32(clamp(floor(cx_f), 0.0, gw - 1.0));
  let cy = u32(clamp(floor(cy_f), 0.0, gh - 1.0));

  // mask_flag: 0 (outside selection) or 1 (inside). Named distinctly so
  // per-mode bodies (plasma + voronoi) can introduce their own 'v'
  // without WGSL shadowing errors.
  let mask_flag = sampleCell(cx, cy, igw, total);
  if (mask_flag < 0.5) { return vec4f(0.0); }

  let t = U.time;
${SHADER_BODY[mode]}

  let pulse = ${pulseExpr};
  let on_edge = isEdge(cx, cy, igw, igh, total);
  let interior_a = ${f.interiorAlpha.toFixed(3)};
  let edge_a = ${f.edgeAlpha.toFixed(3)};

  var a = dim * pulse * select(interior_a, edge_a, on_edge);
  if (a < 0.005) { return vec4f(0.0); }
  var out_color = color;
  if (on_edge) {
    // Marching-ants animation along the perimeter — bright white-hot dashes
    // sweep around the edge of every region.
    let ant = 0.5 + 0.5 * sin((cx_f - cy_f) * 0.5 - U.time * 6.0 + phase_off);
    a = mix(a, edge_a, ant * 0.7);
    out_color = mix(color, vec3f(1.0), 0.55);
  }
  // Tint by user-picked color slots. Defaults are white (1,1,1) so an
  // unconfigured layer renders exactly like before. Interior pulls slot[0],
  // edges pull slot[1] so the user can drive the body and the silhouette
  // independently.
  let _tint = select(slotColor(0u, igw, igh), slotColor(1u, igw, igh), on_edge);
  out_color = out_color * _tint;
  return vec4f(out_color * a, a);
}`;
}

// Cache shader strings per mode — rebuilding the WGSL on every render
// would trigger a pipeline recompile every frame, which the Effect host
// detects via the shader hash and tears down + rebuilds the GPU pipeline.
// Expensive. Static cache means each mode's WGSL is hashed once.
const SHADER_CACHE: Record<MaskSurface, string> = {
  rainbow: buildShader('rainbow'),
  plasma:  buildShader('plasma'),
  voronoi: buildShader('voronoi'),
  fbm:     buildShader('fbm'),
  solid:   buildShader('solid'),
  edges:   buildShader('edges'),
};

interface Props {
  /** Sampled mask grid as Set<index> where index = y*w + x in grid units. */
  cells: Set<number>;
  /** Grid resolution (square) — mask is downsampled to gridSize x gridSize. */
  gridSize: number;
  /** Rendered display dimensions in canvas world units. */
  worldW: number;
  worldH: number;
  /** Visual overlay alpha (0..1). */
  dim?: number;
  /** Visual surface mode (rainbow, plasma, voronoi, …). */
  mode?: SurfaceId;
  customShader?: string;
  /** Per-layer hue offset (0..1) — multiple layers each pick their own
   *  so they don't all cycle in unison. */
  hueOffset?: number;
  /** Per-layer phase offset (seconds) — desyncs the pulse / marching ants
   *  so each layer breathes on its own beat. */
  phaseOffset?: number;
  /** Per-layer color slots (#RRGGBB). Length should match NUM_COLOR_SLOTS;
   *  short / missing entries fall through to white (= identity tint, no
   *  visual change vs the legacy unconfigured layer). */
  colors?: string[];
}

export function MaskQuad({
  cells, gridSize, worldW, worldH,
  dim = 0.85, mode = 'rainbow',
  customShader, hueOffset = 0, phaseOffset = 0,
  colors,
}: Props) {
  // Pack the cell set into the f32 storage buffer. Header (8 floats) +
  // gridSize*gridSize flags + NUM_COLOR_SLOTS*3 color floats. Color slots
  // sit AFTER the mask so existing shaders that index `8u + y*igw + x` keep
  // working; new shaders read slots via slotColor(slot, igw, igh).
  const packed = useMemo(() => {
    const cells_total = gridSize * gridSize;
    const colors_total = NUM_COLOR_SLOTS * 3;
    const buf = new Array<number>(8 + cells_total + colors_total);
    buf[0] = gridSize;
    buf[1] = gridSize;
    buf[2] = dim;
    buf[3] = hueOffset;
    buf[4] = phaseOffset;
    buf[5] = NUM_COLOR_SLOTS;
    buf[6] = 0; buf[7] = 0;
    for (let i = 0; i < cells_total; i++) buf[8 + i] = 0;
    for (const idx of cells) {
      if (idx >= 0 && idx < cells_total) buf[8 + idx] = 1;
    }
    const colorOff = 8 + cells_total;
    for (let i = 0; i < NUM_COLOR_SLOTS; i++) {
      const hex = (colors && colors[i]) || SLOT_DEFAULTS[i] || '#ffffff';
      const [r, g, b] = hexToRgb01(hex);
      buf[colorOff + i * 3 + 0] = r;
      buf[colorOff + i * 3 + 1] = g;
      buf[colorOff + i * 3 + 2] = b;
    }
    return buf;
  }, [cells, gridSize, dim, hueOffset, phaseOffset, colors]);

  const shader = isBuiltinSurface(mode) ? SHADER_CACHE[mode] : customShader || SHADER_CACHE.rainbow;

  return (
    <Effect
      shader={shader}
      data={packed}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width: worldW,
        height: worldH,
      }}
    />
  );
}
