// editors/paint/surfaces.ts — the painter's visual surface system, headless:
// the built-in animated WGSL surface catalog, the texture-mode and cells-mode
// shader builders, the storage-buffer packing, and the custom-surface
// registry ops. Everything is strings + numbers — no React, no GPU — so the
// whole system meaning-tests under tools/v8cli. The PaintQuad component in
// PaintSurface.tsx is a thin <Effect> wrapper over these.
//
// A mask becomes a visible animated/materialized region without changing the
// underlying mask data — the major reusable concept the cutout audit called
// out. Texture mode samples a layer's two paintables and composes the SAME
// override-band rule as layers.ts effectiveMask; cells mode packs a coarse
// cell set into the storage buffer (the per-keep smart layers + doc preview
// path).
//
// WGSL gotchas honored throughout (memory: feedback_wgsl_no_unary_plus):
// no unary plus, no backticks inside shader comments.
//
// Behavior reference: cart/cutout/components/MaskQuad.tsx + domain.ts (read,
// never imported).

import { PAINT_TUNING } from './tuning';

export type MaskSurface = 'rainbow' | 'plasma' | 'voronoi' | 'fbm' | 'solid' | 'edges';
export type SurfaceId = MaskSurface | string;
export type PaintBlendMode = 'normal' | 'add' | 'multiply' | 'screen';
export type CustomSurface = { id: string; label: string; shader: string };

const SURFACE_LABEL: Record<MaskSurface, string> = {
  rainbow: 'Rainbow',
  plasma:  'Plasma',
  voronoi: 'Voronoi',
  fbm:     'FBM',
  solid:   'Solid',
  edges:   'Edges',
};

export const MASK_SURFACES: MaskSurface[] = ['rainbow', 'plasma', 'voronoi', 'fbm', 'solid', 'edges'];
export const PAINT_BLEND_MODES: PaintBlendMode[] = ['normal', 'add', 'multiply', 'screen'];
export function maskSurfaceLabel(m: MaskSurface): string { return SURFACE_LABEL[m]; }
export function isBuiltinSurface(m: SurfaceId): m is MaskSurface {
  return (MASK_SURFACES as string[]).includes(m);
}

// ── Color slots ───────────────────────────────────────────────────────────────
// Every surface exposes the same fixed slots. Built-ins multiply their final
// color by slot[0] (interior) / slot[1] (edges) so white = identity tint.

export const NUM_COLOR_SLOTS = 2;
export const SLOT_LABELS: string[] = ['Primary', 'Secondary'];
export const SLOT_DEFAULTS: string[] = Array.from({ length: NUM_COLOR_SLOTS }, () => '#ffffff');

