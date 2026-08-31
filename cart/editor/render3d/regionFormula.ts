// regionFormula.ts — the LIVE MATERIAL REGION formula (req_3394/3395/3397).
//
// A material region is a set of faces on a model bound to a catalog material
// that the host evaluates PER-FRAME over the fragment's OBJECT-SPACE position
// (mesh-local), through the region pipeline in framework/gpu/3d.zig. All faces
// of a region sample ONE continuous animated field — continuity across faces is
// a property of the domain, never of per-face bases (the compounding "every
// face restarts the material" failure this feature exists to kill, req_3395).
//
// COMPOSITION IS PER-BINDING-SET, NOT PER-CATALOG (req_3400). The first cut
// composed the whole generated dispatch (410 materials, ~735 KB WGSL) like the
// painted ground does — and binding a material froze the app for minutes while
// naga chewed it on the render thread. Unlike the ground (where any tile can
// be any material in ONE draw), a region draw only ever needs the materials
// actually BOUND on the model — so buildRegionFormula() extracts JUST those
// fn bodies (plus the shared helpers prelude and any material fn they call)
// out of FILL_FUNCS and emits a small if-chain dispatch. A one-material module
// is tens of KB and compiles in well under a second; changing the bound SET
// recompiles (hash-gated host-side), changing variant/seed/palette/scale is
// still pure data.
//
// Region D layout (the palette-slot contract + the param section + region
// extras — harness extras always ride AFTER the shared sections):
//   [0] materialId  [1] variant  [2] seed  [3] quality (unused here)  [4] board
//   [5] paletteSlotCount   [6 + 3i ..] slot i rgb   (mat_pal reads these)
//   [6 + 3*slotCount] paramCount   [.. + 1 ..] param values (mat_param)
//   [7 + 3*slotCount + paramCount] domainScale — tiles per world unit (default 1)
//
// The domain is NOT tiled with fract(): a lavalamp's goo must be continuous
// across every face, and sin/fbm materials evaluate fine on unbounded coords.
// Materials whose look depends on the [0,1] uv frame (edge vignettes, framed
// compositions) will read differently here — pick surface materials that are
// happy continuous (the lava_plasma four-wave sine is the reference case).
import { splitFillDispatch, resolveMaterialFns, fnBody, D_DECL } from './shaders/compose';
import { MATERIALS, type RegistryMaterial } from './shaders/_generated/registry';
import type { ModelLiveMaterial } from '../data/types';

/** The shared compose.ts split (req_3473), with the region harness's D
 *  substitution applied — the region pipeline declares D itself
 *  (framework/gpu/shaders.zig). */
function splitDispatch(): { prelude: string } {
  const { prelude } = splitFillDispatch();
  return {
    prelude: prelude.replace(D_DECL, '// (D is declared by the region harness — framework/gpu/shaders.zig)'),
  };
}

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));

/** Compose the region formula for ONE SET of bound material fns: shared
 *  helpers prelude + just those fn bodies (plus any material fn they call) +
 *  a small dispatch + the triplanar region_rgb. mat_pal stays ACTIVE — a
 *  region's D stream really is the fill contract, so palette recoloring works
 *  exactly as it does for paint inks. Returns null (loudly) if a requested fn
 *  is missing from the generated dispatch, so callers never push a formula
 *  the shader would miscompile. */
export function buildRegionFormula(fns: readonly string[]): string | null {
  const { prelude } = splitDispatch();
  const wanted = [...new Set(fns)].sort();
  if (wanted.length === 0) return null;
  // Shared transitive resolution (compose.ts): wanted fns plus every material,
  // atom, and surface-module fn their bodies call (compositions layering
  // surfaces; adapters like brick calling surface_brick).
  const need = resolveMaterialFns(wanted);
  if (!need) return null;
  const dispatch = wanted
    .map((fn) => {
      const mat = MATERIAL_BY_FN.get(fn);
      return mat ? `  if (mat == ${mat.materialId} && board == ${mat.boardIndex}) { return ${fn}(uv, px, variant, seed); }` : '';
    })
    .filter(Boolean)
    .join('\n');
  return `
${prelude}
${need.map((fn) => fnBody(fn)!).join('\n')}
fn region_mat(mat: i32, board: i32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
${dispatch}
  return vec3f(1.0, 0.0, 1.0); // material not in this composed set — loud magenta
}
fn region_rgb(p: vec3f, n: vec3f) -> vec3f {
  let mat = i32(D[0]);
  let variant = D[1];
  let seed = D[2];
  let board = i32(D[4]);
  let slotCount = u32(max(D[5], 0.0) + 0.5);
  let paramCount = u32(max(D[6u + slotCount * 3u], 0.0) + 0.5);
  var scale = D[7u + slotCount * 3u + paramCount];
  if (scale <= 0.0001) { scale = 1.0; }
  let an = abs(n) + vec3f(0.0001);
  let w = an / (an.x + an.y + an.z);
  let uvx = p.yz * scale;
  let uvy = p.xz * scale;
  let uvz = p.xy * scale;
  let cx = region_mat(mat, board, uvx, uvx * 64.0, variant, seed);
  let cy = region_mat(mat, board, uvy, uvy * 64.0, variant, seed);
  let cz = region_mat(mat, board, uvz, uvz * 64.0, variant, seed);
  return cx * w.x + cy * w.y + cz * w.z;
}
`.replace(/\bU\.time\b/g, 'S.time');
}

/** The catalog materials a region can bind to. Surface recipes only, same
 *  rationale as GROUND_MATERIALS — gradients/compositions read wrong tiled
 *  over a 3D domain. */
export const REGION_MATERIALS: RegistryMaterial[] = MATERIALS.filter((m) => m.kind === 'surface');

/** The binding shape is the manifest's ModelLiveMaterial — one type, disk to shader. */
export type LiveMaterialBinding = ModelLiveMaterial;

/** Pack a binding into the region D stream (data[] + palette + extras). The
 *  palette section is ALWAYS present (mat_pal is active in this composition),
 *  defaulting to the material's own extracted slots. Returns null for an
 *  unknown material fn — callers keep their old binding rather than pushing
 *  garbage the shader would misread. */
export function buildRegionData(binding: LiveMaterialBinding): Float32Array | null {
  const mat = MATERIAL_BY_FN.get(binding.fn);
  if (!mat) {
    console.error(`[regionFormula] unknown live material '${binding.fn}' — binding not pushed`);
    return null;
  }
  const slots = mat.slots ?? [];
  const palette = slots.map((slot, i) => binding.palette?.[i] ?? slot.rgb);
  const params = (mat.params ?? []).map((p) => p.default);
  const out = new Float32Array(7 + palette.length * 3 + params.length + 1);
  out[0] = mat.materialId;
  out[1] = binding.variant ?? 0;
  out[2] = binding.seed ?? mat.materialId * 7.3;
  out[3] = 1; // quality — unused by the region path, kept for contract shape
  out[4] = mat.boardIndex;
  out[5] = palette.length;
  palette.forEach(([r, g, b], i) => {
    out[6 + i * 3] = r;
    out[6 + i * 3 + 1] = g;
    out[6 + i * 3 + 2] = b;
  });
  // The param section is explicit even at its defaults so the trailing
  // domainScale always sits one address past it (region_rgb reads it there).
  out[6 + palette.length * 3] = params.length;
  params.forEach((value, i) => { out[7 + palette.length * 3 + i] = value; });
  out[7 + palette.length * 3 + params.length] = binding.scale ?? 1;
  return out;
}
