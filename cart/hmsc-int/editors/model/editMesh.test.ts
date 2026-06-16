// editMesh.test.ts — pins the Studio's editable-mesh keystone (req_0950): the
// topology (verts/faces/edges), the lowering to GeometryData, the shape
// constructors, and the concave-quad Auto-Fix guard (req_0949). Pure + headless.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import {
  addMount, addMountReflections, updateMountMirrored, cuboid, cutMeshByPlane, cylinder, deleteFaces, editMeshToGeometry, extrudeEdge, extrudeFace, faceNormal, faceCentroid, facesUsingEdges, facesUsingVerts, facesWithTag,
  bridgeEdges, clampSides, clearPivot, cone, createFaceFromEdges, createFaceFromVerts, findConcaveFaces, hasPivot, isFaceConcave, jointTravelDegrees, loopCut, loopCutRange, loopCutPositions, meshBoundsCenter, meshEdges, mountsCompatible, pivotOf, plane, pyramid, removeMount, renameMount, rotateVerts, scaleVerts,
  flipFace, mirrorEdit, mirrorEditAxes, mirrorPartners, setFaceGlass, symmetrize, symmetryReport, setPivot, splitConcaveFaces, splitQuad, tagOneFace, translateVerts, unwrap, unwrapMesh, updateMount, storedUVLayout, vertsBounds,
  vertsCentroid, vertsHalfExtent,
  type EditMesh, type MountPoint, type V3,
} from './editMesh';

function approx(a: number, b: number, t = 1e-6): boolean { return Math.abs(a - b) < t; }

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

test('a cuboid is 8 verts, 6 quad faces, 12 unique edges', () => {
  const box = cuboid(2, 2, 2);
  assertEqual(box.verts.length, 8, 'cuboid vert count');
  assertEqual(box.faces.length, 6, 'cuboid face count');
  assert(box.faces.every((f) => f.loop.length === 4), 'every cuboid face is a quad');
  assertEqual(meshEdges(box).length, 12, 'cuboid unique edge count');
});

test('cuboid face normals all point outward (away from the centered origin)', () => {
  const box = cuboid(2, 4, 6);
  for (const face of box.faces) {
    const n = faceNormal(box, face);
    const c = faceCentroid(box, face);
    assert(dot(n, c) > 0, 'normal points the same way as the face centroid from origin');
  }
});

test('lowering a cuboid gives 36 fan-triangulated soup verts', () => {
  const geo = editMeshToGeometry(cuboid(2, 2, 2));
  // 6 quads × 2 tris × 3 verts = 36
  assertEqual(geo.count, 36, 'cuboid soup vert count');
  assertEqual(geo.positions.length, 36 * 8, 'cuboid soup float count');
  assert(geo.bounds.radius > 0, 'bounds radius is set');
  assert(geo.count % 3 === 0, 'soup is whole triangles');
});

test('a cylinder lowers to a valid, whole-triangle soup', () => {
  const cyl = cylinder(1, 2, 12);
  assertEqual(cyl.verts.length, 12 * 2, 'cylinder vert count');
  // 12 side quads + 2 caps
  assertEqual(cyl.faces.length, 12 + 2, 'cylinder face count');
  const geo = editMeshToGeometry(cyl);
  assert(geo.count % 3 === 0, 'soup is whole triangles');
  assert(geo.bounds.radius > 0, 'bounds radius is set');
  for (const face of cyl.faces) {
    const n = faceNormal(cyl, face);
    const c = faceCentroid(cyl, face);
    assert(dot(n, c) > 0, 'cylinder face normal points outward');
  }
});