export function hexToRgb01(hex: string): [number, number, number] {
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

export function blendModeIndex(mode: PaintBlendMode): number {
  switch (mode) {
    case 'add': return 1;
    case 'multiply': return 2;
    case 'screen': return 3;
    default: return 0;
  }
}

// ── Shared shader scaffolding ─────────────────────────────────────────────────
// The framework auto-prepends Uniforms/VsOut/vs_main + the effect_math.wgsl
// library (snoise, fbm, voronoi, hsv2rgb, hsl2rgb); surfaces declare only
// their own bindings + fs_main.

const CELLS_PRELUDE = `
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

// Color slots — packed after the mask flags: header [0..8] + mask
// [8..8+w*h] + colors [8+w*h..]. Default (1,1,1) is identity tint.
fn slotColor(slot: u32, igw: u32, igh: u32) -> vec3f {
  let off = 8u + igw * igh + slot * 3u;
  return vec3f(data[off], data[off + 1u], data[off + 2u]);
}

fn applyBlendPreview(color: vec3f, mode: f32) -> vec3f {
  if (mode < 0.5) { return color; }
  if (mode < 1.5) { return min(color + vec3f(0.35), vec3f(1.0)); }
  if (mode < 2.5) { return color * vec3f(0.55); }
  return vec3f(1.0) - (vec3f(1.0) - color) * vec3f(0.45);
}

// 6-stop rainbow LUT.
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

// Per-surface bodies: each computes vec3f `color` for an in-mask pixel from
// (cx_f, cy_f, gw, gh, t, hue_off). The caller applies alpha + edges.
const SHADER_BODY: Record<MaskSurface, string> = {
  rainbow: `
    let pos_hue = (cx_f + cy_f) / (gw + gh);
    let color = rainbow(pos_hue + t * 0.15 + hue_off);
  `,
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
  voronoi: `
    let v = voronoi(cx_f * 0.08 + t * 0.3, cy_f * 0.08 - t * 0.2);
    let color = hsv2rgb(fract(v.x * 0.5 + hue_off), 0.85, mix(0.4, 1.0, v.x));
  `,
  fbm: `
    let n = fbm(cx_f * 0.06 + t * 0.4, cy_f * 0.06 - t * 0.3, 4.0);
    let color = hsv2rgb(fract(n * 0.5 + hue_off + t * 0.05), 0.7, 0.7 + 0.3 * n);
  `,
  solid: `
    let color = vec3f(1.0, 1.0, 1.0);
  `,
  edges: `
    let color = hsv2rgb(fract(hue_off + t * 0.2), 1.0, 1.0);
  `,
};

// solid is THE NORMAL PAINT BRUSH (the user: "i cant paint a normal color.
// it just paints the effect"): a white body, so the final tint-by-slot-0
// makes the painted pixels EXACTLY the picked color — static, no time, no
// hue cycle. The other modes are the effects gallery.
// solid skips the alpha pulse; edges paints ONLY the silhouette contour.
const SURFACE_FLAGS: Record<MaskSurface, { pulse: boolean; interiorAlpha: number; edgeAlpha: number }> = {
  rainbow: { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  plasma:  { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  voronoi: { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  fbm:     { pulse: true,  interiorAlpha: 1.0, edgeAlpha: 1.0 },
  solid:   { pulse: false, interiorAlpha: 1.0, edgeAlpha: 1.0 },
  edges:   { pulse: true,  interiorAlpha: 0.0, edgeAlpha: 1.0 },
};

export function buildCellShader(mode: MaskSurface): string {
  const f = SURFACE_FLAGS[mode];
  const pulseExpr = f.pulse
    ? `0.55 + 0.45 * (0.5 + 0.5 * sin(U.time * 2.4 + phase_off))`
    : `1.0`;
  return `${CELLS_PRELUDE}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let gw = data[0];
  let gh = data[1];
  let dim = data[2];
  let hue_off = data[3];
  let phase_off = data[4];
  let blend_mode = data[6];

  let igw = u32(gw);
  let igh = u32(gh);
  let total = 8u + igw * igh;

  let cx_f = in.uv.x * gw;
  let cy_f = in.uv.y * gh;
  let cx = u32(clamp(floor(cx_f), 0.0, gw - 1.0));
  let cy = u32(clamp(floor(cy_f), 0.0, gh - 1.0));

  // mask_flag named distinctly so per-mode bodies can introduce their own
  // v without WGSL shadowing errors.
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
    // Marching ants: white-hot dashes sweep the perimeter.
    let ant = 0.5 + 0.5 * sin((cx_f - cy_f) * 0.5 - U.time * 6.0 + phase_off);
    a = mix(a, edge_a, ant * 0.7);
    out_color = mix(color, vec3f(1.0), 0.55);
  }
  // Interior pulls slot 0, edges slot 1 — body and silhouette tint
  // independently; white defaults are identity.
  let _tint = select(slotColor(0u, igw, igh), slotColor(1u, igw, igh), on_edge);
  out_color = out_color * _tint;
  out_color = applyBlendPreview(out_color, blend_mode);
  return vec4f(out_color * a, a);
}`;
}

// ── Texture-mode builder ──────────────────────────────────────────────────────
// Samples a layer's base mask texture at binding(2) and its brush-override
// texture at binding(4), composing the SAME band rule as layers.ts
// effectiveMask. Layers with no override bind the framework dummy (reads 0
// — always "untouched"), so a base-only layer renders exactly the base.

const TEXTURE_PRELUDE = `
// Storage buffer at binding(1) carries the per-Effect data (header floats +
// color slots) — the textures-enabled bind-group layout includes it too.
@group(0) @binding(1) var<storage, read> data: array<f32>;
@group(0) @binding(2) var mask_tex: texture_2d<f32>;
@group(0) @binding(3) var mask_samp: sampler;
@group(0) @binding(4) var override_tex: texture_2d<f32>;
@group(0) @binding(5) var override_samp: sampler;

// Texture-mode slot layout: header [0..8] + colors [8..8+slots*3]; no
// per-cell storage (the mask is the texture).
fn slotColor(slot: u32) -> vec3f {
  let off = 8u + slot * 3u;
  return vec3f(data[off], data[off + 1u], data[off + 2u]);
}

