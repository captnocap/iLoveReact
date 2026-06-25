// editors/model/seedFromPiece.ts — "open a primitive as an editable mesh" (req_1684).
//
// The FRONT of the custom-piece loop: take a built-in BUILD_CATALOG piece (a wall,
// half-wall, floor, stairs…) and lower its authored shape into ONE editable
// `EditMesh`, so the Studio can use it as a STARTING POINT — cut a window out of a
// wall, bolt a poster onto it, add a curved railing to a stair. The cooked result
// rides the existing cook → catalog → /compiled placeable-piece path (cookedAsset.ts).
//
// Source of truth, not a re-derivation: the shape comes from `pieceVisualShapes`
// (editors/build/pieceShapes) — the SAME decomposition the iso editor renders and
// the compile bake emits (PARITY-0611). We synthesize the piece at the origin with
// no neighbours (so no wall-join miters, no WALLTOP lift) and merge its STRUCTURAL
// solids into one mesh; the thin render-only face slabs (`.front`/`.back`/`.top`/
// `.bottom`), the glass pane and the live door leaf are skipped — they are presentation,
// not the solid you edit.
//
// Pure + headless (the editMesh/pieceShapes idiom): no React, no host doors — proven
// in seedFromPiece.test.ts under tools/v8cli.

import { GAME_BUILD } from '@game';
import { BUILD_UI, pieceVisualShapes } from '../build/pieceShapes';
import type { VisualBox, VisualRamp, VisualShape } from '../build/pieceShapes';
import { cuboid, type EditMesh, type EditMeshFace, type V3 } from './editMesh';

const DEG = Math.PI / 180;

/** Append a whole `EditMesh` onto growing vert/face arrays, offsetting the face
 *  index loops by where this mesh's verts land. Per-corner UVs ride through. */
function mergeInto(verts: V3[], faces: EditMeshFace[], add: EditMesh, place: (v: V3) => V3): void {
  const base = verts.length;
  for (const v of add.verts) verts.push(place([v[0], v[1], v[2]]));
  for (const f of add.faces) {
    const nf: EditMeshFace = { loop: f.loop.map((i) => i + base) };
    if (f.uv) nf.uv = f.uv.map((u) => [u[0], u[1]] as [number, number]);
    faces.push(nf);
  }
}

/** A right-triangular wedge prism (the ramp/roof-slope solid): a flat base at y=0,
 *  a low edge at -depth/2 rising `slab` and a high edge at +depth/2 rising to
 *  `height`. Reuses `cuboid`'s exact face winding (its 0..3 bottom / 4..7 top vertex
 *  convention) with the top verts pulled to the slope, so every face stays outward. */
function wedgeMesh(width: number, height: number, depth: number, slab: number): EditMesh {
  const x = width / 2;
  const z = depth / 2;
  const verts: V3[] = [
    [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z],            // 0..3 base
    [-x, slab, -z], [x, slab, -z], [x, height, z], [-x, height, z], // 4..7 slope top
  ];
  const faces: EditMeshFace[] = [
    { loop: [4, 7, 6, 5] }, // +Y slope
    { loop: [0, 1, 2, 3] }, // -Y base
    { loop: [0, 4, 5, 1] }, // -Z low end
    { loop: [3, 2, 6, 7] }, // +Z high end
    { loop: [0, 3, 7, 4] }, // -X left
    { loop: [1, 5, 6, 2] }, // +X right
  ];
  return { verts, faces };
}