test('a convex quad is not concave; a reflex quad is', () => {
  const convex: EditMesh = {
    verts: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
  assert(!isFaceConcave(convex, convex.faces[0]), 'square is convex');

  // third corner pulled inside the diagonal → reflex at vertex 2 → concave
  const concave: EditMesh = {
    verts: [[0, 0, 0], [2, 0, 0], [0.5, 0, 0.5], [0, 0, 2]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
  assert(isFaceConcave(concave, concave.faces[0]), 'pulled-in corner is concave');
});

test('splitQuad fixes a concave quad into two non-concave tris', () => {
  const concave: EditMesh = {
    verts: [[0, 0, 0], [2, 0, 0], [0.5, 0, 0.5], [0, 0, 2]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
  assertEqual(findConcaveFaces(concave).length, 1, 'one concave face before');
  const fixed = splitQuad(concave, 0);
  assertEqual(fixed.faces.length, 2, 'quad became two faces');
  assert(fixed.faces.every((f) => f.loop.length === 3), 'both results are triangles');
  assertEqual(findConcaveFaces(fixed).length, 0, 'no concave faces after');
});

test('splitConcaveFaces clears every offender at once', () => {
  // two quads, one convex one concave
  const m: EditMesh = {
    verts: [
      [0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2],          // convex quad 0..3
      [3, 0, 0], [5, 0, 0], [3.5, 0, 0.5], [3, 0, 2],      // concave quad 4..7
    ],
    faces: [{ loop: [0, 1, 2, 3] }, { loop: [4, 5, 6, 7] }],
  };
  assertEqual(findConcaveFaces(m).length, 1, 'one offender before');
  const fixed = splitConcaveFaces(m);
  assertEqual(findConcaveFaces(fixed).length, 0, 'no offenders after');
  // the convex quad survives whole; the concave one became 2 tris
  assert(fixed.faces.some((f) => f.loop.length === 4), 'convex quad untouched');
});

test('a plug seats only in a same-typed socket (the tire-vs-spoiler rule)', () => {
  const axlePlug: MountPoint = { name: 'hub', type: 'axle', kind: 'plug', position: [0, 0, 0], size: 0.3 };
  const axleSocket: MountPoint = { name: 'axle_fl', type: 'axle', kind: 'socket', position: [1, 0, 1], size: 0.3 };
  const spoilerSocket: MountPoint = { name: 'spoiler', type: 'spoiler', kind: 'socket', position: [0, 1, -1] };
  assert(mountsCompatible(axlePlug, axleSocket), 'matching type + size seats');
  assert(!mountsCompatible(axlePlug, spoilerSocket), 'a tire does not go where a spoiler goes');
});

test('mount matching respects polarity and size tolerance', () => {
  const plug: MountPoint = { name: 'hub', type: 'axle', kind: 'plug', position: [0, 0, 0], size: 0.30 };
  const socketOk: MountPoint = { name: 's', type: 'axle', kind: 'socket', position: [0, 0, 0], size: 0.3004 };
  const socketTooBig: MountPoint = { name: 's', type: 'axle', kind: 'socket', position: [0, 0, 0], size: 0.5 };
  const otherPlug: MountPoint = { ...plug, kind: 'plug' };
  assert(mountsCompatible(plug, socketOk), 'within tolerance seats');
  assert(!mountsCompatible(plug, socketTooBig), 'size mismatch rejects');
  assert(!mountsCompatible(plug, otherPlug), 'plug into plug never seats');
});

test('unwrapMesh box-projects a cube into 6 face rects sized on the units basis', () => {
  // a 1 m cube at 16 units/m → each face is 16×16 units.
  const layout = unwrapMesh(cuboid(1, 1, 1), 16);
  assertEqual(layout.faces.length, 6, 'six faces unwrapped');
  for (const f of layout.faces) {
    assert(Math.abs(f.rect.w - 16) < 1e-6, 'face is 16 units wide');
    assert(Math.abs(f.rect.h - 16) < 1e-6, 'face is 16 units tall');
    assertEqual(f.poly.length, 4, 'each unwrapped face keeps its 4 corners');
  }
  // two faces per axis (the ± pair); both signs appear.
  const byAxis: Record<string, Set<number>> = { x: new Set(), y: new Set(), z: new Set() };
  for (const f of layout.faces) byAxis[f.axis].add(f.sign);
  for (const ax of ['x', 'y', 'z']) {
    assert(byAxis[ax].has(1) && byAxis[ax].has(-1), `${ax} has both a + and − face`);
  }
  assert(layout.width > 0 && layout.height > 0, 'atlas has a positive extent');
});

test('unwrapMesh packs faces without overlap', () => {
  const layout = unwrapMesh(cuboid(2, 1, 3), 16);
  const rs = layout.faces.map((f) => f.rect);
  for (let i = 0; i < rs.length; i += 1) {
    for (let j = i + 1; j < rs.length; j += 1) {
      const a = rs[i], b = rs[j];
      const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert(disjoint, `rects ${i} and ${j} do not overlap`);
    }
  }
});

test('unwrapMesh rect dimensions track the live mesh size', () => {
  // a non-cube box: +Z face footprint is width×height = (2·16)×(1·16) = 32×16.
  const layout = unwrapMesh(cuboid(2, 1, 3), 16);
  const zFace = layout.faces.find((f) => f.axis === 'z');
  assert(!!zFace, 'a z-axis face exists');
  assert(Math.abs(zFace!.rect.w - 32) < 1e-6, 'z face width = 2 m × 16 = 32 u');
  assert(Math.abs(zFace!.rect.h - 16) < 1e-6, 'z face height = 1 m × 16 = 16 u');
});

test('vertsCentroid + vertsHalfExtent measure a selection (the gizmo anchor)', () => {
  const box = cuboid(2, 2, 2); // verts at ±1 on each axis, centered at origin
  const all = box.verts.map((_, i) => i);
  const c = vertsCentroid(box, all);
  assert(Math.hypot(c[0], c[1], c[2]) < 1e-9, 'centroid of a centered cube is the origin');
  // the +X face loop [1,5,6,2] sits at x=+1 → its centroid is on +X.
  const faceVerts = box.faces.find((f) => Math.abs(faceNormal(box, f)[0] - 1) < 1e-6)!.loop;
  const fc = vertsCentroid(box, faceVerts);
  assert(Math.abs(fc[0] - 1) < 1e-6, '+X face centroid sits at x=+1');
  assertEqual(vertsHalfExtent(box, all, c, 0), 1, 'half-extent on X is 1 for a 2-wide cube');
});

test('translateVerts moves only the selected verts (the MOVE tool)', () => {
  const box = cuboid(2, 2, 2);
  const top = box.faces.find((f) => Math.abs(faceNormal(box, f)[1] - 1) < 1e-6)!.loop;
  const moved = translateVerts(box, top, [0, 3, 0]);
  // input untouched (pure)
  assert(box.verts.some((v) => Math.abs(v[1] - 1) < 1e-9), 'original top still at y=1');
  // every top vert rose by 3; the others stayed
  for (const i of top) assert(Math.abs(moved.verts[i][1] - 4) < 1e-6, 'top vert rose to y=4');
  const bottomY = moved.verts.filter((_, i) => !top.includes(i)).every((v) => v[1] < 1.001);
  assert(bottomY, 'non-selected verts did not move');
  assertEqual(moved.faces.length, box.faces.length, 'topology unchanged by a move');
});

test('scaleVerts scales about the anchor per-axis (the RESIZE tool)', () => {
  const box = cuboid(2, 2, 2);
  const all = box.verts.map((_, i) => i);
  const anchor = vertsCentroid(box, all); // origin
  const wider = scaleVerts(box, all, anchor, [2, 1, 1]);
  for (const v of wider.verts) {
    assert(Math.abs(Math.abs(v[0]) - 2) < 1e-6, 'X doubled to ±2');
    assert(Math.abs(Math.abs(v[1]) - 1) < 1e-6, 'Y unchanged at ±1');
  }
  // anchored scaling preserves the centroid
  const c2 = vertsCentroid(wider, all);
  assert(Math.hypot(c2[0], c2[1], c2[2]) < 1e-6, 'centroid stays put under anchored scale');
});

test('loopCutPositions: default offset = equal slabs; raising it shrinks the −side', () => {
  // span 0..16, default offset = size/2 = 8.
  const one = loopCutPositions(0, 16, 1, 8);
  assertEqual(one.length, 1, 'one cut');
  assert(approx(one[0], 8), '1 cut at center');
  const two = loopCutPositions(0, 16, 2, 8);
  assert(approx(two[0], 16 / 3) && approx(two[1], 32 / 3), '2 cuts → equal thirds at default offset');
  // raise the offset → the comb shifts toward +axis, shrinking the −side slab
  const shifted = loopCutPositions(0, 16, 2, 9);
  assert(shifted[0] < two[0] && approx(shifted[1] - shifted[0], two[1] - two[0]), 'interior spacing preserved, −side slab smaller');
});

test('cutMeshByPlane splits the crossed faces, leaves the parallel caps', () => {
  const box = cuboid(2, 2, 2); // x∈[-1,1]; plane at x=0 crosses the 4 ±Y/±Z faces
  const cut = cutMeshByPlane(box, 0, 0);
  assertEqual(cut.faces.length, 6 + 4, '4 straddling faces split → +4 faces');
  assertEqual(cut.verts.length, 8 + 4, '4 new shared verts on the cut ring');
  assert(cut.faces.every((f) => f.loop.length >= 3), 'every face stays a valid polygon');
  // the new verts all sit on the plane x=0
  const onPlane = cut.verts.filter((v) => approx(v[0], 0)).length;
  assertEqual(onPlane, 4, 'the 4 inserted verts lie on x=0');
  // lowering still yields whole triangles
  assert(editMeshToGeometry(cut).count % 3 === 0, 'soup is whole triangles after a cut');
});

test('loopCut adds N rings and keeps a clean, lowerable mesh', () => {
  const box = cuboid(2, 2, 2);
  const cut = loopCut(box, 1, 3, 1); // 3 cuts ⟂ Y
  assertEqual(cut.verts.length, 8 + 3 * 4, '3 rings × 4 verts added');
  // 4 side faces (±X/±Z) each split into 4 → 16; 2 caps (±Y) untouched → 18
  assertEqual(cut.faces.length, 18, '3 cuts → 18 faces');
  assert(cut.faces.every((f) => f.loop.length >= 3), 'all faces valid');
  assertEqual(findConcaveFaces(cut).length, 0, 'loop cut introduces no concave faces');
});

test('a face tag follows its pieces through a loop cut (selection persist)', () => {
  const box = cuboid(2, 2, 2);
  // tag the +Y top face (normal +Y).
  const topIdx = box.faces.findIndex((f) => Math.abs(faceNormal(box, f)[1] - 1) < 1e-6);
  const tagged = tagOneFace(box, topIdx, 1);
  assertEqual(facesWithTag(tagged, 1).length, 1, 'exactly one face tagged at start');
  // a cut ⟂ Y is parallel to the top → does not split it → still one tagged face.
  assertEqual(facesWithTag(loopCut(tagged, 1, 1, 1), 1).length, 1, 'parallel cut leaves the tagged face whole');
  // a cut ⟂ X crosses the top → splits it → two tagged pieces.
  assertEqual(facesWithTag(loopCut(tagged, 0, 1, 1), 1).length, 2, 'crossing cut → the tag rides both halves');
});

// ── Part 5a: stored, stable, interpolating UVs ─────────────────────────────────

test('a fresh cuboid maps EVERY face to the full unit square (Blockbench base cube)', () => {
  // USER req_1004: the UV MESH (not the texture) — every face samples the whole
  // texture, so its UV bbox is exactly [0,0]–[1,1]. Clicking any face shows the
  // same full square. The box-net is the downstream "create texture" step.
  const box = cuboid(2, 1, 3);
  for (const f of box.faces) {
    assertEqual(f.uv!.length, f.loop.length, 'a UV per corner');
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of f.uv!) { minU = Math.min(minU, u); minV = Math.min(minV, v); maxU = Math.max(maxU, u); maxV = Math.max(maxV, v); }
    assert(approx(minU, 0) && approx(minV, 0) && approx(maxU, 1) && approx(maxV, 1), 'the face fills the full unit square');
  }
});

test('a vertex move leaves the stored UV byte-for-byte unchanged (the Blockbench law)', () => {
  const box = cuboid(2, 2, 2);
  const before = JSON.stringify(box.faces.map((f) => f.uv));
  const moved = scaleVerts(translateVerts(box, [4, 5, 6, 7], [0, 2, 0]), [0, 1, 2, 3], [0, -1, 0], [1, 1, 2]);
  assertEqual(JSON.stringify(moved.faces.map((f) => f.uv)), before, 'geometry edits never touch UVs');
});

test('a cut subdivides WITHIN the parent island: new corner UV = the edge lerp', () => {
  const box = cuboid(2, 2, 2);
  // the -Z front face [0,4,5,1] straddles a plane at x=0; cut it.
  const cut = cutMeshByPlane(box, 0, 0);
  assert(cut.faces.every((f) => f.loop.length < 3 || (Array.isArray(f.uv) && f.uv!.length === f.loop.length)), 'every split child keeps a full UV loop');
  // a vert created exactly on x=0 (the cut) must carry the midpoint UV of the
  // edge it split — find one and verify it lies between its neighbors in the loop.
  const child = cut.faces.find((f) => f.uv && f.loop.some((vi) => approx(cut.verts[vi][0], 0)))!;
  assert(!!child, 'a cut face exists');
  const k = child.loop.findIndex((vi) => approx(cut.verts[vi][0], 0));
  const prev = child.uv![(k + child.loop.length - 1) % child.loop.length];
  const here = child.uv![k];
  const next = child.uv![(k + 1) % child.loop.length];
  // the cut UV sits on the segment between one neighbor pair (collinear within eps).
  const onSeg = (a: number[], b: number[], p: number[]) => approx((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]), 0, 1e-4);
  assert(onSeg(prev, next, here) || here.every((c) => c >= -1e-9 && c <= 1 + 1e-9), 'the cut UV is interpolated, normalized, in-island');
});

test('storedUVLayout reads the stored UVs (stable), not a live projection', () => {
  const box = cuboid(2, 1, 3);
  const a = storedUVLayout(box, 16);
  assertEqual(a.faces.length, 6, 'six islands from the six stored faces');
  assertEqual(a.width, 16, 'the atlas is the fixed texture square');
  // move geometry — the stored-UV layout must NOT change (unlike unwrapMesh).
  const moved = translateVerts(box, [4, 5, 6, 7], [0, 3, 0]);
  const b = storedUVLayout(moved, 16);
  assertEqual(JSON.stringify(b.faces.map((f) => f.poly)), JSON.stringify(a.faces.map((f) => f.poly)), 'islands are invariant under a vertex move');
});

test('unwrap() (the "create texture" step) lays the box into a contiguous net', () => {
  // the box net is the TEXTURE layout, applied by unwrap() — NOT the default UV.
  const lay = storedUVLayout(unwrap(cuboid(2, 2, 2)), 16);
  const by = (a: 'x' | 'y' | 'z', s: 1 | -1) => lay.faces.find((f) => f.axis === a && f.sign === s)!;
  const up = by('y', 1), front = by('z', -1), left = by('x', -1);
  assert(approx(up.rect.x, front.rect.x) && approx(up.rect.w, front.rect.w), 'up + front share a column');
  assert(approx(up.rect.y + up.rect.h, front.rect.y) || approx(front.rect.y + front.rect.h, up.rect.y), 'up + front touch — contiguous');
  assert(approx(front.rect.x + front.rect.w, left.rect.x), 'front + left are adjacent in the side strip');
});

test('re-unwrap rewrites UVs from the current geometry on demand', () => {
  const box = cuboid(2, 2, 2);
  const stretched = scaleVerts(box, [0, 1, 2, 3, 4, 5, 6, 7], [0, 0, 0], [3, 1, 1]);
  const re = unwrap(stretched);
  assert(re.faces.every((f) => Array.isArray(f.uv) && f.uv!.length === f.loop.length), 're-unwrap assigns a full UV set');
});

test('a second loop cut WITHIN a cut half subdivides it (req_1006: not a no-op)', () => {
  const box = cuboid(2, 2, 2); // Y ∈ [-1, 1]
  const cut1 = loopCut(box, 1, 1, 1); // one cut at Y=0
  const after1 = cut1.faces.length;
  // a SECOND cut bounded to the bottom half [-1,0] lands at Y=-0.5 → real split.
  const cut2 = loopCutRange(cut1, 1, -1, 0, 1, 0.5);
  assert(cut2.faces.length > after1, 'a cut within the sub-span adds faces — it is visible');
  // the OLD (buggy) behavior: a cut over the WHOLE range at the default offset
  // lands on the existing Y=0 plane → no new geometry (what the user saw).
  const noop = loopCutRange(cut1, 1, -1, 1, 1, 1);
  assertEqual(noop.faces.length, after1, 'the whole-range cut at the existing plane is a no-op');
});

test('cuts on axis A then a centered cut on axis B lands centered on the sub-face (req_1010)', () => {
  // Reproduce the Studio flow: select the front face, loop-cut it 4× along X
  // (each time on the kept −side sub-piece), then 1× along Y. The Y cut is the
  // FIRST on its axis for that sub-face, so it must land CENTERED — not skewed to
  // an edge as if it continued the X sequence (the offset must re-center per axis).
  const faceSpan = (m: EditMesh, fi: number, axis: 0 | 1 | 2): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    for (const vi of m.faces[fi].loop) { const v = m.verts[vi]; if (v[axis] < lo) lo = v[axis]; if (v[axis] > hi) hi = v[axis]; }
    return [lo, hi];
  };
  // cut the tagged face centered on `axis`, return the kept −side tagged piece.
  const cutAndKeep = (m: EditMesh, fi: number, axis: 0 | 1 | 2): { mesh: EditMesh; faceIndex: number } => {
    const tagged = tagOneFace(m, fi, 1);
    const [lo, hi] = faceSpan(tagged, fi, axis);
    const cut = loopCutRange(tagged, axis, lo, hi, 1, (hi - lo) / 2); // centered
    const tags = facesWithTag(cut, 1);
    let best = tags[0], bestC = Infinity;
    for (const i of tags) { const c = faceCentroid(cut, cut.faces[i])[axis]; if (c < bestC) { bestC = c; best = i; } }
    return { mesh: cut, faceIndex: best };
  };

  let cur = { mesh: cuboid(2, 2, 2), faceIndex: 2 }; // faces[2] = −Z front face
  for (let i = 0; i < 4; i += 1) cur = cutAndKeep(cur.mesh, cur.faceIndex, 0); // 4 cuts on X
  const [xlo, xhi] = faceSpan(cur.mesh, cur.faceIndex, 0);
  assert(xhi - xlo < 0.2, 'after 4 X cuts the kept sub-face is narrow on X');
  const [ylo, yhi] = faceSpan(cur.mesh, cur.faceIndex, 1);
  assert(approx(ylo, -1) && approx(yhi, 1), 'the sub-face is still FULL height on Y');

  // the first Y cut, centered on the sub-face's Y span.
  const yCut = cutAndKeep(cur.mesh, cur.faceIndex, 1);
  const tags = facesWithTag(yCut.mesh, 1);
  assertEqual(tags.length, 2, 'the Y cut splits the selected sub-face into two halves');
  const cys = tags.map((i) => faceCentroid(yCut.mesh, yCut.mesh.faces[i])[1]).sort((a, b) => a - b);
  assert(approx(cys[0], -0.5, 1e-3) && approx(cys[1], 0.5, 1e-3), 'both halves are centered (±0.5) — the cut is mid-face, not edge-skewed');
});

test('dragging a corner inward buckles a cube face → the guard detects it (req_1016)', () => {
  // mirrors the gizmo path: a move that pulls one shared corner across the face
  // diagonal turns a quad reflex. The Auto-Fix guard runs findConcaveFaces on the
  // committed mesh — this is exactly what must be non-empty so the alert fires.
  const box = cuboid(2, 2, 2);
  assertEqual(findConcaveFaces(box).length, 0, 'a clean cube has no concave faces');
  // vert 6 = [1,1,1] is a corner of the +Y top face; pull it inward past center.
  const buckled = translateVerts(box, [6], [-1.6, 0, -1.6]);
  assert(findConcaveFaces(buckled).length > 0, 'the buckled quad is flagged concave (the alert would fire)');
  // and Split Quads clears it (the recommended resolution).
  assertEqual(findConcaveFaces(splitConcaveFaces(buckled)).length, 0, 'Split Quads resolves every offender');
});

test('extrudeFace caps + walls a face, keeps the cap at the same index (req_1015)', () => {
  const box = cuboid(2, 2, 2); // top face = index 0, normal +Y, y_top = 1
  const ex = extrudeFace(box, 0, 0.5);
  assertEqual(ex.verts.length, 12, 'extrude adds the 4 cap verts (8 → 12)');
  assertEqual(ex.faces.length, 10, 'original 6 → cap (replaces) + 4 side walls = 10');
  // the cap stays at index 0 (selection follows it) and moved out by the distance.
  const cc = faceCentroid(ex, ex.faces[0]);
  assert(approx(cc[0], 0) && approx(cc[1], 1.5) && approx(cc[2], 0), 'cap centroid is the face pushed +0.5 along +Y');
  assert(approx(faceNormal(ex, ex.faces[0])[1], 1), 'cap still faces +Y (outward)');
});

test('extrude: cap inherits the UV, side walls get a full square, normals point out (req_1015)', () => {
  const box = cuboid(2, 2, 2);
  const ex = extrudeFace(box, 0, 0.5);
  assertEqual(JSON.stringify(ex.faces[0].uv), JSON.stringify(box.faces[0].uv), 'the cap inherits the original face UV byte-for-byte');
  for (let i = 6; i < 10; i += 1) {
    assert(Array.isArray(ex.faces[i].uv) && ex.faces[i].uv!.length === 4, 'each side wall has a 4-corner UV');
    const n = faceNormal(ex, ex.faces[i]);
    assert(approx(Math.abs(n[1]), 0, 1e-6), 'a side wall is vertical (normal has no Y)');
    const c = faceCentroid(ex, ex.faces[i]);
    assert(n[0] * c[0] + n[2] * c[2] > 0, 'the side-wall normal points away from the center axis (outward)');
  }
});

test('extrude THEN moving the cap (the in/out drag) never changes any UV (req_1015)', () => {
  // the user's law: the extrude op changes UV; pulling the cap in/out does NOT.
  const ex = extrudeFace(cuboid(2, 2, 2), 0, 0.5);
  const before = JSON.stringify(ex.faces.map((f) => f.uv ?? null));
  const pulledOut = translateVerts(ex, ex.faces[0].loop, [0, 1.2, 0]); // drag the cap further out
  const pushedIn = translateVerts(ex, ex.faces[0].loop, [0, -2.0, 0]);  // drag it inward (inset)
  assertEqual(JSON.stringify(pulledOut.faces.map((f) => f.uv ?? null)), before, 'pulling the cap out leaves every UV identical');
  assertEqual(JSON.stringify(pushedIn.faces.map((f) => f.uv ?? null)), before, 'pushing the cap in (inset) leaves every UV identical');
});

test('extrude with a negative distance insets (cap goes below the surface) (req_1015)', () => {
  const ex = extrudeFace(cuboid(2, 2, 2), 0, -0.5); // inward
  assertEqual(ex.faces.length, 10, 'inset still builds cap + 4 walls');
  assert(approx(faceCentroid(ex, ex.faces[0])[1], 0.5), 'the cap sits 0.5 BELOW the +1 top surface (inset)');
});

test('extrudeEdge pulls a new edge off + bridges it with one quad (req_1163)', () => {
  const box = cuboid(2, 2, 2);
  const E = meshEdges(box);
  const ex = extrudeEdge(box, E[0], 0.5);
  assertEqual(ex.verts.length, 10, 'extrude adds the 2 new edge verts (8 → 10)');
  assertEqual(ex.faces.length, 7, 'original 6 faces + 1 bridge quad = 7');
  const q = ex.faces[6];
  assert(Array.isArray(q.uv) && q.uv!.length === 4, 'the bridge quad gets a 4-corner square UV');
  // the new edge connects the two trailing verts and is offset by the distance.
  const a = E[0][0], b = E[0][1];
  const a2 = ex.verts[8], b2 = ex.verts[9];
  assert(approx(Math.hypot(a2[0] - ex.verts[a][0], a2[1] - ex.verts[a][1], a2[2] - ex.verts[a][2]), 0.5), 'the copy of vert a is pushed 0.5 out');
  assert(approx(Math.hypot(b2[0] - ex.verts[b][0], b2[1] - ex.verts[b][1], b2[2] - ex.verts[b][2]), 0.5), 'the copy of vert b is pushed 0.5 out');
  // the bridge is wound to traverse the shared edge OPPOSITE its neighbor face, so
  // both face outward (a normal "away from center" test is degenerate here — the
  // quad normal is always perpendicular to the bisector extrude direction).
  const adj = facesUsingEdges(box, [E[0]])[0]; const af = box.faces[adj].loop;
  const fwd = af.some((v, i) => v === a && af[(i + 1) % af.length] === b); // does the neighbor run a→b?
  const ql = q.loop;
  const bridgeFwd = ql.some((v, i) => v === a && ql[(i + 1) % ql.length] === b);
  assert(fwd !== bridgeFwd, 'the bridge quad traverses the shared edge opposite the neighbor face (consistent winding)');
  // the new edge surfaces in meshEdges so a selection can follow it.
  assert(meshEdges(ex).some((e) => e[0] === 8 && e[1] === 9), 'the offset edge (8,9) is a real mesh edge');
});

test('extrudeEdge then dragging the new edge never rewrites a UV (req_1163)', () => {
  const box = cuboid(2, 2, 2);
  const ex = extrudeEdge(box, meshEdges(box)[0], 0.5);
  const before = JSON.stringify(ex.faces.map((f) => f.uv ?? null));
  const pulled = translateVerts(ex, [8, 9], [0, 1, 0]); // drag the new edge further out
  assertEqual(JSON.stringify(pulled.faces.map((f) => f.uv ?? null)), before, 'moving the new edge leaves every UV identical');
});

test('createFaceFromEdges lofts a 4-edge side to a 2-edge side (req_1164)', () => {
  // P: a 4-edge chain (5 verts) along +X at z=0; Q: a 2-edge chain (3 verts) at z=2.
  const verts: V3[] = [
    [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], // 0..4  P (4 edges)
    [0, 0, 2], [2, 0, 2], [4, 0, 2],                       // 5..7  Q (2 edges)
  ];
  const m: EditMesh = { verts, faces: [], mounts: [] };
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7]];
  const out = createFaceFromEdges(m, edges)!;
  assert(out && out !== m, 'a face bridges the two unequal sides (no longer rejected)');
  assert(out.faces.length >= 4, 'the unequal loft is a triangle strip (≥4 tris span 4 + 2 edges)');
  assert(out.faces.every((f) => f.loop.length === 3), 'an unequal loft emits triangles');
  // every loft tri uses only the selected verts and faces the SAME way (consistent winding).
  const used = new Set<number>(); out.faces.forEach((f) => f.loop.forEach((v) => used.add(v)));
  assert([...used].every((v) => v <= 7), 'the loft only uses the selected boundary verts');
  const n0 = faceNormal(out, out.faces[0]);
  assert(out.faces.every((f) => faceNormal(out, f)[0] * n0[0] + faceNormal(out, f)[1] * n0[1] + faceNormal(out, f)[2] * n0[2] > 0), 'all loft faces share an orientation');
});

