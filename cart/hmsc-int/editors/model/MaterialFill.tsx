// editors/model/MaterialFill.tsx — bake a MATERIAL paint slot into the atlas, the
// corrected way (req_1288): the catalog material (game/textures) sampled in CONTINUOUS
// surface space at a WORLD scale (worldPerTile metres/tile), masked to the slot's
// painted cells. Reuses the exact catalog material functions (FILL_FUNCS from
// render3d/fillShader) with a world-scale + mask entry point — no per-cell repeat
// (paint_texture_demo proved the shape), no stretching, one copy of the materials.

import { Effect } from '@reactjit/primitives';
import { FILL_FUNCS } from '../../render3d/fillShader';
import { paramDefaults, shaderSpec } from '../../game/textures/shaders';
import type { SlotDef } from './modelStream';
import type { CellGrid } from './meshPaint';

const UNITS_PER_METRE = 16; // 16 model units = 1 m (textureize basis)

// Our own fs_main on top of the shared material library: sample the chosen material
// per surface-tile (fract → continuous tiling across cells), discard unpainted cells.
const FILL_MAIN = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let material = i32(D[0] + 0.5);
  let variant = D[1];
  let seed = D[2];
  let board = D[4];
  let tilesU = D[5];
  let tilesV = D[6];
  let spanU = D[7];
  let spanV = D[8];
  let nu = D[9];
  let nv = D[10];
  // paint MASK: which cell is this fragment in, and was it painted with this slot?
  let cu = clamp(floor(in.uv.x * spanU), 0.0, nu - 1.0);
  let cv = clamp(floor(in.uv.y * spanV), 0.0, nv - 1.0);
  let idx = u32(11.0 + cv * nu + cu);
  if (D[idx] < 0.5) { discard; }
  // continuous material: surface-tile coords, fract per tile so it tiles seamlessly.
  let suv = vec2f(in.uv.x * tilesU, in.uv.y * tilesV);
  let local = fract(suv);
  let px = suv * vec2f(U.size_w, U.size_h);
  let col = fill_pick(material, board, local, px, variant, seed);
  return vec4f(col, 1.0);
}
`;
const MATERIAL_SHADER = FILL_FUNCS + FILL_MAIN;

/** D[] for the slot's material: [materialId, variant, seed, grade, board] from the
 *  catalog spec (reused, not re-derived). null if the slug is unknown. */
function materialData(slot: SlotDef): number[] | null {
  const mat = slot.material;
  if (!mat) return null;
  const spec = shaderSpec(mat.slug);
  if (!spec || !spec.buildData) return null;
  const base = paramDefaults(spec.base);
  const variant = spec.variants[mat.variant % spec.variants.length] ?? spec.variants[0];
  const o = paramDefaults(variant.params);
  return spec.buildData(variant.value, base, o);
}

/** One material slot's painted region on one face: an <Effect> over the face's uv
 *  bbox (in atlas px), sampling the material at world scale, masked to `cells`. */
export function MaterialFill(props: { slot: SlotDef; grid: CellGrid; cells: Array<[number, number]>; cell: number; texels: number }) {
  const { slot, grid, cells, cell, texels } = props;
  const base = materialData(slot);
  if (!base) return null;

  // world extent of the face (model units): cuv = cell / (units-per-uv), so the
  // units-per-uv scale = cell / cuv, and world extent = uv-extent × that scale.
  const scale = cell / grid.cuv;
  const worldU = (grid.u1 - grid.u0) * scale;
  const worldV = (grid.v1 - grid.v0) * scale;
  const worldPerTileUnits = Math.max(1e-3, (slot.worldPerTile ?? 1) * UNITS_PER_METRE);
  const tilesU = Math.max(0.01, worldU / worldPerTileUnits);
  const tilesV = Math.max(0.01, worldV / worldPerTileUnits);
  const spanU = (grid.u1 - grid.u0) / grid.cuv; // cells across (fractional)
  const spanV = (grid.v1 - grid.v0) / grid.cuv;

  // pack: header (5) + tiles/span/stride (6) + the cell mask (nu*nv).
  const data = base.slice(0, 5);
  while (data.length < 5) data.push(0);
  data.push(tilesU, tilesV, spanU, spanV, grid.nu, grid.nv);
  const maskBase = data.length;
  for (let i = 0; i < grid.nu * grid.nv; i += 1) data.push(0);
  for (const [cu, cv] of cells) {
    if (cu < 0 || cu >= grid.nu || cv < 0 || cv >= grid.nv) continue;
    data[maskBase + cv * grid.nu + cu] = 1;
  }

  const left = grid.u0 * texels, top = grid.v0 * texels;
  const w = Math.max(1, (grid.u1 - grid.u0) * texels), h = Math.max(1, (grid.v1 - grid.v0) * texels);
  return <Effect shader={MATERIAL_SHADER} data={data} style={{ position: 'absolute', left, top, width: w, height: h }} />;
}