function rotateY(v: V3, yawDegrees: number): V3 {
  if (yawDegrees === 0) return v;
  const c = Math.cos(yawDegrees * DEG);
  const s = Math.sin(yawDegrees * DEG);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** A render-only thin face plate (a skin slab / cap), not a structural solid. The
 *  decomposition tags them by key suffix; the seed keeps the cores you actually edit. */
function isFacePlate(box: VisualBox): boolean {
  const k = box.key;
  return k.endsWith('.front') || k.endsWith('.back') || k.endsWith('.top') || k.endsWith('.bottom');
}

/** The live door leaf / glass pane — presentation + live state, never part of the
 *  editable solid (a door is a two-state machine; glass is the transparent pass). */
function isNonSolid(box: VisualBox): boolean {
  return box.door === true || box.color === BUILD_UI.windowPaneColor;
}

function addBox(verts: V3[], faces: EditMeshFace[], box: VisualBox): void {
  mergeInto(verts, faces, cuboid(box.sx, box.sy, box.sz), (v) => {
    const r = rotateY(v, box.yawDegrees);
    return [r[0] + box.cx, r[1] + box.cy, r[2] + box.cz];
  });
}

function addRamp(verts: V3[], faces: EditMeshFace[], ramp: VisualRamp): void {
  mergeInto(verts, faces, wedgeMesh(ramp.width, ramp.height, ramp.depth, ramp.slabThickness), (v) => {
    const r = rotateY(v, ramp.yawDegrees);
    return [r[0] + ramp.x, r[1] + ramp.y, r[2] + ramp.z];
  });
}

/** Which visual shapes seed into the editable mesh — structural cores only. */
function seedableShapes(shapes: readonly VisualShape[]): VisualShape[] {
  return shapes.filter((s) => {
    if (s.kind === 'ramp') return true;
    // gable end / box / corner miter all carry a `box`; keep structural box cores.
    if (s.kind === 'cornerMiter' || s.kind === 'cornerMiterMirror') return false; // join-only, never on a lone piece
    return !isFacePlate(s.box) && !isNonSolid(s.box);
  });
}

type DoorDef = { size: { widthMeters: number; heightMeters: number; depthMeters: number } };

/** The doorway dimensions a door/garage seed carves — the opening width `Wo`
 *  and height `Ho` (from PLACED_TUNING, the same source the live edit + bake use),
 *  clamped under the piece's own W/H so a narrow wall still leaves jambs. */
function doorOpening(def: DoorDef, edit: string): { W: number; H: number; D: number; Wo: number; Ho: number } {
  const W = def.size.widthMeters, H = def.size.heightMeters, D = def.size.depthMeters;
  const t = GAME_BUILD.placed.tuning;
  const vehicle = edit === 'garageDoor';
  const Wo = Math.min(W * 0.9, vehicle ? t.vehicleOpeningWidthMeters : t.walkOpeningWidthMeters);
  const Ho = Math.min(H * 0.95, vehicle ? t.garageDoorPanelHeightMeters : t.walkDoorPanelHeightMeters);
  return { W, H, D, Wo, Ho };
}

/** Append an axis-aligned span box [x0,x1]×[y0,y1]×depth (centered at cz) onto
 *  growing vert/face arrays — the unit the door frame + leaf are built from. */
function spanBox(verts: V3[], faces: EditMeshFace[], x0: number, x1: number, y0: number, y1: number, depth: number, cz = 0): void {
  const sx = x1 - x0, sy = y1 - y0;
  if (sx <= 1e-4 || sy <= 1e-4) return;
  mergeInto(verts, faces, cuboid(sx, sy, depth), (v) => [v[0] + (x0 + x1) / 2, v[1] + (y0 + y1) / 2, v[2] + cz]);
}

/** The door FRAME — two jambs + a header around a floor-to-`Ho` opening (no leaf).
 *  This is the structural wall-with-a-hole; the leaf is a separate part so the
 *  cook can turn it into a toggleable door panel (req_1864). */
function carveDoorFrame(def: DoorDef, edit: string): EditMesh {
  const { W, H, D, Wo, Ho } = doorOpening(def, edit);
  const verts: V3[] = [];
  const faces: EditMeshFace[] = [];
  spanBox(verts, faces, -W / 2, -Wo / 2, 0, H, D);  // left jamb
  spanBox(verts, faces, Wo / 2, W / 2, 0, H, D);    // right jamb
  spanBox(verts, faces, -Wo / 2, Wo / 2, Ho, H, D); // header above the opening
  return { verts, faces };
}

/** The door LEAF — a real, editable, slightly-inset slab filling the opening
 *  (replaces the live edit's flat near-black panel). The "Door" cook (req_1864)
 *  records this part as the toggleable two-state door panel; the user details it
 *  into a real door. */
function carveDoorLeaf(def: DoorDef, edit: string): EditMesh {
  const { D, Wo, Ho } = doorOpening(def, edit);
  const verts: V3[] = [];
  const faces: EditMeshFace[] = [];
  spanBox(verts, faces, -Wo / 2 + 0.03, Wo / 2 - 0.03, 0, Ho - 0.02, Math.min(D * 0.6, 0.08));
  return { verts, faces };
}

/** A wall with a REAL doorway carved out + an editable door slab — the seed for a
 *  Door/Garage Wall (req_1698), as ONE merged mesh (frame + leaf). Kept for the
 *  single-mesh seed path; the two-part path is `seedPartsFromPiece` (req_1864). */
function carveDoorWall(def: DoorDef, edit: string): EditMesh {
  const frame = carveDoorFrame(def, edit);
  const verts: V3[] = [...frame.verts];
  const faces: EditMeshFace[] = [...frame.faces];
  mergeInto(verts, faces, carveDoorLeaf(def, edit), (v) => v);
  return { verts, faces };
}

/** Lower a BUILD_CATALOG piece into one editable mesh — the "start from this piece"
 *  seed. `edit` optionally pre-applies a wall edit (e.g. seed the wall already
 *  cut for a window). Returns an empty-but-valid mesh for an unknown id (fail soft;
 *  the caller validates before opening Studio). */
export function seedMeshFromPiece(pieceId: string, edit?: string): EditMesh {
  const verts: V3[] = [];
  const faces: EditMeshFace[] = [];
  // Default to the catalog entry's own edit (a "Window Wall" seeds already cut),
  // unless the caller overrides — so the seed matches what the palette shows.
  const def = GAME_BUILD.catalog.is(pieceId) ? GAME_BUILD.catalog.get(pieceId) : null;
  const seedEdit = edit ?? (def as { defaultEdit?: string } | null)?.defaultEdit;
  // Doors/garage doors: carve a real opening (the live render leaves the wall solid
  // behind a black panel) so the seed is a wall-with-a-door, not a flat block.
  if (def && (seedEdit === 'door' || seedEdit === 'garageDoor')) return carveDoorWall(def, seedEdit);
  const piece = { pieceId, x: 0, y: 0, z: 0, yawDegrees: 0, ...(seedEdit ? { edit: seedEdit as never } : {}) };
  for (const shape of seedableShapes(pieceVisualShapes(piece, 'seed'))) {
    if (shape.kind === 'ramp') addRamp(verts, faces, shape.ramp);
    else addBox(verts, faces, shape.box);
  }
  return { verts, faces };
}

/** A friendly part/model name for a seeded piece — the catalog label, so the
 *  Studio outliner reads "Concrete Wall", not a raw id. */
export function seedNameFromPiece(pieceId: string): string {
  return GAME_BUILD.catalog.is(pieceId) ? GAME_BUILD.catalog.get(pieceId).label : pieceId;
}

/** One named part of a seed (req_1864). */
export type SeedPart = { name: string; mesh: EditMesh };

/** Lower a BUILD_CATALOG piece into the editable PARTS the Studio opens it as.
 *  Door/garage seeds split into a `Door Frame` part (jambs + header) and a
 *  `Door Leaf` part (the slab) so the user details the leaf on its own and the
 *  "Door" cook (req_1864) can turn that named part into a toggleable two-state
 *  door panel. Every other piece is a single part — the merged seed mesh. */
export function seedPartsFromPiece(pieceId: string, edit?: string): SeedPart[] {
  const def = GAME_BUILD.catalog.is(pieceId) ? GAME_BUILD.catalog.get(pieceId) : null;
  const seedEdit = edit ?? (def as { defaultEdit?: string } | null)?.defaultEdit;
  if (def && (seedEdit === 'door' || seedEdit === 'garageDoor')) {
    return [
      { name: 'Door Frame', mesh: carveDoorFrame(def, seedEdit) },
      { name: 'Door Leaf', mesh: carveDoorLeaf(def, seedEdit) },
    ];
  }
  return [{ name: seedNameFromPiece(pieceId), mesh: seedMeshFromPiece(pieceId, edit) }];
}

/** The conventional part name the "Door" cook treats as the toggleable leaf
 *  (req_1864) — matched case-insensitively so a renamed/detailed part still
 *  reads as the door if it keeps "door" + "leaf" in the name. */
export const DOOR_LEAF_PART_NAME = 'Door Leaf';
export function isDoorLeafPartName(name: string | undefined): boolean {
  return name !== undefined && /door.*leaf/i.test(name);
}