test('createFaceFromEdges: two equal single edges → one quad (bridgeEdges parity) (req_1164)', () => {
  const verts: V3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]];
  const m: EditMesh = { verts, faces: [], mounts: [] };
  const out = createFaceFromEdges(m, [[0, 1], [2, 3]])!; // two parallel disjoint edges
  assertEqual(out.faces.length, 1, 'two equal-length single-edge chains loft to ONE quad');
  assertEqual(out.faces[0].loop.length, 4, 'the bridge is a quad, not split into tris');
});

test('createFaceFromEdges fills a closed 4-edge loop as one quad (req_1164)', () => {
  const verts: V3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]];
  const m: EditMesh = { verts, faces: [], mounts: [] };
  const out = createFaceFromEdges(m, [[0, 1], [1, 2], [2, 3], [3, 0]])!; // a closed ring
  assertEqual(out.faces.length, 1, 'a closed loop fills as a single face');
  assertEqual(out.faces[0].loop.length, 4, 'the 4-vert ring is one quad n-gon');
});

test('createFaceFromEdges rejects a branchy / single-open-chain selection (req_1164)', () => {
  const verts: V3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 0, 1]];
  const m: EditMesh = { verts, faces: [], mounts: [] };
  assertEqual(createFaceFromEdges(m, [[0, 1], [1, 2], [1, 3]]), null, 'a junction (vert 1 in 3 edges) is rejected');
  assertEqual(createFaceFromEdges(m, [[0, 1], [1, 2]]), null, 'a lone open chain (no second side, not closed) is rejected');
});

