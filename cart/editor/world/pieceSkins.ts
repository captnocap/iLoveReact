// world/pieceSkins.ts — real textures on placed build-piece faces (req_2575
// Stage B). A piece face that wears an assigned material becomes a
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
import type { MaterialRef, PlacedPiece, StickerPlacement } from './pieces';
import { slotRefForBox } from './pieceSlots';
import { assetById } from '../data/catalog';
import { stickerById } from '../data/stickerStore';
import { shaderSpec } from '../textures/shaders';
import { rotatePackedTexture } from '../textures/pixelTexture';

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
export function liveMaterialFor(ref: MaterialRef): LiveMaterial | null {
  if (!('assetId' in ref)) return null;
  const asset = assetById(ref.assetId);
  const preview = asset.preview;
  if (!preview || preview.kind !== 'shader') return null;
  const hash = fnv1a(`${ref.assetId}:${preview.data.join(',')}`);
  return { hash, wgsl: preview.shader, data: preview.data, opacity: 1 };
}

// Sticker quad geometry (req_3025/req_3028): a stamp is a FLAT quad — thickness
// exactly 0 marks it for the loader, which draws a 12-vert two-sided plane (4
// tris vs the cube's 12; stickers have no sides and no real back). Floated a
// hair off its face so the wall (and any face-slot skin box) never z-fights it.
const STICKER_THICKNESS = 0;
const STICKER_OUTSET = 0.008;
// Overlapping stickers must never share a plane (req_3050: "reality doesnt
// thrash around a z-index based on camera pov") — but lifting every stamp
// unconditionally displaces a whole collage off its wall (req_3051). A stamp
// lifts ONE step above the highest sticker it actually covers, so isolated
// stickers stay flush and only true overlap stacks climb: stamp order is
// stack order exactly where stickers touch, like reality.
const STICKER_LAYER_STEP = 0.002;

/** A placement's 2D footprint on its face plane (piece-local face coords) —
 *  the rect the overlap test compares. Quarter turns swap the footprint; the
 *  dominant normal axis picks which two local axes span the face. */
function stickerFaceRect(
  p: StickerPlacement,
  wMeters: number,
  hMeters: number,
): { plane: string; cu: number; cv: number; hw: number; hh: number } {
  const w = wMeters * p.scale;
  const h = hMeters * p.scale;
  const swapped = p.rot % 2 === 1;
  const fw = swapped ? h : w;
  const fh = swapped ? w : h;
  const anx = Math.abs(p.nx), any = Math.abs(p.ny), anz = Math.abs(p.nz);
  if (any >= anx && any >= anz) {
    return { plane: `y${p.ny > 0 ? '+' : '-'}`, cu: p.lx, cv: p.lz, hw: fw / 2, hh: fh / 2 };
  }
  if (anx >= anz) {
    return { plane: `x${p.nx > 0 ? '+' : '-'}`, cu: p.lz, cv: p.ly, hw: fw / 2, hh: fh / 2 };
  }
  return { plane: `z${p.nz > 0 ? '+' : '-'}`, cu: p.lx, cv: p.ly, hw: fw / 2, hh: fh / 2 };
}

type RectOnPlane = ReturnType<typeof stickerFaceRect>;

function rectsOverlap(a: RectOnPlane, b: RectOnPlane): boolean {
  if (a.plane !== b.plane) return false; // different faces never stack
  return Math.abs(a.cu - b.cu) < a.hw + b.hw && Math.abs(a.cv - b.cv) < a.hh + b.hh;
}

/** Stack layers for a piece's stamps, in stamp order: 0 when a stamp covers
 *  nothing, else one above the highest stamp it overlaps. A collage of
 *  touching-but-chained stickers climbs only along the chain (rigid quads
 *  can't bend); anything isolated sits flush at the base lift. */
export function stickerLayers(
  rects: readonly RectOnPlane[],
): number[] {
  const layers: number[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    let layer = 0;
    for (let j = 0; j < i; j += 1) {
      if (rectsOverlap(rects[i]!, rects[j]!)) layer = Math.max(layer, layers[j]! + 1);
    }
    layers.push(layer);
  }
  return layers;
}
const DEG = Math.PI / 180;

/** The sticker asset's texture as a live material, rotation baked into the
 *  packed data so every stamp rides the one pixel-texture shader contract. */
function stickerMaterialFor(placement: StickerPlacement): LiveMaterial | null {
  const sticker = stickerById(placement.stickerId);
  if (!sticker) return null;
  const spec = shaderSpec(sticker.textureId);
  if (!spec) return null; // texture package gone — the stamp draws nothing, loudly absent
  const rot = ((placement.rot % 4) + 4) % 4;
  const data = rotatePackedTexture(spec.buildData(), rot);
  const hash = fnv1a(`stk:${sticker.id}:${rot}`);
  return { hash, wgsl: spec.shader, data, opacity: 1 };
}

/** A placement's skin-box row: anchor + outward normal live in the PIECE frame,
 *  so the box center is the yaw-rotated anchor nudged along the world normal;
 *  the box's own yaw is the piece yaw (the quad lies in the face plane). */
