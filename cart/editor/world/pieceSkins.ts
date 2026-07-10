// world/pieceSkins.ts — REAL textures on placed build-piece faces (req_2575
// Stage B). Cloned in spirit from cart/hmsc-int/editors/build/pieceMeshes.tsx
// buildingSkinBoxes: a piece face that wears an assigned material becomes a
// textured cube (a "skin box") outset a hair over the flat live-piece box, and
// the material's WGSL shader is pushed once so the loader samples it.
//
// The flow (host doors already exist — this hot-reloads):
//   1. decompose the piece into shapes (pieceShapes), tagged per FaceSlot.
//   2. for each solid box whose governing slot holds a shader material, resolve
//      the material's WGSL + data (the content asset's `preview` already carries
//      them) and emit a 32-byte skin box referencing that material's hash.
//   3. WorldViewport pushes the materials via __compiled_world_set_live_material
//      and the boxes via __compiled_world_set_live_skin_boxes.
import { pieceVisualShapes } from './pieceShapes';
import type { MaterialRef, PlacedPiece } from './pieces';
import { slotRefForBox } from './pieceSlots';
import { assetById } from '../data/catalog';

export type LiveMaterial = { hash: number; wgsl: string; data: number[]; opacity: number };
export type SkinPush = { boxes: Uint8Array; materials: LiveMaterial[] };

const SKIN_BOX_STRIDE_BYTES = 32; // cx,cy,cz, sx,sy,sz, yaw (f32), matHash (u32)

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Resolve a slot material ref to a live WGSL material, or null if it isn't a
 *  procedural shader (image/decal/color skins stay flat here — a later slice). */
function shaderMaterialFor(ref: MaterialRef): LiveMaterial | null {
  if (!('assetId' in ref)) return null;
  const asset = assetById(ref.assetId);
  const preview = asset.preview;
  if (!preview || preview.kind !== 'shader') return null;
  const hash = fnv1a(`${ref.assetId}:${preview.data.join(',')}`);
  return { hash, wgsl: preview.shader, data: preview.data, opacity: 1 };
}

/** Build the live skin boxes + their materials for the placed pieces. Only faces
 *  with an assigned shader material produce a box; unskinned faces stay on their
 *  flat live-piece colour. */
export function pieceSkinBoxes(pieces: readonly PlacedPiece[]): SkinPush {
  const out: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yaw: number; matHash: number }[] = [];
  const materials = new Map<number, LiveMaterial>();
  for (const piece of pieces) {
    if (!piece.slots) continue; // cheap skip — no assigned material → no skin box
    for (const shape of pieceVisualShapes(piece, '#ffffff')) {
      if (shape.kind !== 'box') continue; // skinned ramps deferred (roofs stay flat)
      const b = shape.box;
      if (b.door) continue; // the door leaf keeps its dark panel, never a material
      const ref = slotRefForBox(piece, b.slot);
      if (!ref) continue;
      const mat = shaderMaterialFor(ref);
      if (!mat) continue;
      if (!materials.has(mat.hash)) materials.set(mat.hash, mat);
      out.push({ cx: b.cx, cy: b.cy, cz: b.cz, sx: b.sx, sy: b.sy, sz: b.sz, yaw: b.yawDegrees, matHash: mat.hash });
    }
  }
  const buf = new ArrayBuffer(out.length * SKIN_BOX_STRIDE_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  out.forEach((b, i) => {
    const o = i * 8;
    f[o] = b.cx; f[o + 1] = b.cy; f[o + 2] = b.cz;
    f[o + 3] = b.sx; f[o + 4] = b.sy; f[o + 5] = b.sz;
    f[o + 6] = b.yaw;
    u[o + 7] = b.matHash;
  });
  return { boxes: new Uint8Array(buf), materials: [...materials.values()] };
}