test('flipFace reverses winding so the face normal flips (req_1182)', () => {
  const box = cuboid(2, 2, 2);
  const n0 = faceNormal(box, box.faces[0]); // +Y top
  const f = flipFace(box, 0);
  const n1 = faceNormal(f, f.faces[0]);
  assert(approx(n1[0], -n0[0]) && approx(n1[1], -n0[1]) && approx(n1[2], -n0[2]), 'the flipped normal is negated');
  assertEqual(f.faces[0].loop.length, box.faces[0].loop.length, 'loop length unchanged (only reversed)');
  // each corner still pairs with ITS uv (loop + uv reversed together)
  assertEqual(JSON.stringify([...f.faces[0].uv!].reverse()), JSON.stringify(box.faces[0].uv), 'uv reversed in lockstep with the loop');
});

test('setFaceGlass marks faces, and editMeshToGeometry can split glass vs opaque (req_1181)', () => {
  const box = cuboid(2, 2, 2);
  const g = setFaceGlass(box, [0], true);
  assert(g.faces[0].glass === true, 'face 0 is now glass');
  assert(!g.faces[1].glass, 'other faces untouched');
  const full = editMeshToGeometry(g);
  const opaque = editMeshToGeometry(g, (face) => !face.glass);
  const glass = editMeshToGeometry(g, (face) => !!face.glass);
  assert(glass.count > 0, 'the glass pass is non-empty');
  assertEqual(opaque.count + glass.count, full.count, 'opaque + glass partition the whole mesh, no overlap');
  const off = setFaceGlass(g, [0], false);
  assert(!off.faces[0].glass, 'toggling glass off clears the flag (no lingering false)');
  assert(!('glass' in off.faces[0]) || off.faces[0].glass === undefined, 'cleared glass is undefined, not false');
});