function stickerBoxFor(
  piece: PlacedPiece,
  p: StickerPlacement,
  wMeters: number,
  hMeters: number,
  layer: number,
): { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yaw: number } {
  const w = wMeters * p.scale;
  const h = hMeters * p.scale;
  const swapped = p.rot % 2 === 1; // quarter turns swap the footprint
  const fw = swapped ? h : w;
  const fh = swapped ? w : h;
  const lift = STICKER_OUTSET + layer * STICKER_LAYER_STEP + STICKER_THICKNESS / 2;
  const ax = p.lx + p.nx * lift;
  const ay = p.ly + p.ny * lift;
  const az = p.lz + p.nz * lift;
  // local→world in the pieceShapes/localOffset frame (the convention the
  // loader's skin boxes already pair with yaw); stickerLocalFrom is its inverse.
  const cos = Math.cos(piece.yawDegrees * DEG);
  const sin = Math.sin(piece.yawDegrees * DEG);
  const cx = piece.x + ax * cos + az * sin;
  const cz = piece.z - ax * sin + az * cos;
  const cy = piece.y + ay;
  // Dominant local normal axis picks which box axis is the thin one.
  const anx = Math.abs(p.nx), any = Math.abs(p.ny), anz = Math.abs(p.nz);
  if (any >= anx && any >= anz) {
    return { cx, cy, cz, sx: fw, sy: STICKER_THICKNESS, sz: fh, yaw: piece.yawDegrees };
  }
  if (anx >= anz) {
    return { cx, cy, cz, sx: STICKER_THICKNESS, sy: fh, sz: fw, yaw: piece.yawDegrees };
  }
  return { cx, cy, cz, sx: fw, sy: fh, sz: STICKER_THICKNESS, yaw: piece.yawDegrees };
}

/** World raycast hit → the piece-local anchor + outward normal a
 *  StickerPlacement stores. The exact inverse of stickerBoxFor's local→world,
 *  so a stamp renders precisely where the ray touched. */
export function stickerLocalFrom(
  piece: { x: number; y: number; z: number; yawDegrees: number },
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
): { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number } {
  const cos = Math.cos(piece.yawDegrees * DEG);
  const sin = Math.sin(piece.yawDegrees * DEG);
  const dx = point.x - piece.x;
  const dz = point.z - piece.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const rnx = normal.x * cos - normal.z * sin;
  const rnz = normal.x * sin + normal.z * cos;
  // Snap the local normal to its dominant axis — piece faces are axis-aligned
  // in their own frame, and the box math keys on that axis.
  const ax = Math.abs(rnx), ay = Math.abs(normal.y), az = Math.abs(rnz);
  let nx = 0, ny = 0, nz = 0;
  if (ay >= ax && ay >= az) ny = normal.y >= 0 ? 1 : -1;
  else if (ax >= az) nx = rnx >= 0 ? 1 : -1;
  else nz = rnz >= 0 ? 1 : -1;
  return { lx, ly: point.y - piece.y, lz, nx, ny, nz };
}

/** Build the live skin boxes + their materials for the placed pieces. Only faces
 *  with an assigned shader material produce a box; unskinned faces stay on their
 *  flat live-piece colour. Sticker stamps ride the same push as thin quads over
 *  their faces. */
export function pieceSkinBoxes(pieces: readonly PlacedPiece[]): SkinPush {
  const out: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yaw: number; matHash: number }[] = [];
  const materials = new Map<number, LiveMaterial>();
  for (const piece of pieces) {
    if (piece.slots) {
      for (const shape of pieceVisualShapes(piece, '#ffffff')) {
        if (shape.kind !== 'box') continue; // skinned ramps deferred (roofs stay flat)
        const b = shape.box;
        if (b.door) continue; // the door leaf keeps its dark panel, never a material
        if (b.opacity !== undefined) continue; // the glass pane stays glass — an opaque skin cube would plate the window hole
        const ref = slotRefForBox(piece, b.slot);
        if (!ref) continue;
        const mat = liveMaterialFor(ref);
        if (!mat) continue;
        if (!materials.has(mat.hash)) materials.set(mat.hash, mat);
        out.push({ cx: b.cx, cy: b.cy, cz: b.cz, sx: b.sx, sy: b.sy, sz: b.sz, yaw: b.yawDegrees, matHash: mat.hash });
      }
    }
    const stamps = (piece.stickers ?? [])
      .map((placement) => ({ placement, sticker: stickerById(placement.stickerId) }))
      .filter((s): s is { placement: StickerPlacement; sticker: NonNullable<ReturnType<typeof stickerById>> } => !!s.sticker);
    const layers = stickerLayers(stamps.map(({ placement, sticker }) =>
      stickerFaceRect(placement, sticker.widthMeters, sticker.heightMeters)));
    stamps.forEach(({ placement, sticker }, i) => {
      const mat = stickerMaterialFor(placement);
      if (!mat) return;
      if (!materials.has(mat.hash)) materials.set(mat.hash, mat);
      const box = stickerBoxFor(piece, placement, sticker.widthMeters, sticker.heightMeters, layers[i]!);
      out.push({ ...box, matHash: mat.hash });
    });
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