fn applyBlendPreview(color: vec3f, mode: f32) -> vec3f {
  if (mode < 0.5) { return color; }
  if (mode < 1.5) { return min(color + vec3f(0.35), vec3f(1.0)); }
  if (mode < 2.5) { return color * vec3f(0.55); }
  return vec3f(1.0) - (vec3f(1.0) - color) * vec3f(0.45);
}

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

// 4-neighbor edge probe stepping 1/textureDim so the probe lands on
// adjacent texels regardless of mask resolution.
fn isMaskEdgeTex(uv: vec2f) -> bool {
  let dims = textureDimensions(mask_tex);
  let dx = 1.0 / f32(dims.x);
  let dy = 1.0 / f32(dims.y);
  let vl = textureSampleLevel(mask_tex, mask_samp, uv + vec2f(-dx, 0.0), 0.0).r;
  let vr = textureSampleLevel(mask_tex, mask_samp, uv + vec2f(dx, 0.0), 0.0).r;
  let vu = textureSampleLevel(mask_tex, mask_samp, uv + vec2f(0.0, -dy), 0.0).r;
  let vd = textureSampleLevel(mask_tex, mask_samp, uv + vec2f(0.0, dy), 0.0).r;
  return (vl < 0.5 || vr < 0.5 || vu < 0.5 || vd < 0.5);
}
`;

export function buildTextureShader(mode: MaskSurface): string {
  const f = SURFACE_FLAGS[mode];
  const pulseExpr = f.pulse
    ? `0.55 + 0.45 * (0.5 + 0.5 * sin(U.time * 2.4 + phase_off))`
    : `1.0`;
  return `${TEXTURE_PRELUDE}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let gw = data[0];
  let gh = data[1];
  let dim = data[2];
  let hue_off = data[3];
  let phase_off = data[4];
  let blend_mode = data[6];

  // Compose the effective mask from base + override. Bands: over 0.75
  // force-remove, 0.25..0.75 force-keep, else defer to base — the
  // normalized form of layers.ts effectiveMask byte cuts (192/64/128).
  let base_v = textureSampleLevel(mask_tex, mask_samp, in.uv, 0.0).r;
  let ov = textureSampleLevel(override_tex, override_samp, in.uv, 0.0).r;
  var mask_v = base_v;
  if (ov > 0.75) { mask_v = 1.0; } else if (ov > 0.25) { mask_v = 0.0; }
  if (mask_v < 0.5) { return vec4f(0.0); }

  // Logical grid coords for the color body come from the header buffer, not
  // textureDimensions — same animation axis as cells mode, visuals match.
  let cx_f = in.uv.x * gw;
  let cy_f = in.uv.y * gh;

  // mask_flag stays for parity with the cells-mode bodies.
  let mask_flag = mask_v;

  let t = U.time;