test('mirrorEdit reflects a moved vert onto its X-partner — pull left, right follows (req_1183)', () => {
  const box = cuboid(2, 2, 2); // verts at x = ±1; partner across x=0 is the ∓1 twin
  const partners = mirrorPartners(box, 0);
  // every vert has a real twin (a symmetric box), none is its own partner
  assert(partners.every((p, i) => p !== i && approx(box.verts[p][0], -box.verts[i][0])), 'each vert pairs with its −x twin');
  // grab the +x face verts, pull them further +x; the −x twins must move −x by the same.
  const plusX = box.verts.map((v, i) => i).filter((i) => box.verts[i][0] > 0);
  const moved = translateVerts(box, plusX, [0.5, 0.2, 0]);
  const sym = mirrorEdit(box, moved, plusX, 0);
  for (const i of plusX) {
    const p = partners[i];
    assert(approx(sym.verts[p][0], -sym.verts[i][0]), 'partner x is the negative of the moved vert x (mirrored pull)');
    assert(approx(sym.verts[p][1], sym.verts[i][1]) && approx(sym.verts[p][2], sym.verts[i][2]), 'y/z follow identically');
  }
  // the moved side itself is untouched by the mirror pass
  for (const i of plusX) assert(approx(sym.verts[i][0], box.verts[i][0] + 0.5), 'the dragged side keeps its own move');
});

test('mirrorEditAxes mirrors across TWO planes incl. the diagonal twin (req_1186)', () => {
  // a symmetric box: pulling one corner mirrors to all 4 corners (X and Z planes).
  const box = cuboid(2, 2, 2);
  const corner = box.verts.map((v, i) => i).filter((i) => box.verts[i][0] > 0 && box.verts[i][2] > 0); // +x+z column
  const moved = translateVerts(box, corner, [0.5, 0, 0.5]); // pull it out diagonally
  const sym = mirrorEditAxes(box, moved, corner, [0, 2]); // mirror X and Z
  for (const i of corner) {
    const s = sym.verts[i];
    // the −x twin: (−x, y, z); the −z twin: (x, y, −z); the diagonal: (−x, y, −z)
    const find = (x: number, z: number) => sym.verts.findIndex((v) => approx(v[1], s[1]) && Math.sign(v[0]) === Math.sign(x) && Math.sign(v[2]) === Math.sign(z));
    const tx = find(-1, 1), tz = find(1, -1), td = find(-1, -1);
    assert(approx(sym.verts[tx][0], -s[0]) && approx(sym.verts[tx][2], s[2]), 'the −x twin mirrors X only');
    assert(approx(sym.verts[tz][0], s[0]) && approx(sym.verts[tz][2], -s[2]), 'the −z twin mirrors Z only');
    assert(approx(sym.verts[td][0], -s[0]) && approx(sym.verts[td][2], -s[2]), 'the diagonal twin mirrors both');
  }
});

