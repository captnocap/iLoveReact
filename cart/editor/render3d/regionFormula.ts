// regionFormula.ts — the LIVE MATERIAL REGION formula (req_3394/3395/3397).
//
// A material region is a set of faces on a model bound to a catalog material
// that the host evaluates PER-FRAME over the fragment's OBJECT-SPACE position
// (mesh-local), through the region pipeline in framework/gpu/3d.zig. All faces
// of a region sample ONE continuous animated field — continuity across faces is
// a property of the domain, never of per-face bases (the compounding "every
// face restarts the material" failure this feature exists to kill, req_3395).
//
// Same split as the painted ground (groundFormula.ts): the FORMULA is static —
// composed once from the generated fill catalog and pushed via
// __model_region_formula — while every material PICK arrives as DATA through
// __model_region_bind_slot / __model_region_set. Rebinding a slot or recoloring
// a palette never recompiles WGSL.
//
// Region D layout (the palette-slot contract + region extras):
//   [0] materialId  [1] variant  [2] seed  [3] quality (unused here)  [4] board
//   [5] paletteSlotCount   [6 + 3i ..] slot i rgb   (mat_pal reads these)
//   [6 + 3*slotCount] domainScale — material tiles per world unit (default 1)
//
// The domain is NOT tiled with fract(): a lavalamp's goo must be continuous
// across every face, and sin/fbm materials evaluate fine on unbounded coords.
// Materials whose look depends on the [0,1] uv frame (edge vignettes, framed
// compositions) will read differently here — pick surface materials that are
// happy continuous (the lava_plasma four-wave sine is the reference case).
import { FILL_FUNCS } from './shaders/_generated/dispatch';
import { MATERIALS, type RegistryMaterial } from './shaders/_generated/registry';
import type { ModelLiveMaterial } from '../data/types';

// Drift guards, same discipline as groundFormula.composedFillFuncs: each edit
// asserts its pattern so a build-shaders.ts output change fails LOUD.
const D_DECL = '@group(0) @binding(1) var<storage, read> D: array<f32>;';

function composedRegionFuncs(): string {
  if (!FILL_FUNCS.includes(D_DECL)) {
    throw new Error('[regionFormula] dispatch drift: D declaration not found — re-check build-shaders.ts output');
  }
  // Unlike the ground composition, mat_pal stays FULLY ACTIVE: a region's D
  // stream really is the fill contract (data[] + palette section), so palette
  // recoloring works exactly as it does for paint inks and thumbnails.
  return FILL_FUNCS.replace(D_DECL, '// (D is declared by the region harness — framework/gpu/shaders.zig)')
    .replace(/\bU\.time\b/g, 'S.time');
}

/** Build the STATIC region formula: triplanar evaluation of the bound catalog
 *  material over mesh-local position. The blend weights come from the world
 *  normal, so a curved shell (the lavalamp glass, a blob) crossfades its three
 *  planar slices smoothly — and any face pair sharing an edge agrees exactly. */
export function editorRegionFormula(): string {
  return `
${composedRegionFuncs()}
fn region_rgb(p: vec3f, n: vec3f) -> vec3f {
  let mat = i32(D[0]);
  let variant = D[1];
  let seed = D[2];
  let board = D[4];
  let slotCount = u32(max(D[5], 0.0) + 0.5);
  var scale = D[6u + slotCount * 3u];
  if (scale <= 0.0001) { scale = 1.0; }
  let an = abs(n) + vec3f(0.0001);
  let w = an / (an.x + an.y + an.z);
  let uvx = p.yz * scale;
  let uvy = p.xz * scale;
  let uvz = p.xy * scale;
  let cx = fill_pick(mat, board, uvx, uvx * 64.0, variant, seed);
  let cy = fill_pick(mat, board, uvy, uvy * 64.0, variant, seed);
  let cz = fill_pick(mat, board, uvz, uvz * 64.0, variant, seed);
  return cx * w.x + cy * w.y + cz * w.z;
}
`;
}

/** THE region formula — static for the whole run; material picks are data. */
export const EDITOR_REGION_FORMULA = editorRegionFormula();

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));

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
  const out = new Float32Array(6 + palette.length * 3 + 1);
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
  out[6 + palette.length * 3] = binding.scale ?? 1;
  return out;
}
