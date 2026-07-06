// shaders/surfaceCompose.ts — Part 2 of DESIGN_INTAKE.md "Surface modes": how
// a material meets geometry. Three modes, expressed as DATA over the existing
// materials — no new material shaders:
//
//   tile  (default) — each piece evaluates its base material fresh over its
//         own local 0..1 UV (today's behavior, unchanged).
//   span  — this piece is one cell of a (spanW x spanH) grid sharing one
//           continuous field; its UV is remapped to its (gx, gy) slice before
//           calling the SAME material fn, so the pattern reassembles into one
//           image across every piece in the group. Best for @kind 'gradient'
//           materials (see registry.ts) — see DESIGN_INTAKE.md's frequency
//           caveat: spanning a high-frequency 'surface' material just looks
//           sparse.
//   layer — a base material + N overlays, each folded on with one of 5 fixed
//           blend modes and a factor (const | gradientY | gradientX |
//           timePulse). The dual-tone system: base = what the place IS,
//           overlay = what light/mood does to it, blend = the physics,
//           factor = where/when.
//
// composeSurfaceShader() is the ONLY place that assembles a bespoke fs_main —
// it reuses FILL_FUNCS (helpers + every material fn) verbatim, so tile/span/
// layer never require touching materials/*.wgsl.
import { FILL_FUNCS } from './_generated/dispatch';
import { MATERIALS, type RegistryMaterial } from './_generated/registry';

export type SurfaceMode = 'tile' | 'span';
export type SurfaceBlend = 'over' | 'add' | 'multiply' | 'screen' | 'mask';
export type SurfaceFactorKind = 'const' | 'gradientY' | 'gradientX' | 'timePulse';

export type SurfaceFactor = { kind: SurfaceFactorKind; value: number };

export type SpanGroup = {
  /** stable id shared by every piece in the group — grouping key, not read by the shader */
  id: string;
  gx: number;
  gy: number;
  w: number;
  h: number;
};

export type SurfaceLayerSpec = {
  /** a registry material fn name or slug (RegistryMaterial.fn / .slug) */
  material: string;
  variant: number;
  seed: number;
  blend: SurfaceBlend;
  factor: SurfaceFactor;
};

export type SurfaceSpec = {
  base: { material: string; variant: number; seed: number };
  quality: number;
  mode: SurfaceMode;
  /** required when mode === 'span'; ignored for 'tile' */
  span?: SpanGroup;
  layers: SurfaceLayerSpec[];
};

const BLEND_CODE: Record<SurfaceBlend, number> = { over: 0, add: 1, multiply: 2, screen: 3, mask: 4 };
const FACTOR_CODE: Record<SurfaceFactorKind, number> = { const: 0, gradientY: 1, gradientX: 2, timePulse: 3 };

// Accepts a bare registry key (RegistryMaterial.fn / .slug, e.g. "road") OR
// the shaders.ts ShaderSpec id form ("<board-letter>-<slug>", e.g. "a-road",
// "i-brick-apartment") — CustomTexture.shaderId (game/textures/materials.ts)
// is always the latter, so a surface record's base/layer material ids resolve
// without inventing a fourth id vocabulary.
function findMaterial(idOrFn: string): RegistryMaterial {
  const direct = MATERIALS.find((entry) => entry.fn === idOrFn || entry.slug === idOrFn);
  if (direct) return direct;
  const prefixed = /^[a-z]-(.+)$/.exec(idOrFn);
  if (prefixed) {
    const bySlug = MATERIALS.find((entry) => entry.slug === prefixed[1]);
    if (bySlug) return bySlug;
  }
  throw new Error(`surfaceCompose: unknown material "${idOrFn}"`);
}

/** True when a SurfaceSpec needs a generated composite shader — i.e. it isn't
 *  the plain single-material tile case every material already resolves to. */
export function isComposite(spec: Pick<SurfaceSpec, 'mode' | 'layers'>): boolean {
  return spec.mode === 'span' || spec.layers.length > 0;
}