test('mirrorEdit skips seam verts and both-sides selections (no double-apply) (req_1183)', () => {
  // a vert ON the plane is its own partner → left alone; selecting both twins → no mirror.
  const m: EditMesh = { verts: [[0, 0, 0], [1, 0, 0], [-1, 0, 0]], faces: [], mounts: [] };
  const partners = mirrorPartners(m, 0);
  assertEqual(partners[0], 0, 'the seam vert (x=0) is its own partner');
  const movedSeam = translateVerts(m, [0], [0, 1, 0]);
  assertEqual(JSON.stringify(mirrorEdit(m, movedSeam, [0], 0).verts), JSON.stringify(movedSeam.verts), 'moving a seam vert mirrors nothing');
  // selecting BOTH twins (1 and 2) and moving → mirror pass must not fight itself
  const both = translateVerts(m, [1, 2], [0, 0.3, 0]);
  assertEqual(JSON.stringify(mirrorEdit(m, both, [1, 2], 0).verts), JSON.stringify(both.verts), 'both-sides selection is left as-is');
});

test('vertsBounds measures a selection — face dims + a degenerate flat axis (req_1185)', () => {
  const box = cuboid(3, 2, 4); // x∈[-1.5,1.5] y∈[-1,1] z∈[-2,2]
  const all = vertsBounds(box, box.verts.map((_, i) => i));
  assert(approx(all.size[0], 3) && approx(all.size[1], 2) && approx(all.size[2], 4), 'whole-box size = its dims');
  // the +Y top face (loop [4,7,6,5]) is flat in Y → size.y ≈ 0, x/z span the face
  const top = vertsBounds(box, box.faces[0].loop);
  assert(approx(top.size[1], 0), 'a flat face has ~0 thickness on its normal axis');
  assert(approx(top.size[0], 3) && approx(top.size[2], 4), 'the face spans the full x/z extent');
  assertEqual(JSON.stringify(vertsBounds(box, []).size), JSON.stringify([0, 0, 0]), 'empty selection → zero box');
});

test('addMountReflections places a tire mount + its X/Z twins — all four wheels (req_1189)', () => {
  const base: EditMesh = { verts: [[0, 0, 0]], faces: [], mounts: [{ name: 'wheel', kind: 'socket', position: [1, -0.5, 2], axis: [1, 0, 0] }] };
  const four = addMountReflections(base, 'wheel', [0, 2]); // mirror X (L/R) + Z (front/back)
  assertEqual(four.mounts!.length, 4, 'original + 3 reflections = 4 wheel mounts');
  const at = (x: number, y: number, z: number) => four.mounts!.find((m) => approx(m.position[0], x) && approx(m.position[1], y) && approx(m.position[2], z));
  assert(!!at(1, -0.5, 2), 'the original FL stays');
  assert(!!at(-1, -0.5, 2), 'the X twin (FR) at −x');
  assert(!!at(1, -0.5, -2), 'the Z twin (RL) at −z');
  assert(!!at(-1, -0.5, -2), 'the diagonal twin (RR) at −x,−z');
  assert(approx(at(-1, -0.5, 2)!.axis![0], -1), 'the X-twin spin axis flips on X');
  assert(new Set(four.mounts!.map((m) => m.name)).size === 4, 'every mount name is unique');
});

test('updateMountMirrored moves a wheel mount and its partner in sync (req_1189)', () => {
  const m: EditMesh = { verts: [[0, 0, 0]], faces: [], mounts: [
    { name: 'fl', kind: 'socket', position: [1, 0, 2] }, { name: 'fr', kind: 'socket', position: [-1, 0, 2] },
  ] };
  const out = updateMountMirrored(m, 'fl', [1.5, 0, 2.2], [0]); // pull FL out along x
  const fl = out.mounts!.find((x) => x.name === 'fl')!, fr = out.mounts!.find((x) => x.name === 'fr')!;
  assert(approx(fl.position[0], 1.5) && approx(fl.position[2], 2.2), 'fl moved to the new spot');
  assert(approx(fr.position[0], -1.5) && approx(fr.position[2], 2.2), 'fr mirrored on x and followed z');
});

test('symmetrize rebuilds the far half as an exact mirror — drift is erased (req_1190)', () => {
  const box = cuboid(2, 2, 2);
  // drift ONE +x vert so the two halves diverge (the user's lone-vertex bug)
  const driftMe = box.verts.findIndex((v) => v[0] > 0);
  const asym = translateVerts(box, [driftMe], [0.3, 0.4, -0.2]);
  const sym = symmetrize(asym, 0, true); // keep +x, mirror onto −x
  // every off-centre vert now has an exact −x twin (perfect symmetry)
  for (const v of sym.verts) {
    if (Math.abs(v[0]) < 1e-6) continue;
    const twin = sym.verts.some((w) => approx(w[0], -v[0]) && approx(w[1], v[1]) && approx(w[2], v[2]));
    assert(twin, 'every off-centre vert has a mirror twin across x=0');
  }
  const b = vertsBounds(sym, sym.verts.map((_, i) => i));
  assert(approx(b.min[0], -b.max[0]), 'the x-bounds are symmetric about 0');
  // keeping the OTHER half drops the drift instead of mirroring it
  const symOther = symmetrize(asym, 0, false); // keep −x (the clean side)
  const bo = vertsBounds(symOther, symOther.verts.map((_, i) => i));
  assert(approx(bo.size[1], 2), 'keeping the clean −x half restores the original height (drift gone)');
});

test('symmetryReport flags a drifted vert and clears after symmetrize (req_1191)', () => {
  const box = cuboid(2, 2, 2);
  assertEqual(symmetryReport(box, 0).unmatched, 0, 'a clean box is symmetric across X (0 off)');
  assert(approx(symmetryReport(box, 0).center, 0), 'the centre is the bbox middle (x=0)');
  // drift one +x vert → it + its orphaned twin are now unmatched (2 off)
  const driftMe = box.verts.findIndex((v) => v[0] > 0);
  const asym = translateVerts(box, [driftMe], [0, 0.5, 0]);
  assert(symmetryReport(asym, 0).unmatched > 0, 'the drift is detected as not symmetric');
  // symmetrize repairs it → back to 0 off
  assertEqual(symmetryReport(symmetrize(asym, 0, false), 0).unmatched, 0, 'symmetrize restores symmetry (0 off)');
  // a centred box is NOT symmetric across Y here (it is, actually) but a shifted one is reported about its own centre
  assertEqual(symmetryReport(box, 1).unmatched, 0, 'symmetric about its Y centre too');
});

test('facesUsingVerts / facesUsingEdges resolve a selection to faces (req_1020)', () => {
  const box = cuboid(2, 2, 2);
  assertEqual(facesUsingVerts(box, [6]).length, 3, 'a cube corner vertex touches 3 faces');
  const E = meshEdges(box);
  assertEqual(facesUsingEdges(box, [E[0]]).length, 2, 'a cube edge is shared by exactly 2 faces');
});

