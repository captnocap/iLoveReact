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