function layerBlock(layer: SurfaceLayerSpec, index: number): { data: number[]; wgsl: string } {
  const m = findMaterial(layer.material);
  const data = [m.materialId, m.boardIndex, layer.variant, layer.seed, BLEND_CODE[layer.blend], FACTOR_CODE[layer.factor.kind], layer.factor.value];
  const base = 11 + index * 7;
  const wgsl = `
  {
    let lm = i32(D[${base}] + 0.5);
    let lb = D[${base + 1}];
    let lv = D[${base + 2}];
    let ls = D[${base + 3}];
    let lblend = i32(D[${base + 4}] + 0.5);
    let lfk = i32(D[${base + 5}] + 0.5);
    let lfv = D[${base + 6}];
    let over_col = fill_pick(lm, lb, uv, px, lv, ls);
    let f = surface_factor(lfk, lfv, uv, U.time);
    col = surface_blend(lblend, col, over_col, f);
  }`;
  return { data, wgsl };
}

/** Assemble a bespoke fs_main for one SurfaceSpec — base UV mode + N overlay
 *  layers — reusing FILL_FUNCS verbatim. Returns the shader source + its D[]
 *  data, ready for the same materialize()/MaterialAsset path a plain material
 *  uses (see worldGeometry.ts resolveMaterialShader). */
export function composeSurfaceShader(spec: SurfaceSpec): { wgsl: string; data: number[] } {
  const base = findMaterial(spec.base.material);
  if (spec.mode === 'span' && !spec.span) {
    throw new Error('surfaceCompose: mode "span" requires a `span` group');
  }
  const span = spec.span ?? { id: '', gx: 0, gy: 0, w: 1, h: 1 };

  const data: number[] = [
    base.materialId, base.boardIndex, spec.base.variant, spec.base.seed, spec.quality,
    spec.mode === 'span' ? 1 : 0,
    span.gx, span.gy, span.w, span.h,
    spec.layers.length,
  ];
  const layerBlocks = spec.layers.map((layer, index) => layerBlock(layer, index));
  for (const block of layerBlocks) data.push(...block.data);

  const wgsl = `
${FILL_FUNCS}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let baseMaterial = i32(D[0] + 0.5);
  let baseBoard = D[1];
  let baseVariant = D[2];
  let baseSeed = D[3];
  let quality = D[4];
  let spanFlag = D[5];
  let gx = D[6];
  let gy = D[7];
  let spanW = max(D[8], 1.0);
  let spanH = max(D[9], 1.0);
  var uv = in.uv;
  if (spanFlag > 0.5) {
    uv = (vec2f(gx, gy) + in.uv) / vec2f(spanW, spanH);
  } else if (quality < 0.5) {
    uv = (floor(in.uv * 32.0) + vec2f(0.5, 0.5)) / 32.0;
  } else if (quality < 1.5) {
    uv = (floor(in.uv * 64.0) + vec2f(0.5, 0.5)) / 64.0;
  }
  let px = uv * vec2f(U.size_w, U.size_h);
  var col = fill_pick(baseMaterial, baseBoard, uv, px, baseVariant, baseSeed);
${layerBlocks.map((b) => b.wgsl).join('\n')}
  let vignette = 1.0 - smoothstep(0.20, 0.88, length(in.uv - vec2f(0.5, 0.5)));
  col = quality_pass(col, uv, px, baseSeed, quality, baseBoard);
  col = col * (0.82 + vignette * 0.20);
  return vec4f(sat3(col), 1.0);
}
`;
  return { wgsl, data };
}

/** A stable cache/vocab key for a SurfaceSpec — distinct span positions or
 *  layer stacks must never collide with each other or with a plain material's
 *  key (see worldGeometry.ts internMaterial). */
export function surfaceSpecKey(spec: SurfaceSpec): string {
  const layerKey = spec.layers.map((l) => `${l.material}:${l.variant}:${l.seed}:${l.blend}:${l.factor.kind}:${l.factor.value}`).join('|');
  const spanKey = spec.span ? `${spec.span.gx},${spec.span.gy},${spec.span.w},${spec.span.h}` : '';
  return `surface:${spec.base.material}:${spec.base.variant}:${spec.base.seed}:${spec.quality}:${spec.mode}:${spanKey}:${layerKey}`;
}