test('deleteFaces removes faces, prunes orphaned verts, reindexes (req_1020)', () => {
  const box = cuboid(2, 2, 2);
  // one face: its verts are shared by neighbors, so nothing is pruned.
  const one = deleteFaces(box, [0]);
  assertEqual(one.faces.length, 5, 'one face removed');
  assertEqual(one.verts.length, 8, 'shared verts survive (still used by neighbors)');
  // the 3 faces around corner vert 6 [1,1,1] → that vert orphans and is pruned.
  const tri = deleteFaces(box, facesUsingVerts(box, [6]));
  assertEqual(tri.faces.length, 3, 'three corner faces removed');
  assert(!tri.verts.some((v) => v[0] === 1 && v[1] === 1 && v[2] === 1), 'the orphaned corner vert is pruned');
  assertEqual(tri.verts.length, 7, 'exactly one vertex pruned');
  assert(tri.faces.every((f) => f.loop.every((vi) => vi >= 0 && vi < tri.verts.length)), 'every loop reindexes into range');
  // delete everything → empty mesh.
  const none = deleteFaces(box, box.faces.map((_, i) => i));
  assertEqual(none.faces.length, 0, 'all faces gone');
  assertEqual(none.verts.length, 0, 'all verts pruned');
});

// ── Part 6: pivot points + joints (req_1025) ───────────────────────────────────

test('an unset pivot defaults to the bounds center (the centered cube → origin)', () => {
  const box = cuboid(2, 2, 2);
  assert(box.pivot === undefined, 'a fresh cuboid has no explicit pivot');
  const p = pivotOf(box);
  assert(Math.hypot(p[0], p[1], p[2]) < 1e-9, 'default pivot is the origin for a centered cube');
  // an off-center mesh → the bbox center, not the origin.
  const off: EditMesh = { verts: [[0, 0, 0], [4, 0, 0], [4, 2, 0], [0, 2, 0]], faces: [{ loop: [0, 1, 2, 3] }] };
  const c = meshBoundsCenter(off);
  assert(approx(c[0], 2) && approx(c[1], 1) && approx(c[2], 0), 'bounds center is the bbox midpoint');
});

test('a pivot is OPT-IN: a fresh part has none; a body keeps joints with no pivot (req_1054)', () => {
  const body = cuboid(2, 1, 4);
  assert(!hasPivot(body), 'a fresh part has NO pivot (a car body is joints-only)');
  // adding joints does not conjure a pivot.
  const rigged = addMount(body, { name: 'axle_fl', type: 'axle', kind: 'socket', position: [1, -0.5, 1] });
  assert(!hasPivot(rigged), 'a joints-only body still has no pivot');
  // a rotating part opts in, then can opt back out.
  const wheel = setPivot(cuboid(1, 1, 1), [0, 0, 0]);
  assert(hasPivot(wheel), 'setPivot opts the part into having a pivot');
  assert(!hasPivot(clearPivot(wheel)), 'clearPivot drops it back to no pivot');
  assert(clearPivot(body) === body, 'clearPivot on a pivot-less part is a no-op');
});

test('an unset pivot tracks geometry; a SET pivot is sticky under a vertex move', () => {
  const box = cuboid(2, 2, 2);
  // unset pivot follows the geometry (bounds center recomputes after a move).
  const raised = translateVerts(box, box.faces[0].loop, [0, 4, 0]); // lift the +Y top
  assert(pivotOf(raised)[1] > 0, 'unset pivot tracks the new bounds center');
  // set the pivot, then move geometry — the stored pivot must NOT move (Blockbench).
  const rigged = setPivot(box, [0, 1, 0]);
  assert(Array.isArray(rigged.pivot), 'setPivot stores the pivot');
  const moved = scaleVerts(translateVerts(rigged, [4, 5, 6, 7], [0, 3, 0]), [0, 1, 2, 3], [0, 0, 0], [2, 1, 1]);
  assert(JSON.stringify(moved.pivot) === JSON.stringify([0, 1, 0]), 'a set pivot never moves under geometry edits');
});

test('addMount / updateMount / removeMount author a joint as part data', () => {
  const wheel = cylinder(0.4, 0.3, 12);
  assert((wheel.mounts ?? []).length === 0, 'a fresh part has no joints');
  // a tire hub = an axle plug at the spin center, spinning about +X.
  const withHub = addMount(wheel, { name: 'hub', type: 'axle', kind: 'plug', position: [0, 0, 0], axis: [1, 0, 0], size: 0.3 });
  assertEqual(withHub.mounts!.length, 1, 'addMount appends a joint');
  assert(wheel.mounts === undefined, 'addMount is pure (the input is untouched)');
  // patch its position + axis (the gizmo drag / axis buttons).
  const moved = updateMount(withHub, 'hub', { position: [0, 0.05, 0], axis: [0, 1, 0] });
  assert(JSON.stringify(moved.mounts![0].position) === JSON.stringify([0, 0.05, 0]), 'updateMount moves the joint');
  assert(JSON.stringify(moved.mounts![0].axis) === JSON.stringify([0, 1, 0]), 'updateMount re-aims the spin axis');
  assertEqual(moved.mounts![0].type, 'axle', 'unpatched fields are preserved');
  // a no-match patch leaves the mesh unchanged (same ref).
  assert(updateMount(withHub, 'nope', { size: 9 }) === withHub, 'a no-match updateMount is a no-op');
  // remove it.
  assertEqual(removeMount(moved, 'hub').mounts!.length, 0, 'removeMount drops the joint');
  assert(removeMount(moved, 'nope') === moved, 'removing an absent joint is a no-op');
});

test('renameMount renames a joint (the binding key) and keeps names unique (req_1052)', () => {
  let m = addMount(addMount(cuboid(2, 1, 4), { name: 'joint_1', type: 'axle', kind: 'socket', position: [1, 0, 1] }), { name: 'joint_2', type: 'axle', kind: 'socket', position: [-1, 0, 1] });
  // a plain rename to a free name.
  m = renameMount(m, 'joint_1', 'back_left');
  assertEqual(m.mounts!.find((x) => x.position[0] === 1)!.name, 'back_left', 'the joint got the new name');
  // renaming the OTHER one onto the SAME name auto-suffixes (names are binding keys).
  m = renameMount(m, 'joint_2', 'back_left');
  assertEqual(m.mounts!.find((x) => x.position[0] === -1)!.name, 'back_left_2', 'a clash auto-suffixes, never collides');
  // no-ops: empty, unchanged, unknown.
  assert(renameMount(m, 'back_left', '  ') === m, 'an empty name is a no-op');
  assert(renameMount(m, 'back_left', 'back_left') === m, 'renaming to the same name is a no-op');
  assert(renameMount(m, 'ghost', 'x') === m, 'renaming an absent joint is a no-op');
});

test('a joint carries the rotation limit it imposes on its child (req_1025)', () => {
  // a shoulder = a socket joint that swings -90..+90 (180° of travel for the arm).
  const torso = addMount(cuboid(2, 3, 1), { name: 'shoulder_l', type: 'shoulder', kind: 'socket', position: [1, 1, 0], axis: [0, 0, 1], limit: { min: -90, max: 90 } });
  assertEqual(jointTravelDegrees(torso.mounts![0]), 180, 'a -90..+90 shoulder gives the pivot 180° to follow');
  // a tire axle = full rotation.
  const body = addMount(cuboid(2, 1, 4), { name: 'axle_fl', type: 'axle', kind: 'socket', position: [1, -0.5, 1], axis: [1, 0, 0], limit: { full: true } });
  assertEqual(jointTravelDegrees(body.mounts![0]), 360, 'a full joint (tire) spins freely');
  // a joint with no declared limit is treated as full (back-compat).
  const bare = addMount(cuboid(1, 1, 1), { name: 'j', type: 'axle', kind: 'socket', position: [0, 0, 0] });
  assertEqual(jointTravelDegrees(bare.mounts![0]), 360, 'an unlimited joint defaults to full');
  // patching the limit through updateMount (the rig panel's min/max/full controls).
  const tightened = updateMount(torso, 'shoulder_l', { limit: { min: -45, max: 30 } });
  assertEqual(jointTravelDegrees(tightened.mounts![0]), 75, 'updateMount re-limits the joint');
});

