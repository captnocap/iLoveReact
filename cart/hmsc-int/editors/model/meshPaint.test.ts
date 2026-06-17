// meshPaint.test.ts — the PAINT-mode pure math (Phase 5c). Bundle + run:
//   tools/esbuild cart/hmsc-int/editors/model/meshPaint.test.ts --bundle \
//     --format=esm --platform=neutral --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli <out>.js
// Covers the screen→world ray (inverse of the projector), the face/texel raycast,
// the brush clamp (no spill past a face slot), and the run-merge for rendering.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid } from './editMesh';
import { makeProjector, type CameraSnap } from './meshSelect';
import { screenRay, pickFaceTexel, faceTexelRect, brushTexels, paintRuns, uvToWorld, type PaintTarget } from './meshPaint';

function nearly(a: number, b: number, eps = 1e-3): boolean { return Math.abs(a - b) <= eps; }

const cam: CameraSnap = { eye: [0, 0, 5], target: [0, 0, 0], fov: 45, aspect: 1, w: 800, h: 800, near: 0.02 };

test('screenRay through the centre pixel aims at the target (−Z); a known point round-trips', () => {
  const ray = screenRay(cam, 400, 400);
  assert(nearly(ray.d[0], 0) && nearly(ray.d[1], 0), 'centre ray has no x/y tilt');
  assert(ray.d[2] < 0, 'centre ray points toward −Z (the target)');
  // project a world point, then a ray through that pixel must pass through it.
  const proj = makeProjector(cam);
  const pt: [number, number, number] = [0.6, -0.3, 0.5];
  const q = proj(pt);
  const r = screenRay(cam, q.x, q.y);
  // the point lies along the ray: (pt - eye) is parallel to d.
  const v = [pt[0] - cam.eye[0], pt[1] - cam.eye[1], pt[2] - cam.eye[2]];
  const vl = Math.hypot(v[0], v[1], v[2]);
  const cos = (v[0] * r.d[0] + v[1] * r.d[1] + v[2] * r.d[2]) / vl;
  assert(nearly(cos, 1, 1e-3), 'the clicked pixel’s ray passes through the projected point');
});

test('pickFaceTexel hits the front (+Z) face and returns a texel inside its slot', () => {
  const box = cuboid(2, 2, 2); // origin-centred, 2m cube; faces fullFaceUV at mint
  const targets: PaintTarget[] = [{ partId: 'a', mesh: box, lift: 0 }];
  const texels = 32;
  const hit = pickFaceTexel(targets, cam, 400, 400, texels);
  assert(!!hit, 'centre ray hits a face');
  if (!hit) return;
  // the +Z face is the cuboid face whose verts all sit at z = +half.
  const face = box.faces[hit.faceIndex];
  const allFrontZ = face.loop.every((vi) => box.verts[vi][2] > 0.9);
  assert(allFrontZ, 'the hit face is the +Z (camera-facing) face');
  const rect = faceTexelRect(box, hit.faceIndex, texels)!;
  assert(hit.tx >= Math.floor(rect.x0) && hit.tx <= Math.ceil(rect.x1), 'tx inside the face slot');
  assert(hit.ty >= Math.floor(rect.y0) && hit.ty <= Math.ceil(rect.y1), 'ty inside the face slot');
});

test('a miss (ray into empty space) returns null', () => {
  const box = cuboid(2, 2, 2);
  const targets: PaintTarget[] = [{ partId: 'a', mesh: box, lift: 0 }];
  const hit = pickFaceTexel(targets, cam, 5, 5, 32); // far corner, off the cube
  assert(hit === null, 'a corner-pixel ray off the cube misses');
});

test('brushTexels clamps to the face slot — never spills past the rect edge', () => {
  const rect = { x0: 4, y0: 4, x1: 8, y1: 8 }; // a 4-texel slot
  const cells = brushTexels(7, 7, 5, rect); // a big brush at the slot corner
  assert(cells.length > 0, 'paints at least one cell');
  for (const [x, y] of cells) {
    assert(x >= 4 && x <= 7 && y >= 4 && y <= 7, `cell (${x},${y}) stays inside the slot`);
  }
});

test('brush size 1 paints exactly one texel', () => {
  const cells = brushTexels(10, 10, 1, { x0: 0, y0: 0, x1: 64, y1: 64 });
  assertEqual(cells.length, 1, 'a 1-texel brush is one cell');
  assert(cells[0][0] === 10 && cells[0][1] === 10, 'at the cursor texel');
});

test('paintRuns merges same-colour cells in a row into one run', () => {
  const paint = { '2:0': '#f00', '3:0': '#f00', '4:0': '#f00', '6:0': '#f00', '2:1': '#0f0' };
  const runs = paintRuns(paint);
  // row 0: a 3-wide run (2..4) + a 1-wide run (6); row 1: one cell.
  const r0 = runs.filter((r) => r.y === 0).sort((a, b) => a.x - b.x);
  assertEqual(r0.length, 2, 'row 0 coalesces into two runs');
  assert(r0[0].x === 2 && r0[0].w === 3, 'first run is 2..4 (width 3)');
  assert(r0[1].x === 6 && r0[1].w === 1, 'second run is the lone cell at 6');
  assertEqual(runs.filter((r) => r.y === 1).length, 1, 'row 1 has one run');
});

test('uvToWorld maps a UV onto the face for ANY shape — quad + triangle (req_1225)', () => {
  const box = cuboid(2, 2, 2); // faces are unwrapped (full-square UV per face) at mint
  const quad = box.faces[0];
  // the UV centre maps to the face centroid; a corner UV maps to that corner's vert.
  const ctr = uvToWorld(box, quad, 0.5, 0.5)!;
  assert(!!ctr && ctr.inside, 'centre UV is inside the quad');
  const verts = quad.loop.map((vi) => box.verts[vi]);
  const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const cz = verts.reduce((s, v) => s + v[2], 0) / verts.length;
  assert(nearly(ctr.world[0], cx) && nearly(ctr.world[1], cy) && nearly(ctr.world[2], cz), 'centre UV → face centroid');
  // a UV far outside the slot still returns a point, flagged NOT inside (so grid lines clip).
  const out = uvToWorld(box, quad, 5, 5);
  assert(!!out && !out.inside, 'a UV outside the face is flagged not-inside');
  // a TRIANGLE face (cone side) also maps — the old quad-only bilerp returned nothing.
  const cone = (require('./editMesh').cone)(2, 2, 6);
  const tri = cone.faces.find((f: any) => f.loop.length === 3);
  assert(!!tri, 'cone has triangular faces');
  const onTri = uvToWorld(cone, tri, 0.34, 0.33);
  assert(!!onTri, 'uvToWorld returns a point on a triangular face');
});

finish('meshPaint');