${SHADER_BODY[mode]}

  let pulse = ${pulseExpr};
  let on_edge = isMaskEdgeTex(in.uv);
  let interior_a = ${f.interiorAlpha.toFixed(3)};
  let edge_a = ${f.edgeAlpha.toFixed(3)};

  var a = dim * pulse * select(interior_a, edge_a, on_edge);
  if (a < 0.005) { return vec4f(0.0); }
  var out_color = color;
  if (on_edge) {
    let ant = 0.5 + 0.5 * sin((cx_f - cy_f) * 0.5 - U.time * 6.0 + phase_off);
    a = mix(a, edge_a, ant * 0.7);
    out_color = mix(color, vec3f(1.0), 0.55);
  }
  let _tint = select(slotColor(0u), slotColor(1u), on_edge);
  out_color = out_color * _tint;
  out_color = applyBlendPreview(out_color, blend_mode);
  return vec4f(out_color * a, a);
}`;
}

// Shader strings cached per mode — a rebuilt WGSL string re-hashes at the
// Effect host and tears down + rebuilds the GPU pipeline. Hash once.
export const CELL_SHADER_CACHE: Record<MaskSurface, string> = {
  rainbow: buildCellShader('rainbow'),
  plasma:  buildCellShader('plasma'),
  voronoi: buildCellShader('voronoi'),
  fbm:     buildCellShader('fbm'),
  solid:   buildCellShader('solid'),
  edges:   buildCellShader('edges'),
};

export const TEXTURE_SHADER_CACHE: Record<MaskSurface, string> = {
  rainbow: buildTextureShader('rainbow'),
  plasma:  buildTextureShader('plasma'),
  voronoi: buildTextureShader('voronoi'),
  fbm:     buildTextureShader('fbm'),
  solid:   buildTextureShader('solid'),
  edges:   buildTextureShader('edges'),
};

/** Pick the WGSL for a surface id: built-in cache hit, else the custom
 *  gallery shader, else the rainbow fallback. */
export function resolveShader(
  id: SurfaceId, textureMode: boolean, customs: CustomSurface[],
): string {
  const cache = textureMode ? TEXTURE_SHADER_CACHE : CELL_SHADER_CACHE;
  if (isBuiltinSurface(id)) return cache[id];
  return customs.find((c) => c.id === id)?.shader ?? cache.rainbow;
}

// ── Storage-buffer packing ────────────────────────────────────────────────────

export type PackLookOpts = {
  gridSize: number;
  dim: number;
  hueOffset: number;
  phaseOffset: number;
  blend: PaintBlendMode;
  colors?: string[];
};

function packHeader(buf: number[], o: PackLookOpts): void {
  buf[0] = o.gridSize;
  buf[1] = o.gridSize;
  buf[2] = o.dim;
  buf[3] = o.hueOffset;
  buf[4] = o.phaseOffset;
  buf[5] = NUM_COLOR_SLOTS;
  buf[6] = blendModeIndex(o.blend);
  buf[7] = 0;
}

function packColors(buf: number[], offset: number, colors?: string[]): void {
  for (let i = 0; i < NUM_COLOR_SLOTS; i++) {
    const hex = (colors && colors[i]) || SLOT_DEFAULTS[i] || '#ffffff';
    const [r, g, b] = hexToRgb01(hex);
    buf[offset + i * 3 + 0] = r;
    buf[offset + i * 3 + 1] = g;
    buf[offset + i * 3 + 2] = b;
  }
}

/** Texture-mode data buffer: header(8) + color slots. */
export function packTextureModeData(o: PackLookOpts): number[] {
  const buf = new Array<number>(8 + NUM_COLOR_SLOTS * 3);
  packHeader(buf, o);
  packColors(buf, 8, o.colors);
  return buf;
}

/** Cells-mode data buffer: header(8) + gridSize² mask flags + color slots. */
export function packCellModeData(o: PackLookOpts, cells: Set<number> | undefined): number[] {
  const total = o.gridSize * o.gridSize;
  const buf = new Array<number>(8 + total + NUM_COLOR_SLOTS * 3);
  packHeader(buf, o);
  for (let i = 0; i < total; i++) buf[8 + i] = 0;
  if (cells) {
    for (const idx of cells) {
      if (idx >= 0 && idx < total) buf[8 + idx] = 1;
    }
  }
  packColors(buf, 8 + total, o.colors);
  return buf;
}

// ── Custom surface registry ops ───────────────────────────────────────────────

export function mintCustomSurfaceId(): string {
  return `custom:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
}

/** Register a custom WGSL surface; returns the grown gallery + the new id. */
export function addCustomSurface(
  customs: CustomSurface[], label: string, shader: string,
): { customs: CustomSurface[]; id: string } {
  const id = mintCustomSurfaceId();
  const cleanLabel = label.trim() || `Custom ${customs.length + 1}`;
  return { customs: [...customs, { id, label: cleanLabel, shader }], id };
}

// Self-contained surface (WGSL inlined) for portable documents — the
// SurfaceId + gallery side-table is the editable form, this is the export
// form. inflate/adopt are the canonical conversions.
export type Surface =
  | { kind: 'builtin'; name: MaskSurface }
  | { kind: 'custom'; id: string; label: string; wgsl: string };

export function inflateSurface(id: SurfaceId, customs: CustomSurface[]): Surface {
  if (isBuiltinSurface(id)) return { kind: 'builtin', name: id };
  const cs = customs.find((c) => c.id === id);
  if (!cs) return { kind: 'builtin', name: PAINT_TUNING.layerLook.defaultSurface as MaskSurface };
  return { kind: 'custom', id: cs.id, label: cs.label, wgsl: cs.shader };
}

/** Inverse of inflateSurface: register an imported self-contained surface
 *  (if custom and unknown) and return the SurfaceId to reference. */
export function adoptSurface(
  s: Surface, customs: CustomSurface[],
): { id: SurfaceId; addedCustom: CustomSurface | null } {
  if (s.kind === 'builtin') return { id: s.name, addedCustom: null };
  const existing = customs.find((c) => c.id === s.id);
  if (existing) return { id: existing.id, addedCustom: null };
  return { id: s.id, addedCustom: { id: s.id, label: s.label, shader: s.wgsl } };
}