test('a joint still seats by type after authoring (mountsCompatible regression)', () => {
  const tire = addMount(cylinder(0.4, 0.3, 12), { name: 'hub', type: 'axle', kind: 'plug', position: [0, 0, 0], axis: [1, 0, 0], size: 0.3 });
  const body = addMount(cuboid(2, 1, 4), { name: 'axle_fl', type: 'axle', kind: 'socket', position: [1, -0.5, 1], axis: [1, 0, 0], size: 0.3 });
  assert(mountsCompatible(tire.mounts![0], body.mounts![0]), "the authored hub plug seats in the body's axle socket");
});

test('pivot + mounts survive lowering untouched (the bake reads them off the mesh)', () => {
  // editMeshToGeometry only consumes verts/faces — pivot/mounts ride the EditMesh
  // for composition/animation to read; lowering must not require or disturb them.
  const rigged = addMount(setPivot(cuboid(2, 2, 2), [0, 1, 0]), { name: 'hub', type: 'axle', kind: 'plug', position: [0, 1, 0], axis: [0, 1, 0] });
  const geo = editMeshToGeometry(rigged);
  assert(geo.count === 36 && geo.count % 3 === 0, 'a rigged cuboid still lowers to a clean soup');
  assert(JSON.stringify(rigged.pivot) === JSON.stringify([0, 1, 0]) && rigged.mounts!.length === 1, 'lowering left the rig data intact');
});

test('rotateVerts spins a selection about an axis to reorient it (req_1057)', () => {
  const box = cuboid(2, 4, 2); // tall on Y
  const all = box.verts.map((_, i) => i);
  const c = vertsCentroid(box, all); // origin
  // 90° about X (axis 0): a point at +Y goes to +Z (right-handed: y→z).
  const rot = rotateVerts(box, all, c, 0, Math.PI / 2);
  // the top-front-right vert [1,2,1] (after cuboid order) — just check a known one:
  // vert 4 = [-1, 2, -1] → about X by +90°: y,z = (2,-1) → (y c - z s, y s + z c) = (1, 2)
  const v = rot.verts[4];
  assert(approx(v[0], -1) && approx(v[1], 1) && approx(v[2], 2), '90° about X sends +Y toward +Z');
  // a full 360° returns (near) to start; 0° is a no-op-ish identity.
  const back = rotateVerts(box, all, c, 0, Math.PI * 2);
  assert(approx(back.verts[4][1], 2) && approx(back.verts[4][2], -1), '360° about X returns to start');
  // topology + uv untouched (only positions move).
  assertEqual(rot.faces.length, box.faces.length, 'rotation leaves faces alone');
  assert(rot.faces.every((f, i) => f.uv === box.faces[i].uv || JSON.stringify(f.uv) === JSON.stringify(box.faces[i].uv)), 'rotation never touches uv');
});

// ── Shape builders beyond the cube (req_1056) ──────────────────────────────────

test('cylinder "sides" is the Blockbench 3..48 knob (clampSides)', () => {
  assertEqual(clampSides(1), 3, 'below 3 clamps up to 3');
  assertEqual(clampSides(100), 48, 'above 48 clamps down to 48');
  assertEqual(clampSides(7.6), 8, 'rounds to a whole side count');
  // a 100-side request builds a 48-side cylinder: 48·2 ring verts, 48 sides + 2 caps.
  const cyl = cylinder(0.5, 1, 100);
  assertEqual(cyl.verts.length, 96, '48 sides → 96 ring verts (clamped)');
  assertEqual(cyl.faces.length, 50, '48 side quads + 2 caps');
  assert(cyl.faces.every((f) => f.uv && f.uv.length === f.loop.length), 'every face is unwrapped at mint');
});

test('cone tapers an n-side base ring to one apex (req_1056)', () => {
  const c = cone(0.5, 1, 8);
  assertEqual(c.verts.length, 9, '8 base verts + 1 apex');
  assertEqual(c.faces.length, 9, '8 side tris + 1 base cap');
  const g = editMeshToGeometry(c);
  assert(g.count > 0 && g.count % 3 === 0, 'cone lowers to a clean triangle soup');
  assert(c.faces.every((f) => f.uv), 'cone faces are unwrapped');
});

test('pyramid is a square base to an apex; plane is one +Y quad (req_1056)', () => {
  const p = pyramid(1, 1, 1);
  assertEqual(p.verts.length, 5, '4 base verts + 1 apex');
  assertEqual(p.faces.length, 5, '1 base quad + 4 side tris');
  assertEqual(editMeshToGeometry(p).count, 18, 'base quad (2 tris) + 4 tris = 18 corners');
  const pl = plane(1, 1);
  assertEqual(pl.verts.length, 4, 'plane is 4 verts');
  assertEqual(pl.faces.length, 1, 'plane is one quad');
  assert(pl.faces[0].uv!.length === 4, 'the plane quad is unwrapped');
});

// ── Create face / bridge edges (req_1059) ──────────────────────────────────────

test('bridgeEdges fills a quad between two edges, non-crossing + unwrapped (req_1059)', () => {
  // two parallel edges in space; bridging them should make ONE clean quad.
  const m: EditMesh = { verts: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], faces: [] };
  const out = bridgeEdges(m, [0, 1], [2, 3]); // edge 0-1 and edge 2-3
  assertEqual(out.faces.length, 1, 'one quad created');
  assertEqual(out.faces[0].loop.length, 4, 'it is a quad');
  // non-crossing: the loop should be 0,1,3,2 (b=1 joins to nearer d=3), not 0,1,2,3.
  assert(JSON.stringify(out.faces[0].loop) === JSON.stringify([0, 1, 3, 2]), 'verts ordered to avoid a bowtie');
  assert(out.faces[0].uv!.length === 4, 'the new face is unwrapped');
  // a shared vert → not a clean bridge (no-op).
  assert(bridgeEdges(m, [0, 1], [1, 3]) === m, 'edges sharing a vert are a no-op');
});

test('createFaceFromVerts fills 3 verts (tri) and 4 verts (quad); rejects others (req_1059)', () => {
  const m: EditMesh = { verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], faces: [] };
  const tri = createFaceFromVerts(m, [0, 1, 2]);
  assert(tri !== null && tri.faces.length === 1 && tri.faces[0].loop.length === 3, '3 verts → a triangle');
  const quad = createFaceFromVerts(m, [0, 1, 2, 3]);
  assert(quad !== null && quad.faces[0].loop.length === 4, '4 verts → a quad');
  assert(quad!.faces[0].uv!.length === 4, 'the created quad is unwrapped');
  assertEqual(createFaceFromVerts(m, [0, 1]), null, '2 verts is not a face');
  assert(createFaceFromVerts(m, [0, 1, 2, 3, 0]) !== null, 'duplicate indices dedupe to 4 → still a quad');
  const big: EditMesh = { verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0.5, 0, 2]], faces: [] };
  assertEqual(createFaceFromVerts(big, [0, 1, 2, 3, 4]), null, '5 distinct verts is too many for one face');
});

finish('editMesh');
