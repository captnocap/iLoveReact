// editors/build snap behavior tests (P4) — MEANING tests for crosshair→snap
// resolution: the nearer surface wins, each registry snap mode lands where
// the grammar says (cell centers, edge lines, face mounts, free), faces stack
// on top. Flat-ground fns keep the cases analytic.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { GAME_BUILD, type PlacedBuildPiece } from '@game';
import { raycastGround, resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapInput } from './snap';

const FLAT = (_x: number, _z: number) => 0;
const WALL_SIZE = GAME_BUILD.catalog.get('wall.concrete.common').size;
const FLOOR_SIZE = GAME_BUILD.catalog.get('floor.concrete.common').size;

let nextId = 0;
function placed(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `t_${nextId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
}

function snapInput(over: Partial<SnapInput>): SnapInput {
  return {
    // eye at head height looking down-forward — the orbit camera's shape
    ray: { origin: { x: 0, y: 2, z: 0 }, dir: norm(0, -0.5, 1) },
    pieces: [],
    groundTopAt: FLAT,
    snap: 'grid',
    size: WALL_SIZE,
    yawDegrees: 0,
    ...over,
  };
}

function norm(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

// ── ground resolution ────────────────────────────────────────────────────────

test('the crosshair finds the ground where the ray meets it', () => {
  const hit = raycastGround({ origin: { x: 0, y: 2, z: 0 }, dir: norm(0, -0.5, 1) }, FLAT, 14, 0.25);
  assert(!!hit, 'the down-forward ray lands');
  assertClose(hit!.point.y, 0, 1e-3, 'on the ground plane');
  assertClose(hit!.point.z, 4, 1e-2, 'where y=2 falls at slope 0.5');
});

test('looking at the sky targets nothing', () => {
  const up = raycastGround({ origin: { x: 0, y: 2, z: 0 }, dir: norm(0, 0.5, 1) }, FLAT, 14, 0.25);
  assertEqual(up, null, 'no ground above the horizon');
  const target = resolveSnapTarget(snapInput({ ray: { origin: { x: 0, y: 2, z: 0 }, dir: norm(0, 0.5, 1) } }));
  assertEqual(target, null, 'no snap target either');
});

test('beyond build reach is no target', () => {
  // a shallow ray that would land ~20m out, past the 14m reach
  const target = resolveSnapTarget(snapInput({ ray: { origin: { x: 0, y: 2, z: 0 }, dir: norm(0, -0.1, 1) } }));
  assertEqual(target, null, 'out of reach');
});

// ── snap modes land where the grammar says ───────────────────────────────────

test('grid snap tiles modules at their OWN pitch (GRIDSNAP-0605: one lattice, no near-misses)', () => {
  const target = resolveSnapTarget(snapInput({ snap: 'grid', size: FLOOR_SIZE }));
  assert(!!target, 'a target resolves');
  assertEqual(target!.surface, 'ground', 'on the ground');
  // a 3m plate snaps on the 3m module lattice: hit near (0, 0, 4) lands the
  // module cell centered (1.5, 4.5) — neighbors tile FLUSH, never 1m-offset
  assertClose(target!.placement.x, 1.5, 1e-9, 'module-centered in x (3m pitch)');
  assertClose(target!.placement.z, 4.5, 1e-9, 'module-centered in z (3m pitch)');
  assertClose(target!.placement.y, 0, 1e-9, 'based on the ground');
  // a crosshair nudge inside the same module lands the SAME cell — the
  // "slightly off set from everything else" positions no longer exist
  const nudged = resolveSnapTarget(snapInput({ snap: 'grid', size: FLOOR_SIZE, ray: { origin: { x: 0.9, y: 2, z: 0.8 }, dir: norm(0, -0.5, 1) } }));
  assertClose(nudged!.placement.x, 1.5, 1e-9, 'no sub-module nudge in x');
  assertClose(nudged!.placement.z, 4.5, 1e-9, 'no sub-module nudge in z');
});

test('floor modules snapped from a floor edge share exact edges and one top plane', () => {
  const seed = placed('floor.concrete.common', 1.5, 1.5);
  const edgeRay = { origin: { x: 3.2, y: 0.1, z: 1.5 }, dir: norm(-1, 0, 0) };
  const fromEdge = resolveSnapTarget(snapInput({ ray: edgeRay, pieces: [seed], snap: 'grid', size: FLOOR_SIZE }));
  assert(!!fromEdge, 'the edge hit resolves');
  assertEqual(fromEdge!.surface, 'pieceFace', 'this reproduces the gapped path: raw hit is an existing floor edge');
  const gappedCandidate = { ...fromEdge!.placement, pieceId: 'floor.concrete.common', id: 'candidate' };
  const seedBounds = GAME_BUILD.placed.bounds(seed);
  const candidateBounds = GAME_BUILD.placed.bounds(gappedCandidate);
  console.log(`[FLOORGAP-0606] edge-hit candidate seed=(${seed.x},${seed.y},${seed.z}) bounds=x[${seedBounds.minX},${seedBounds.maxX}] z[${seedBounds.minZ},${seedBounds.maxZ}] y[${seedBounds.baseY},${seedBounds.topY}] candidate=(${gappedCandidate.x},${gappedCandidate.y},${gappedCandidate.z}) bounds=x[${candidateBounds.minX},${candidateBounds.maxX}] z[${candidateBounds.minZ},${candidateBounds.maxZ}] y[${candidateBounds.baseY},${candidateBounds.topY}] sharedX=${seedBounds.maxX}/${candidateBounds.minX}`);
  assertEqual(seedBounds.maxX, candidateBounds.minX, 'the adjacent floor shares the exact x edge');
  assertEqual(seedBounds.topY, candidateBounds.topY, 'the adjacent floor stays on the same top plane');
});

test('a grid of adjacent floor placements has exact shared-edge coordinates', () => {
  const placements = [
    placed('floor.concrete.common', 1.5, 1.5),
    placed('floor.concrete.common', 4.5, 1.5),
    placed('floor.concrete.common', 7.5, 1.5),
    placed('floor.concrete.common', 1.5, 4.5),
    placed('floor.concrete.common', 4.5, 4.5),
    placed('floor.concrete.common', 7.5, 4.5),
    placed('floor.concrete.common', 1.5, 7.5),
    placed('floor.concrete.common', 4.5, 7.5),
    placed('floor.concrete.common', 7.5, 7.5),
  ];
  const byCenter = new Map(placements.map((p) => [`${p.x},${p.z}`, GAME_BUILD.placed.bounds(p)]));
  for (const z of [1.5, 4.5, 7.5]) {
    for (const x of [1.5, 4.5]) {
      const left = byCenter.get(`${x},${z}`)!;
      const right = byCenter.get(`${x + 3},${z}`)!;
      assertEqual(left.maxX, right.minX, `row z=${z} shared x edge is exact`);
      assertEqual(left.topY, right.topY, `row z=${z} top plane is exact`);
    }
  }
  for (const x of [1.5, 4.5, 7.5]) {
    for (const z of [1.5, 4.5]) {
      const lower = byCenter.get(`${x},${z}`)!;
      const upper = byCenter.get(`${x},${z + 3}`)!;
      assertEqual(lower.maxZ, upper.minZ, `column x=${x} shared z edge is exact`);
      assertEqual(lower.topY, upper.topY, `column x=${x} top plane is exact`);
    }
  }
});

test('edge snap puts the wall ON the nearer grid line, running along it', () => {
  // aim so the hit lands near x = 3.05 (close to the x=3 line) with z
  // mid-cell (~4.4) so the x line is unambiguously the nearer one
  const ray = { origin: { x: 3.05, y: 2, z: 0.4 }, dir: norm(0, -0.5, 1) };
  const target = resolveSnapTarget(snapInput({ ray, snap: 'edge' }));
  assert(!!target, 'a target resolves');
  assertClose(target!.placement.x, 3, 1e-9, 'pinned to the x=3 line');
  assertEqual(target!.placement.yawDegrees, 90, 'the run goes ALONG that line');
  assertClose(target!.placement.z % 1, 0.5, 1e-9, 'run-axis center on a cell center — the 3m wall covers whole cell edges');
});

test('edge snap flips orientation when the other line is nearer', () => {
  // hit near z = 4 exactly (z-line) with x mid-cell → the wall runs along x
  const ray = { origin: { x: 0.5, y: 2, z: 2.05 }, dir: norm(0, -0.5, 1) };
  const target = resolveSnapTarget(snapInput({ ray, snap: 'edge' }));
  assert(!!target, 'a target resolves');
  assertEqual(target!.placement.yawDegrees, 0, 'runs along x');
  assertClose(target!.placement.z, 6, 1e-2, 'pinned to the z line');
});

test('free snap rides the 1m substrate with the user yaw (GRIDSNAP-0605: nothing places off-grid)', () => {
  // a sub-module prop (hydrant 0.54m) snaps at the 1m substrate — the raw-hit
  // placement was the "slightly off set from everything else" the user vetoed
  const hydrant = GAME_BUILD.catalog.get('prop.fireHydrant').size;
  const target = resolveSnapTarget(snapInput({ snap: 'free', yawDegrees: 45, size: hydrant }));
  assert(!!target, 'a target resolves');
  assertClose(target!.placement.x, 0.5, 1e-9, '1m cell-centered in x');
  assertClose(target!.placement.z, 4.5, 1e-9, '1m cell-centered in z');
  assertEqual(target!.placement.yawDegrees, 45, 'the ghost rotation is still the user\'s');
});

test('REQ-0596: freeform override places a free prop at the cursor instead of the 1m cell center', () => {
  const hydrant = GAME_BUILD.catalog.get('prop.fireHydrant').size;
  const target = resolveSnapTarget(snapInput({ snap: 'free', yawDegrees: 45, size: hydrant, freeform: true }));
  assert(!!target, 'a target resolves');
  assertClose(target!.placement.x, 0, 1e-9, 'raw hit x, not the cell center');
  assertClose(target!.placement.z, 4, 1e-9, 'raw hit z, not the cell center');
  assertEqual(target!.placement.yawDegrees, 45, 'freeform still keeps the user yaw');
});

// ── piece faces: targeting + stacking ────────────────────────────────────────

test('the nearer surface wins: a wall in front of the ground point takes the target', () => {
  const wall = placed('wall.concrete.common', 0, 0, { z: 2, yawDegrees: 0 });
  const ray = { origin: { x: 0, y: 1.5, z: 0 }, dir: norm(0, -0.1, 1) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [wall], snap: 'grid' }));
  assert(!!target, 'a target resolves');
  assertEqual(target!.surface, 'pieceFace', 'the wall face, not the ground behind it');
  assertEqual(target!.targetPieceId, wall.id, 'and names the piece');
});

test('a top face stacks the next storey', () => {
  const below = placed('wall.concrete.common', 0, 0, { z: 4 });
  // look down onto the wall's top from above (steep, so the ray enters
  // through the top face instead of skimming past it)
  const ray = { origin: { x: 0, y: 6, z: 3.9 }, dir: norm(0, -1, 0.05) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [below], snap: 'edge' }));
  assert(!!target, 'a target resolves');
  assertEqual(target!.surface, 'pieceFace', 'on the piece');
  assertClose(target!.placement.y, WALL_SIZE.heightMeters, 1e-6, 'the new base is the face top — storey two');
});

test('edge snap from a wall side face keeps the wall base level', () => {
  const wall = placed('wall.concrete.common', 1.5, 0, { y: FLOOR_SIZE.heightMeters, yawDegrees: 0 });
  const ray = { origin: { x: 1.5, y: 1.2, z: -1 }, dir: norm(0, 0, 1) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [wall], snap: 'edge' }));
  assert(!!target, 'the wall side face resolves');
  assertEqual(target!.surface, 'pieceFace', 'the target is the existing wall');
  assertClose(target!.placement.y, wall.y, 1e-9, 'side-face wall snap stays on the same floor, not the next storey');
  assertEqual(target!.placement.yawDegrees, 0, 'the new wall keeps the side-face run direction');
});

test('REQ-0471: wall side-face snap near an endpoint turns the corner on the aimed side', () => {
  const floor = placed('floor.concrete.common', 1.5, 1.5);
  const wall = placed('wall.concrete.common', 1.5, 0, { y: FLOOR_SIZE.heightMeters, yawDegrees: 0 });
  const ray = { origin: { x: 2.95, y: 1.2, z: -1 }, dir: norm(0, 0, 1) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [floor, wall], snap: 'edge' }));
  assert(!!target, 'the supported wall side face resolves');
  assertEqual(target!.surface, 'pieceFace', 'the existing wall owns the snap');
  assertClose(target!.placement.x, 3, 1e-9, 'the new wall line locks to the existing wall endpoint');
  assertClose(target!.placement.z, -1.5, 1e-9, 'the wall extends on the side the crosshair is aiming from');
  assertClose(target!.placement.y, wall.y, 1e-9, 'the corner stays on the same floor');
  assertEqual(target!.placement.yawDegrees, 90, 'the new wall turns perpendicular at the endpoint');
});

test('REQ-0471: wall end-cap snap extends the wall in the same line', () => {
  const wall = placed('wall.concrete.common', 1.5, 0, { y: FLOOR_SIZE.heightMeters, yawDegrees: 0 });
  const ray = { origin: { x: 4, y: 1.2, z: 0 }, dir: norm(-1, 0, 0) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [wall], snap: 'edge' }));
  assert(!!target, 'the wall end face resolves');
  assertEqual(target!.surface, 'pieceFace', 'the existing wall owns the snap');
  assertClose(target!.placement.x, 4.5, 1e-9, 'the next wall centers beyond the hit end');
  assertClose(target!.placement.z, wall.z, 1e-9, 'the authored wall line stays continuous');
  assertClose(target!.placement.y, wall.y, 1e-9, 'the extension stays on the same floor');
  assertEqual(target!.placement.yawDegrees, 0, 'the wall keeps its run direction');
});

test('edge snap only uses a floor top face as the wall-on-floor anchor', () => {
  const floor = placed('floor.concrete.common', 0, 0, { z: 4, y: 3 });
  const topRay = { origin: { x: 1.4, y: 6, z: 3.9 }, dir: norm(0, -1, 0.05) };
  const top = resolveSnapTarget(snapInput({ ray: topRay, pieces: [floor], snap: 'edge' }));
  assert(!!top, 'the top face resolves');
  assertClose(top!.placement.y, 3 + FLOOR_SIZE.heightMeters, 1e-6, 'top face anchor is the floor top');

  const ray = { origin: { x: 1.4, y: 3.1, z: 0 }, dir: norm(0, 0, 1) };
  const side = resolveSnapTarget(snapInput({ ray, pieces: [floor], snap: 'edge' }));
  assertEqual(side, null, 'the side face is not an alternate wall-on-floor anchor');
});

test('edge snap from ground beside a floor perimeter does not create a wall-on-floor placement', () => {
  const floorY = 2;
  const floor = placed('floor.concrete.common', 1.5, 1.5, { y: floorY });
  const ray = { origin: { x: 3.05, y: 4, z: 1.4 }, dir: norm(0, -1, 0) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [floor], snap: 'edge' }));
  assertEqual(target, null, 'beside-floor ground is not an alternate way to place a wall on that floor');
});

test('REQ-0107: a catalog-sized floor accepts a wall on its top edge without resizing or rejection', () => {
  const floor = placed('floor.concrete.common', 1.5, 1.5);
  const floorBounds = GAME_BUILD.placed.bounds(floor);
  const ray = { origin: { x: 2.95, y: 2, z: 1.5 }, dir: norm(0, -1, 0) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [floor], snap: 'edge', size: WALL_SIZE }));
  assert(!!target, 'the floor top resolves as a wall snap surface');
  const placement = { pieceId: 'wall.concrete.common', ...target!.placement };
  const problems = GAME_BUILD.placed.validatePlacement(placement);
  const wallBounds = GAME_BUILD.placed.bounds({ id: 'candidate', ...placement });
  console.log(`[REQ-0107] wall-on-floor floorBounds=x[${floorBounds.minX},${floorBounds.maxX}] z[${floorBounds.minZ},${floorBounds.maxZ}] target=(${target!.placement.x},${target!.placement.y},${target!.placement.z},yaw=${target!.placement.yawDegrees}) wallBounds=x[${wallBounds.minX},${wallBounds.maxX}] z[${wallBounds.minZ},${wallBounds.maxZ}] problems=${JSON.stringify(problems)}`);
  assertEqual(floorBounds.maxX - floorBounds.minX, FLOOR_SIZE.widthMeters, 'the floor top remains catalog width');
  assertEqual(floorBounds.maxZ - floorBounds.minZ, FLOOR_SIZE.depthMeters, 'the floor top remains catalog depth');
  assertEqual(target!.surface, 'pieceFace', 'this is the live top-face placement path');
  assertClose(target!.placement.x, floorBounds.maxX, 1e-9, 'the wall line is the exact floor edge');
  assertClose(target!.placement.z, floor.z, 1e-9, 'the wall run center stays on the floor lattice center');
  assertClose(target!.placement.y, floorBounds.topY, 1e-9, 'the wall stands on the floor top');
  assertEqual(problems.length, 0, 'placement validation does not reject the floor top edge');
  assertEqual(wallBounds.maxZ - wallBounds.minZ, WALL_SIZE.widthMeters, 'wall body keeps catalog run width');
});

test('surface pieces mount on faces only — and face outward', () => {
  const wall = placed('wall.concrete.common', 0, 0, { z: 4 });
  const signSize = GAME_BUILD.catalog.get('sign.shop.downtown').size;
  const onGround = resolveSnapTarget(snapInput({ snap: 'surface', size: signSize }));
  assertEqual(onGround, null, 'no face, no mount');
  const ray = { origin: { x: 0.2, y: 1.5, z: 0 }, dir: norm(0, 0, 1) };
  const target = resolveSnapTarget(snapInput({ ray, pieces: [wall], snap: 'surface', size: signSize }));
  assert(!!target, 'mounts on the wall');
  assertEqual(target!.placement.yawDegrees, 180, 'faces out along the -z normal');
  assert(target!.placement.z < 4 - WALL_SIZE.depthMeters / 2, 'sits proud of the face, not inside it');
  assertClose(target!.placement.x % SNAP_TUNING_DEFAULTS.surfaceSnapMeters, 0, 1e-9, 'quantized along the face');
});

finish('build-snap');
