// game/build placed-piece behavior tests (P4) — MEANING tests for the V24
// grammar standing in the world: a placed doorway admits a body through its
// collision, a halfHeight wall is waist-high to the physics, a ramp is a
// walkable slope, a prefab stamp IS its semantic pieces with deterministic
// replay ids, clone-from-world round-trips. Never function-name assertions.

import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import {
  PLACED_TUNING,
  connectedPieceIds,
  pieceBounds,
  placedPieceCameraOccluders,
  placedPieceColliders,
  placedPieceDepthSpan,
  placedPieceRamps,
  placedPieceTags,
  prefabFromPieces,
  mintPrefabId,
  raycastPieces,
  stampPrefabPieces,
  validatePlacement,
  liftPropsToTerrain,
  type PlacedBuildPiece,
} from './placed';
import { catalogEntry } from './catalog';
import { decomposePrefab, prefabDefinition, validatePrefab } from './prefabs';
import { legacyGlobalPieces, pieceMutationMapName, piecesForMap, worldStream, type WorldEvent, type WorldStreamState } from '../world/stream';

let nextId = 0;
function placed(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `t_${nextId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
}

function fold(events: WorldEvent[]): WorldStreamState {
  let state = worldStream.initial();
  for (const event of events) state = worldStream.apply(state, event);
  return state;
}

// ── placed semantics ─────────────────────────────────────────────────────────

test('a placed door wall means portal: effective tags compose on the placement', () => {
  const wall = placed('wall.concrete.common', 0, 0, { edit: 'door' });
  assert(placedPieceTags(wall).portal, 'the placed doorway connects rooms');
  assert(!placedPieceTags(placed('wall.concrete.common', 0, 0)).portal, 'the uncut placement does not');
});

test('a quarter turn swaps the footprint: the wall stands across the other axis', () => {
  const flat = pieceBounds(placed('wall.concrete.common', 10, 10));
  const turned = pieceBounds(placed('wall.concrete.common', 10, 10, { yawDegrees: 90 }));
  const size = catalogEntry('wall.concrete.common').size;
  assertClose(flat.maxX - flat.minX, size.widthMeters, 1e-9, 'unturned width spans x');
  assertClose(flat.maxZ - flat.minZ, size.depthMeters, 1e-9, 'unturned depth spans z');
  assertClose(turned.maxX - turned.minX, size.depthMeters, 1e-9, 'turned: depth spans x');
  assertClose(turned.maxZ - turned.minZ, size.widthMeters, 1e-9, 'turned: width spans z');
});

// ── embodied colliders ───────────────────────────────────────────────────────

test('a solid wall is one solid band; a doorway splits it so a body fits through', () => {
  const solid = placedPieceColliders([placed('wall.concrete.common', 0, 0)]);
  assertEqual(solid.rects.length, 1, 'the uncut wall is one band');

  const door = placedPieceColliders([placed('wall.concrete.common', 0, 0, { edit: 'door' })]);
  assertEqual(door.rects.length, 2, 'the doorway leaves the two jambs');
  const [left, right] = [...door.rects].sort((a, b) => a.minX - b.minX);
  const gap = right.minX - left.maxX;
  assertClose(gap, PLACED_TUNING.walkOpeningWidthMeters, 1e-9, 'the opening is the walk-portal width');
});

test('a garage door opens a vehicle-wide gap', () => {
  const garage = placedPieceColliders([placed('wall.metal.industrial', 0, 0, { edit: 'garageDoor' })]);
  const [left, right] = [...garage.rects].sort((a, b) => a.minX - b.minX);
  assertClose(right.minX - left.maxX, PLACED_TUNING.vehicleOpeningWidthMeters, 1e-9, 'a car fits');
});

test('a halfHeight wall collides waist-high, not full-height', () => {
  const wall = placed('wall.concrete.common', 0, 0, { edit: 'halfHeight' });
  const { rects } = placedPieceColliders([wall]);
  assertEqual(rects.length, 1, 'one low band');
  assertClose(rects[0].topMeters, PLACED_TUNING.halfHeightTopMeters, 1e-9, 'tops out at low cover');
  const full = placedPieceColliders([placed('wall.concrete.common', 0, 0)]).rects[0];
  assert(rects[0].topMeters < full.topMeters, 'lower than the solid wall');
});

test('a window keeps its collision mass (sightline, never a corridor)', () => {
  const { rects } = placedPieceColliders([placed('wall.concrete.common', 0, 0, { edit: 'window' })]);
  assertEqual(rects.length, 1, 'the pane still blocks the body');
});

test('no-collision pieces contribute nothing solid', () => {
  const { rects, orientedRects } = placedPieceColliders([
    placed('prop.bush', 0, 0),
    placed('trim.cornice.downtown', 5, 5),
  ]);
  assertEqual(rects.length + orientedRects.length, 0, 'bush and trim have no collision mass');
});

test('REQ-0582: build props rest on heightfield terrain without moving structural pieces', () => {
  const prop = placed('prop.rock', 2, 4);
  const floor = placed('floor.concrete.common', 2, 4);
  const upperProp = placed('prop.fireHydrant', 6, 6, { y: 8 });
  const lifted = liftPropsToTerrain([prop, floor, upperProp], (x, z) => (x === 2 && z === 4 ? 6 : 1));

  assertClose(lifted[0].y, 6, 1e-9, 'the prop base rises to the heightfield top at its anchor');
  assertClose(lifted[1].y, 0, 1e-9, 'a floor/building piece is not changed by the prop lift');
  assertClose(lifted[2].y, 8, 1e-9, 'an already elevated prop is not pushed down to terrain');
});

test('a turned wall blocks across the other axis (quarter turns stay plain rects)', () => {
  const { rects, orientedRects } = placedPieceColliders([placed('wall.concrete.common', 0, 0, { yawDegrees: 90 })]);
  assertEqual(orientedRects.length, 0, 'quarter turn needs no oriented frame');
  assertEqual(rects.length, 1, 'one band');
  const size = catalogEntry('wall.concrete.common').size;
  assertClose(rects[0].maxZ - rects[0].minZ, size.widthMeters, 1e-9, 'the wall now runs along z');
});

test('REQ-0107: floor and wall pieces keep catalog extents; flushness is origin lattice, not resizing', () => {
  const wallSize = catalogEntry('wall.concrete.common').size;
  const floorSize = catalogEntry('floor.concrete.common').size;
  const floor = placed('floor.concrete.common', 1.5, 1.5);
  const horizontal = placed('wall.concrete.common', 1.5, 0, { yawDegrees: 0 });
  const vertical = placed('wall.concrete.common', 3, 1.5, { yawDegrees: 90 });
  const floorBounds = pieceBounds(floor);
  const hBounds = pieceBounds(horizontal);
  const vBounds = pieceBounds(vertical);
  const hSolo = placedPieceColliders([horizontal]).rects[0];
  const vSolo = placedPieceColliders([vertical]).rects[0];
  console.log(`[REQ-0107] floor=(${floor.x},${floor.y},${floor.z}) bounds=x[${floorBounds.minX},${floorBounds.maxX}] z[${floorBounds.minZ},${floorBounds.maxZ}] size=${floorBounds.maxX - floorBounds.minX}x${floorBounds.maxZ - floorBounds.minZ} hWall=x[${hBounds.minX},${hBounds.maxX}] z[${hBounds.minZ},${hBounds.maxZ}] vWall=x[${vBounds.minX},${vBounds.maxX}] z[${vBounds.minZ},${vBounds.maxZ}] hSoloSpan=${hSolo.maxX - hSolo.minX} vSoloSpan=${vSolo.maxZ - vSolo.minZ}`);
  assertEqual(floorBounds.maxX - floorBounds.minX, floorSize.widthMeters, 'floor x size is the catalog width');
  assertEqual(floorBounds.maxZ - floorBounds.minZ, floorSize.depthMeters, 'floor z size is the catalog depth');
  assertEqual(horizontal.x, floor.x, 'wall run center shares the floor lattice center');
  assertEqual(horizontal.z, floorBounds.minZ, 'wall line is exactly on the floor edge');
  assertEqual(vertical.x, floorBounds.maxX, 'turned wall line is exactly on the floor edge');
  assertEqual(vertical.z, floor.z, 'turned wall run center shares the floor lattice center');
  assertEqual(hBounds.maxX - hBounds.minX, wallSize.widthMeters, 'horizontal wall keeps catalog run width');
  assertEqual(vBounds.maxZ - vBounds.minZ, wallSize.widthMeters, 'vertical wall keeps catalog run width');
  assertEqual(hSolo.maxX - hSolo.minX, wallSize.widthMeters, 'standalone horizontal collision keeps catalog run width');
  assertEqual(vSolo.maxZ - vSolo.minZ, wallSize.widthMeters, 'standalone vertical collision keeps catalog run width');
});

test('REQ-0466: one-sided floor support puts the whole wall thickness on the floor top', () => {
  const floor = placed('floor.concrete.common', 1.5, 1.5);
  const north = placed('wall.concrete.common', 1.5, 0, { y: 0.2, yawDegrees: 0 });
  const south = placed('wall.concrete.common', 1.5, 3, { y: 0.2, yawDegrees: 0 });
  const northSpan = placedPieceDepthSpan(north, [floor, north]);
  const southSpan = placedPieceDepthSpan(south, [floor, south]);
  assertClose(northSpan.minV, 0, 1e-9, 'north edge wall starts at the floor edge line');
  assertClose(northSpan.maxV, 0.25, 1e-9, 'north edge wall thickness sits onto the floor');
  assertClose(southSpan.minV, -0.25, 1e-9, 'south edge wall thickness sits back onto the floor');
  assertClose(southSpan.maxV, 0, 1e-9, 'south edge wall ends at the floor edge line');

  const [floorRect, northRect, southRect] = placedPieceColliders([floor, north, south]).rects;
  void floorRect;
  assertClose(northRect.minZ, 0, 1e-9, 'north wall has no outside overhang');
  assertClose(northRect.maxZ, 0.25, 1e-9, 'north wall sits inside the floor footprint');
  assertClose(southRect.minZ, 2.75, 1e-9, 'south wall sits inside the floor footprint');
  assertClose(southRect.maxZ, 3, 1e-9, 'south wall has no outside overhang');
});

test('REQ-0466: a wall between two floor plates splits its thickness across the seam', () => {
  const left = placed('floor.concrete.common', 1.5, 1.5);
  const right = placed('floor.concrete.common', 1.5, 4.5);
  const wall = placed('wall.concrete.common', 1.5, 3, { y: 0.2, yawDegrees: 0 });
  const span = placedPieceDepthSpan(wall, [left, right, wall]);
  assertClose(span.minV, -0.125, 1e-9, 'one floor supports the back half');
  assertClose(span.maxV, 0.125, 1e-9, 'the other floor supports the front half');
  const rect = placedPieceColliders([left, right, wall]).rects[2];
  assertClose(rect.minZ, 2.875, 1e-9, 'shared-seam wall keeps a half-depth on one side');
  assertClose(rect.maxZ, 3.125, 1e-9, 'shared-seam wall keeps a half-depth on the other side');
});

test('REQ-0466: unsupported ground walls keep the old centered thickness', () => {
  const wall = placed('wall.concrete.common', 1.5, 3, { yawDegrees: 0 });
  const span = placedPieceDepthSpan(wall, [wall]);
  assertClose(span.minV, -0.125, 1e-9, 'freestanding wall keeps centered back half');
  assertClose(span.maxV, 0.125, 1e-9, 'freestanding wall keeps centered front half');
});

test('REQ-0472: floor-supported wall joins stop at the supported intersection face', () => {
  const floor = placed('floor.concrete.common', 1.5, 1.5);
  const horizontal = placed('wall.concrete.common', 1.5, 0, { y: 0.2, yawDegrees: 0 });
  const vertical = placed('wall.concrete.common', 3, 1.5, { y: 0.2, yawDegrees: 90 });
  const [, hRect, vRect] = placedPieceColliders([floor, horizontal, vertical]).rects;
  assertClose(vRect.maxX, 3, 1e-9, 'the supported vertical wall far face sits on its authored edge');
  assertClose(hRect.maxX, vRect.maxX, 1e-9, 'the horizontal wall stops at that intersection, with no post-intersection overhang');
  assertClose(hRect.maxZ, 0.25, 1e-9, 'the horizontal wall thickness still sits fully on the floor');
  assertClose(vRect.minZ, 0, 1e-9, 'the vertical wall still reaches the horizontal wall face');
});

test('REQ-0109: L wall corners close the endpoint-to-side outer faces exactly', () => {
  const wallSize = catalogEntry('wall.concrete.common').size;
  const halfDepth = wallSize.depthMeters / 2;
  const horizontal = placed('wall.concrete.common', 1.5, 0, { yawDegrees: 0 });
  const vertical = placed('wall.concrete.common', 3, 1.5, { yawDegrees: 90 });
  const hBounds = pieceBounds(horizontal);
  const vBounds = pieceBounds(vertical);
  const [hRect, vRect] = placedPieceColliders([horizontal, vertical]).rects;
  console.log(`[REQ-0109] L-corner placed h=(${horizontal.x},${horizontal.y},${horizontal.z},yaw=${horizontal.yawDegrees}) bounds=x[${hBounds.minX},${hBounds.maxX}] z[${hBounds.minZ},${hBounds.maxZ}] v=(${vertical.x},${vertical.y},${vertical.z},yaw=${vertical.yawDegrees}) bounds=x[${vBounds.minX},${vBounds.maxX}] z[${vBounds.minZ},${vBounds.maxZ}] uncoveredX=${vBounds.maxX - hBounds.maxX} uncoveredZ=${vBounds.minZ - hBounds.minZ} joinedH=x[${hRect.minX},${hRect.maxX}] z[${hRect.minZ},${hRect.maxZ}] joinedV=x[${vRect.minX},${vRect.maxX}] z[${vRect.minZ},${vRect.maxZ}]`);
  assertEqual(vBounds.maxX - hBounds.maxX, halfDepth, 'raw placed bounds show the old outside-corner x sliver');
  assertEqual(vBounds.minZ - hBounds.minZ, halfDepth, 'raw placed bounds show the old outside-corner z sliver');
  assertEqual(hRect.maxX, vRect.maxX, 'joined L corner closes the outer x face');
  assertEqual(hRect.minZ, vRect.minZ, 'joined L corner closes the outer z face');
  assertEqual(hRect.maxX - hBounds.maxX, halfDepth, 'horizontal wall extends only its joined endpoint');
  assertEqual(vBounds.minZ - vRect.minZ, halfDepth, 'vertical wall extends only its joined endpoint');
});

test('REQ-0109: T wall junctions close the end-to-side face without resizing the crossing wall', () => {
  const wallSize = catalogEntry('wall.concrete.common').size;
  const halfDepth = wallSize.depthMeters / 2;
  const cross = placed('wall.concrete.common', 1.5, 0, { yawDegrees: 0 });
  const stem = placed('wall.concrete.common', 1.5, 1.5, { yawDegrees: 90 });
  const crossBounds = pieceBounds(cross);
  const stemBounds = pieceBounds(stem);
  const [crossRect, stemRect] = placedPieceColliders([cross, stem]).rects;
  console.log(`[REQ-0109] T-junction crossBounds=x[${crossBounds.minX},${crossBounds.maxX}] z[${crossBounds.minZ},${crossBounds.maxZ}] stemBounds=x[${stemBounds.minX},${stemBounds.maxX}] z[${stemBounds.minZ},${stemBounds.maxZ}] uncoveredZ=${stemBounds.minZ - crossBounds.minZ} joinedCross=x[${crossRect.minX},${crossRect.maxX}] z[${crossRect.minZ},${crossRect.maxZ}] joinedStem=x[${stemRect.minX},${stemRect.maxX}] z[${stemRect.minZ},${stemRect.maxZ}]`);
  assertEqual(stemBounds.minZ - crossBounds.minZ, halfDepth, 'raw placed bounds show the T-junction side sliver');
  assertEqual(stemRect.minZ, crossRect.minZ, 'joined T closes the stem end to the crossing wall outer face');
  assertEqual(crossRect.maxX - crossRect.minX, wallSize.widthMeters, 'the crossing wall keeps its catalog run width');
  assertEqual(stemRect.maxZ - stemRect.minZ, wallSize.widthMeters + halfDepth, 'only the stem endpoint extends to cover wall thickness');
});

test('a free-angled piece lands in the oriented frame', () => {
  const { rects, orientedRects } = placedPieceColliders([placed('wall.concrete.common', 0, 0, { yawDegrees: 30 })]);
  assertEqual(rects.length, 0, 'no axis-aligned band');
  assertEqual(orientedRects.length, 1, 'the band carries pivot + yaw');
  assertClose(orientedRects[0].yawRadians, (30 * Math.PI) / 180, 1e-9, 'the host gets the turn');
});

test('camera occlusion colliders report walls, roofs, and ramp slabs, but skip sightline edits', () => {
  const wall = placed('wall.concrete.common', 0, 0);
  const window = placed('wall.concrete.common', 3, 0, { edit: 'window' });
  const roof = placed('roof.flat.common', 0, 0, { y: 3 });
  const ramp = placed('ramp.concrete.common', 6, 0);
  const stairs = placed('stairs.wood.common', 9, 0);
  const occluders = placedPieceCameraOccluders([wall, window, roof, ramp, stairs]);
  assertEqual(occluders.ownerIds.join(','), `${wall.id},${roof.id},${ramp.id}`, 'opaque wall/roof pieces and ramp slabs own occlusion bands');
  assertEqual(occluders.rects.length, 2 + PLACED_TUNING.rampSlabEdgeSegments * 3 + 1, 'wall/roof bands plus the ramp slab can occlude a camera under the ramp');
  assertEqual(occluders.rects[0].ownerIndex, 1, 'owner indices map to ownerIds');
  assertEqual(occluders.rects[1].ownerIndex, 2, 'second owner maps to the roof');
  assert(occluders.rects.slice(2).every((rect) => rect.ownerIndex === 3), 'ramp slab rects map to the ramp owner');
  assertEqual(occluders.ownerIds.includes(stairs.id), false, 'walkable stairs stay out of the camera occluder set');
});

test('RAMPREAL-0606: a ramp registers as a hollow inclined slab, not a solid wedge', () => {
  const ramp = placed('ramp.concrete.common', 6, 6);
  const { rects, orientedRects } = placedPieceColliders([ramp]);
  const fields = placedPieceRamps([ramp], 3);
  console.log(`[RAMPREAL-0606] ramp registration rects=${rects.length} oriented=${orientedRects.length} heightfields=${fields.length} rampBounds=x[${pieceBounds(ramp).minX},${pieceBounds(ramp).maxX}] z[${pieceBounds(ramp).minZ},${pieceBounds(ramp).maxZ}] slabBands=${rects.map((r) => `x[${r.minX},${r.maxX}]z[${r.minZ},${r.maxZ}] y[${r.floorMeters},${r.topMeters}]`).join(';')} heights=${fields[0] ? Array.from(fields[0].heights).join(',') : 'none'}`);
  assertEqual(orientedRects.length, 0, 'axis-aligned ramp emits plain rects');
  assertEqual(rects.length, PLACED_TUNING.rampSlabEdgeSegments * 3 + 1, 'slab core, side segments, and high edge are solid');
  const bounds = pieceBounds(ramp);
  const sideRects = rects.filter((r) => r.minZ >= bounds.minZ - 1e-9 && r.maxZ <= bounds.maxZ + 1e-9 && (r.maxX <= bounds.minX + 1e-9 || r.minX >= bounds.maxX - 1e-9));
  const coreRects = rects.filter((r) => r.minX >= bounds.minX - 1e-9 && r.maxX <= bounds.maxX + 1e-9 && r.minZ >= bounds.minZ - 1e-9 && r.maxZ <= bounds.maxZ + 1e-9);
  const backRect = rects.find((r) => r.minZ >= bounds.maxZ - 1e-9);
  const approachRect = rects.find((r) => r.maxZ <= bounds.minZ + 1e-9);
  assertEqual(sideRects.length, PLACED_TUNING.rampSlabEdgeSegments * 2, 'both ramp sides are segmented slab edges');
  assertEqual(coreRects.length, PLACED_TUNING.rampSlabEdgeSegments, 'the inclined floor slab has a real underside volume');
  assert(!!backRect, 'the far/high edge is the slab edge, not a wall');
  assertEqual(approachRect, undefined, 'no wall band covers the walk-up approach edge');
  for (const rect of rects) {
    assertEqual(rect.blocksPlayer, true, 'ramp boundary faces block the player');
    assertClose(rect.topMeters - (rect.floorMeters ?? -999), PLACED_TUNING.rampSlabThicknessMeters, 1e-9, 'each edge is slab-thick, not floor-to-crest mass');
  }
  assert(sideRects.some((r) => (r.floorMeters ?? -999) > ramp.y + 1), 'the raised side leaves usable open space under the high ramp');
  assertEqual(fields.length, 1, 'one slope');
  assertEqual(fields[0].slot, 3, 'slots continue after the world terrain bake');
  const heights = fields[0].heights;
  assertClose(heights[0], 0, 1e-9, 'back edge at the base');
  assertClose(heights[heights.length - 1], catalogEntry('ramp.concrete.common').size.heightMeters, 1e-9, 'front edge at the top — the ramp connects floors');
  assert(fields[0].walkableSlopeCos <= PLACED_TUNING.rampWalkableSlopeCos, 'the slope is walkable');
});

test('RAMPREAL-0606: the world stream can place a piece under the ramp footprint', () => {
  const ramp = placed('ramp.concrete.common', 6, 6);
  const under = placed('floor.concrete.common', 6, 6, { id: 'under_floor' });
  const state = fold([
    { kind: 'piecePlaced', placement: ramp },
    { kind: 'piecePlaced', placement: under },
  ]);
  assertEqual(state.pieces.length, 2, 'the ramp is not an opaque placement volume');
  assertEqual(validatePlacement({ pieceId: under.pieceId, x: under.x, y: under.y, z: under.z, yawDegrees: under.yawDegrees }).length, 0, 'a normal floor placement remains valid under it');
});

test('STAIRS-0607: rotated stairs register to their visible footprint and face the same way as the heightfield', () => {
  const stairs = placed('stairs.wood.common', 6, 6, { yawDegrees: 90 });
  const { rects, orientedRects } = placedPieceColliders([stairs]);
  const fields = placedPieceRamps([stairs], 7);
  const bounds = pieceBounds(stairs);
  console.log(`[STAIRS-0607] yaw=90 bounds=x[${bounds.minX},${bounds.maxX}] z[${bounds.minZ},${bounds.maxZ}] rects=${rects.map((r) => `x[${r.minX},${r.maxX}]z[${r.minZ},${r.maxZ}] y[${r.floorMeters},${r.topMeters}]`).join(';')} field=slot${fields[0].slot} origin=(${fields[0].originX},${fields[0].originZ}) cell=${fields[0].cellSizeMeters} cols=${fields[0].cols} rows=${fields[0].rows} yaw=${fields[0].yawRadians} heights=${Array.from(fields[0].heights).join(',')}`);
  assertEqual(orientedRects.length, 0, 'quarter-turned stairs stay axis-aligned');
  assertEqual(fields.length, 1, 'stairs register one walkable slope');
  assertEqual(fields[0].slot, 7, 'slots continue after world fields');
  assertClose(fields[0].cellSizeMeters, PLACED_TUNING.verticalLinkHeightfieldCellMeters, 1e-9, 'stairs use the vertical-link cell tuning');
  assertEqual(fields[0].cols, 3, '1.2m stairs are three samples wide at 0.6m cells');
  assertEqual(fields[0].rows, 6, '3m stair run is six samples deep at 0.6m cells');
  assertClose(fields[0].originX, stairs.x - catalogEntry(stairs.pieceId).size.widthMeters / 2, 1e-9, 'local width starts at the visible stair side');
  assertClose(fields[0].originZ, stairs.z - catalogEntry(stairs.pieceId).size.depthMeters / 2, 1e-9, 'local depth starts at the low approach edge');
  assertClose(fields[0].yawRadians ?? 0, Math.PI / 2, 1e-9, 'host receives the placed yaw');
  const highFace = rects.find((r) => r.minX >= bounds.maxX - 1e-9);
  const lowApproach = rects.find((r) => r.maxX <= bounds.minX + 1e-9);
  assert(!!highFace, 'the closed/high stair face is on the turned +v edge');
  assertEqual(lowApproach, undefined, 'the low stair approach stays open');
  assertClose(fields[0].heights[0], 0, 1e-9, 'low row starts at base');
  assertClose(fields[0].heights[fields[0].heights.length - 1], catalogEntry(stairs.pieceId).size.heightMeters, 1e-9, 'high row reaches the next storey');
});

// ── crosshair targeting ──────────────────────────────────────────────────────

test('the crosshair ray hits the nearest piece face with its outward normal', () => {
  const near = placed('wall.concrete.common', 0, 0, { z: 5 });
  const far = placed('wall.concrete.common', 0, 0, { z: 10 });
  const hit = raycastPieces({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: 1 } }, [far, near], 50);
  assert(!!hit, 'the ray lands');
  assertEqual(hit!.piece.id, near.id, 'the nearer wall wins');
  assertClose(hit!.point.z, 5 - catalogEntry('wall.concrete.common').size.depthMeters / 2, 1e-6, 'on the facing surface');
  assertClose(hit!.normal.z, -1, 1e-6, 'the normal faces the viewer');
});

test('beyond reach is no target', () => {
  const wall = placed('wall.concrete.common', 0, 0, { z: 30 });
  const hit = raycastPieces({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: 1 } }, [wall], 10);
  assertEqual(hit, null, 'out of build reach');
});

test('a turned piece is hit in its own frame, not its envelope', () => {
  // wall turned 90°: thin in x, long in z — a ray skimming past its x edge misses
  const wall = placed('wall.concrete.common', 0, 0, { z: 5, yawDegrees: 90 });
  const skim = raycastPieces({ origin: { x: 1, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: 1 } }, [wall], 50);
  assertEqual(skim, null, 'the envelope would have caught this; the true frame does not');
  const dead = raycastPieces({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: 1 } }, [wall], 50);
  assert(!!dead, 'dead-on still hits');
});

// ── prefab stamping + clone-from-world ───────────────────────────────────────

test('a stamp at yaw 0 is exactly the decomposition placement', () => {
  const prefab = prefabDefinition('prefab.motelRoom');
  const origin = { x: 12, y: 0, z: 8 };
  const stamped = stampPrefabPieces(prefab, origin, 0);
  const decomposed = decomposePrefab(prefab, origin);
  assertEqual(stamped.length, decomposed.length, 'same pieces');
  for (let i = 0; i < stamped.length; i += 1) {
    assertClose(stamped[i].x, decomposed[i].x, 1e-9, `piece ${i} x agrees`);
    assertClose(stamped[i].z, decomposed[i].z, 1e-9, `piece ${i} z agrees`);
    assertEqual(stamped[i].edit, decomposed[i].edit, `piece ${i} edit carries`);
  }
});

test('a stamp turns as one composition: locals rotate, piece yaw composes', () => {
  const prefab = prefabDefinition('prefab.motelRoom');
  const stamped = stampPrefabPieces(prefab, { x: 0, y: 0, z: 0 }, 90);
  // R(+90) — the same frame the pieces' own colliders/raycast turn with:
  // local (x:0,z:3) window wall → (lx·0 − lz·1, lx·1 + lz·0) = (−3, 0)
  const window = stamped.find((p) => p.edit === 'window')!;
  assertClose(window.x, -3, 1e-9, 'the local offset rotated');
  assertClose(window.z, 0, 1e-9, 'the local offset rotated');
  assertEqual(window.yawDegrees, 90, 'piece yaw composed with the stamp yaw');
});

test('composition turn and piece spin share one frame: a turned room keeps its corners', () => {
  // two walls meeting at a corner: one along x at the origin cell run, one
  // turned 90° at the same corner. After a 90° stamp, the pair must still
  // meet at a corner (envelope corners coincide), not pull apart.
  const prefab = prefabFromPieces('prefab.cornerProof', 'Corner', 'common', [
    { id: 'a', pieceId: 'wall.concrete.common', x: 1.5, y: 0, z: 0, yawDegrees: 0 },
    { id: 'b', pieceId: 'wall.concrete.common', x: 0, y: 0, z: 1.5, yawDegrees: 90 },
  ]);
  const stamped = stampPrefabPieces(prefab, { x: 10, y: 0, z: 10 }, 90).map((p, i) => ({ ...p, id: `s_${i}` }));
  const a = pieceBounds(stamped[0]);
  const b = pieceBounds(stamped[1]);
  // wall a (was along x, now along z) and wall b (was along z, now along x)
  // still touch: their envelopes overlap at the shared corner cell
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  assert(overlapX > -1e-9 && overlapZ > -1e-9, 'the turned composition still meets at its corner');
});

test('clone-from-world round-trips: capture a composition, stamp it back, identical pieces', () => {
  const composition = [
    placed('wall.stucco.motel', 4, 4, { edit: 'door' }),
    placed('wall.stucco.motel', 4, 7, { yawDegrees: 90 }),
    placed('floor.concrete.common', 5, 5),
  ];
  const prefab = prefabFromPieces(mintPrefabId('My Corner'), 'My Corner', 'motel', composition);
  assertEqual(prefab.id, 'prefab.myCorner', 'the id follows the catalog convention');
  assertEqual(validatePrefab(prefab).length, 0, 'the captured prefab validates');
  const stamped = stampPrefabPieces(prefab, { x: 4, y: 0, z: 4 }, 0); // back at the captured origin
  for (let i = 0; i < composition.length; i += 1) {
    assertClose(stamped[i].x, composition[i].x, 1e-9, `piece ${i} returns to its spot (x)`);
    assertClose(stamped[i].z, composition[i].z, 1e-9, `piece ${i} returns to its spot (z)`);
    assertEqual(stamped[i].edit, composition[i].edit, `piece ${i} keeps its cutout — piece granularity survives cloning`);
  }
});

// ── the world stream carries the pieces (one truth, deterministic replay) ────

test('placement events materialize pieces with replay-deterministic ids', () => {
  const events: WorldEvent[] = [
    { kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 } },
    { kind: 'piecePlaced', placement: { pieceId: 'floor.concrete.common', x: 3, y: 0, z: 0, yawDegrees: 0 } },
  ];
  const once = fold(events);
  const twice = fold(events);
  assertEqual(once.pieces.length, 2, 'both placements stand');
  assertEqual(once.pieces[0].id, 'bp_1', 'ids are minted in order');
  assertEqual(twice.pieces[1].id, once.pieces[1].id, 'replaying the log reproduces identical ids');
});

test('PROJSCOPE-0606: placed pieces are consumed per project/map, not from the global pool', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'project-a', placement: { pieceId: 'floor.concrete.common', x: 3, y: 0, z: 3, yawDegrees: 0 } });
  const aAfterPlace = piecesForMap(state, 'project-a').map((p) => p.id);
  const bAfterSwitch = piecesForMap(state, 'project-b').map((p) => p.id);
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'project-b', placement: { pieceId: 'wall.concrete.common', x: 9, y: 0, z: 9, yawDegrees: 0 } });
  const bAfterPlace = piecesForMap(state, 'project-b').map((p) => p.id);
  const aAfterReturn = piecesForMap(state, 'project-a').map((p) => p.id);
  console.log(`[PROJSCOPE-0606] A=${JSON.stringify(aAfterPlace)} switchB=${JSON.stringify(bAfterSwitch)} B=${JSON.stringify(bAfterPlace)} returnA=${JSON.stringify(aAfterReturn)} global=${legacyGlobalPieces(state).length}`);

  assertEqual(aAfterPlace.length, 1, 'project A sees its placed floor');
  assertEqual(bAfterSwitch.length, 0, 'project B starts with no pieces from A');
  assertEqual(bAfterPlace.length, 1, 'project B can place its own piece');
  assertEqual(aAfterReturn.join(','), aAfterPlace.join(','), 'switching back restores A pieces');
  assertEqual(legacyGlobalPieces(state).length, 0, 'map-scoped placement does not write the legacy global pool');
});

test('PROJSCOPE-0606 live repair: the legacy global pool remains visible only to its owner map', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'piecePlaced', placement: { pieceId: 'floor.concrete.common', x: 1, y: 0, z: 1, yawDegrees: 0 } });
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'default-map', placement: { pieceId: 'wall.concrete.common', x: 4, y: 0, z: 4, yawDegrees: 0 } });

  const owner = piecesForMap(state, 'default-map', { legacyMapName: 'default-map' }).map((p) => p.id);
  const switched = piecesForMap(state, 'other-map', { legacyMapName: 'default-map' }).map((p) => p.id);
  console.log(`[PROJSCOPE-0606-LEGACY] owner=${JSON.stringify(owner)} switched=${JSON.stringify(switched)} global=${legacyGlobalPieces(state).length}`);

  assertEqual(owner.length, 2, 'the legacy owner sees pre-scoping pieces plus its scoped pieces');
  assertEqual(switched.length, 0, 'a switched map does not inherit the legacy pool');
  assertEqual(legacyGlobalPieces(state).length, 1, 'the legacy pool remains intact and unmigrated');
});

test('REQ-0410: build-mode piece mutations target the visible pool, including legacy owner pieces', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 1, y: 0, z: 1, yawDegrees: 0 } });
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'default-map', placement: { pieceId: 'floor.concrete.common', x: 4, y: 0, z: 4, yawDegrees: 0 } });

  const [legacyPiece, scopedPiece] = piecesForMap(state, 'default-map', { legacyMapName: 'default-map' });
  assertEqual(pieceMutationMapName(state, 'default-map', 'default-map', legacyPiece.id), undefined, 'legacy owner edits use the legacy global stream');
  assertEqual(pieceMutationMapName(state, 'default-map', 'default-map', scopedPiece.id), 'default-map', 'scoped edits stay in the map stream');

  const legacyMutationMap = pieceMutationMapName(state, 'default-map', 'default-map', legacyPiece.id);
  state = worldStream.apply(state, legacyMutationMap ? { kind: 'pieceRemoved', id: legacyPiece.id, mapName: legacyMutationMap } : { kind: 'pieceRemoved', id: legacyPiece.id });
  assertEqual(piecesForMap(state, 'default-map', { legacyMapName: 'default-map' }).map((p) => p.id).join(','), scopedPiece.id, 'X removes the legacy-visible target too');

  const scopedMutationMap = pieceMutationMapName(state, 'default-map', 'default-map', scopedPiece.id);
  state = worldStream.apply(state, scopedMutationMap ? { kind: 'pieceRemoved', id: scopedPiece.id, mapName: scopedMutationMap } : { kind: 'pieceRemoved', id: scopedPiece.id });
  assertEqual(piecesForMap(state, 'default-map', { legacyMapName: 'default-map' }).length, 0, 'X still removes normal map-scoped targets');
});

test('HOTRESTORE-0606: hot restore consumes the same map scope filter as fresh mount', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 1, y: 0, z: 1, yawDegrees: 0 } });
  state = worldStream.apply(state, { kind: 'piecePlaced', placement: { pieceId: 'floor.concrete.common', x: 2, y: 0, z: 2, yawDegrees: 0 } });
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'legacy-owner', placement: { pieceId: 'wall.concrete.common', x: 4, y: 0, z: 4, yawDegrees: 0 } });

  const clearHotRestore = piecesForMap(state, 'clear-map', { legacyMapName: null }).map((p) => p.id);
  const badOwnerEvidence = piecesForMap(state, 'clear-map', { legacyMapName: 'clear-map' }).map((p) => p.id);
  const ownerHotRestore = piecesForMap(state, 'legacy-owner', { legacyMapName: 'legacy-owner' }).map((p) => p.id);
  console.log(`[HOTRESTORE-0606] clearMap=${JSON.stringify(clearHotRestore)} badCurrentOwner=${JSON.stringify(badOwnerEvidence)} legacyOwner=${JSON.stringify(ownerHotRestore)} global=${legacyGlobalPieces(state).length}`);

  assertEqual(clearHotRestore.length, 0, 'a clear map hot restore receives no legacy global pieces');
  assertEqual(badOwnerEvidence.length, 2, 'the regression shape: using the current clear map as legacy owner admits the global pool');
  assertEqual(ownerHotRestore.length, 3, 'the legacy owner still receives legacy plus scoped pieces across hot restore');
});

test('a prefab stamp is ONE event that lands as its semantic pieces', () => {
  const state = fold([{ kind: 'prefabStamped', prefabId: 'prefab.motelRoom', origin: { x: 10, y: 0, z: 10 }, yawDegrees: 0 }]);
  const seedCount = prefabDefinition('prefab.motelRoom').pieces.length;
  assertEqual(state.pieces.length, seedCount, 'the stamp decomposed — no opaque blob');
  assert(state.pieces.some((p) => p.edit === 'door'), 'the cloned doorway is still a doorway');
});

test('a prefab stamp carries resolved face skins with the window edit into placed pieces', () => {
  const state = fold([
    {
      kind: 'prefabDefined',
      def: {
        id: 'prefab.skinnedWindow',
        label: 'Skinned Window',
        theme: 'common',
        skins: {
          wall: {
            front: { kind: 'material', id: 'd-neon-stucco' },
            back: { kind: 'color', value: '#f8fafc' },
            sides: { kind: 'color', value: '#111827' },
          },
        },
        pieces: [
          { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0, edit: 'window' },
        ],
      },
    },
    { kind: 'prefabStamped', prefabId: 'prefab.skinnedWindow', origin: { x: 10, y: 0, z: 10 }, yawDegrees: 0 },
  ]);
  const wall = state.pieces[0];
  assertEqual(wall.edit, 'window', 'the placed wall still has the window cutout');
  assertEqual(wall.skin?.front?.kind, 'material', 'the front face carries a material skin');
  assertEqual(wall.skin?.front?.kind === 'material' ? wall.skin.front.id : '', 'd-neon-stucco', 'the material id survives placement');
  assertEqual(wall.skin?.back?.kind === 'color' ? wall.skin.back.value : '', '#f8fafc', 'the back color survives placement');
  assertEqual(wall.skin?.sides?.kind === 'color' ? wall.skin.sides.value : '', '#111827', 'the side color survives placement');
});

test('a prefab skin edit refreshes already stamped test-route pieces', () => {
  const base = {
    id: 'prefab.liveSkinnedWall',
    label: 'Live Skinned Wall',
    theme: 'common' as const,
    pieces: [
      { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 },
    ],
  };
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'prefabDefined', def: base });
  state = worldStream.apply(state, { kind: 'prefabStamped', mapName: 'test-map', prefabId: base.id, origin: { x: 10, y: 0, z: 10 }, yawDegrees: 0 });
  assertEqual(piecesForMap(state, 'test-map')[0].skin, undefined, 'the first stamp starts bare');

  state = worldStream.apply(state, {
    kind: 'prefabDefined',
    def: {
      ...base,
      skins: {
        wall: {
          front: { kind: 'color', value: '#dc2626' },
          back: { kind: 'color', value: '#16a34a' },
          sides: { kind: 'color', value: '#2563eb' },
        },
      },
    },
  });

  const wall = piecesForMap(state, 'test-map')[0];
  assertEqual(wall.prefabId, base.id, 'the placed copy remembers its building type');
  assertEqual(wall.skin?.front?.kind === 'color' ? wall.skin.front.value : '', '#dc2626', 'front skin refreshed on the placed piece');
  assertEqual(wall.skin?.back?.kind === 'color' ? wall.skin.back.value : '', '#16a34a', 'back skin refreshed on the placed piece');
  assertEqual(wall.skin?.sides?.kind === 'color' ? wall.skin.sides.value : '', '#2563eb', 'side skin refreshed on the placed piece');
});

test('a world-saved prefab joins the registry family and stamps by id', () => {
  const def = prefabFromPieces('prefab.testHut', 'Test Hut', 'common', [
    placed('wall.concrete.common', 0, 0),
    placed('wall.concrete.common', 0, 3, { yawDegrees: 90 }),
  ]);
  const state = fold([
    { kind: 'prefabDefined', def },
    { kind: 'prefabStamped', prefabId: 'prefab.testHut', origin: { x: 20, y: 0, z: 20 }, yawDegrees: 0 },
    { kind: 'prefabStamped', prefabId: 'prefab.testHut', origin: { x: 40, y: 0, z: 20 }, yawDegrees: 0 },
  ]);
  assert(!!state.prefabs['prefab.testHut'], 'the definition is world data now');
  assertEqual(state.pieces.length, 4, 'each stamp landed its pieces');
});

test('PREFABSELECT-0606: selected map pieces save as a prefab and stamp with identical relative layout', () => {
  let state = worldStream.initial();
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'prefab-map', placement: { pieceId: 'floor.concrete.common', x: 6, y: 0, z: 6, yawDegrees: 0 } });
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'prefab-map', placement: { pieceId: 'wall.concrete.common', x: 6, y: 0, z: 4.5, yawDegrees: 0, edit: 'door' } });
  state = worldStream.apply(state, { kind: 'piecePlaced', mapName: 'other-map', placement: { pieceId: 'wall.concrete.common', x: 99, y: 0, z: 99, yawDegrees: 0 } });

  const authored = piecesForMap(state, 'prefab-map');
  const selectedIds = new Set(authored.slice(0, 2).map((p) => p.id));
  const selected = authored.filter((p) => selectedIds.has(p.id));
  const minX = Math.min(...selected.map((p) => p.x));
  const minY = Math.min(...selected.map((p) => p.y));
  const minZ = Math.min(...selected.map((p) => p.z));
  const def = prefabFromPieces('prefab.selectedDoorFloor', 'Selected Door Floor', 'common', selected);
  assertEqual(validatePrefab(def).length, 0, 'the selected composition is a valid prefab definition');

  state = worldStream.apply(state, { kind: 'prefabDefined', def });
  state = worldStream.apply(state, { kind: 'prefabStamped', mapName: 'prefab-map', prefabId: def.id, origin: { x: 30, y: 0, z: 30 }, yawDegrees: 0 });

  const after = piecesForMap(state, 'prefab-map');
  const stamped = after.slice(authored.length);
  assertEqual(stamped.length, selected.length, 'placing the prefab stamps the selected piece count');
  for (let i = 0; i < selected.length; i += 1) {
    assertEqual(stamped[i].pieceId, selected[i].pieceId, `piece ${i} kind carries`);
    assertEqual(stamped[i].edit, selected[i].edit, `piece ${i} edit carries`);
    assertClose(stamped[i].x - 30, selected[i].x - minX, 1e-9, `piece ${i} relative x is identical`);
    assertClose(stamped[i].y - 0, selected[i].y - minY, 1e-9, `piece ${i} relative y is identical`);
    assertClose(stamped[i].z - 30, selected[i].z - minZ, 1e-9, `piece ${i} relative z is identical`);
    assertEqual(stamped[i].yawDegrees, selected[i].yawDegrees, `piece ${i} yaw carries`);
  }
  assertEqual(piecesForMap(state, 'other-map').length, 1, 'prefab authoring stays scoped to the active map');
});

test('instance edits stay piece-granular after a stamp; removal removes one piece', () => {
  const state = fold([
    { kind: 'prefabStamped', prefabId: 'prefab.motelRoom', origin: { x: 0, y: 0, z: 0 }, yawDegrees: 0 },
    { kind: 'pieceEditSet', id: 'bp_2', edit: 'brokenWindow' },
    { kind: 'pieceRemoved', id: 'bp_6' },
  ]);
  assertEqual(state.pieces.find((p) => p.id === 'bp_2')?.edit, 'brokenWindow', 'one piece of the clone re-edited');
  assertEqual(state.pieces.length, prefabDefinition('prefab.motelRoom').pieces.length - 1, 'one piece of the clone removed');
});

test('the materializer is tolerant; the authoring boundary is strict', () => {
  const state = fold([
    { kind: 'piecePlaced', placement: { pieceId: 'wall.that.never.was', x: 0, y: 0, z: 0, yawDegrees: 0 } },
    { kind: 'prefabStamped', prefabId: 'prefab.never', origin: { x: 0, y: 0, z: 0 }, yawDegrees: 0 },
  ]);
  assertEqual(state.pieces.length, 0, 'foreign noise places nothing and crashes nothing');
  assert(validatePlacement({ pieceId: 'wall.that.never.was', x: 0, y: 0, z: 0, yawDegrees: 0 }).length > 0, 'the route-side validator names the problem before append');
  assert(validatePlacement({ pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0, edit: 'door' }).length > 0, 'edits on editless kinds are refused at the boundary');
});

// ── TOWERSKIN-0610: per-face paint on a standing piece ───────────────────────

test('pieceSkinSet paints one face of a STANDING piece — id stable, other slots kept', () => {
  let state = fold([
    { kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 } },
  ]);
  const id = state.pieces[0].id;
  state = worldStream.apply(state, { kind: 'pieceSkinSet', id, skin: { front: { kind: 'color', value: '#aa3311' } } });
  assertEqual(state.pieces[0].id, id, 'painting never re-mints the id (selection survives)');
  assertEqual(JSON.stringify(state.pieces[0].skin?.front), '{"kind":"color","value":"#aa3311"}', 'the painted face landed');
  // a second face MERGES — the first stays
  state = worldStream.apply(state, { kind: 'pieceSkinSet', id, skin: { back: { kind: 'material', id: 'a-brick' } } });
  assertEqual(JSON.stringify(state.pieces[0].skin?.front), '{"kind":"color","value":"#aa3311"}', 'painting the back keeps the front');
  assertEqual(JSON.stringify(state.pieces[0].skin?.back), '{"kind":"material","id":"a-brick"}', 'the second face landed');
  // malformed skins and unknown ids are refused like every malformed event
  const before = state;
  state = worldStream.apply(state, { kind: 'pieceSkinSet', id, skin: { front: { kind: 'color', value: 'red' } } as never });
  assertEqual(state, before, 'a non-#rrggbb color is refused at the materializer');
  state = worldStream.apply(state, { kind: 'pieceSkinSet', id: 'bp_nope', skin: { front: { kind: 'color', value: '#112233' } } });
  assertEqual(state, before, 'an unknown id paints nothing and crashes nothing');
});

// ── RAMPFOOT-0605: the ramp owns footing in its footprint ────────────────────

test('a wall beside a ramp never steals the slope: its band trims flush to the ramp edge', () => {
  // ramp at (6,6) spans x[4.5,7.5] z[4.5,7.5]; a wall on the z=4.5 line
  // overhangs 0.125m into the ramp cell — the strip that side-blocked
  // mid-slope and became a step-onto ledge at the crest (the user's nudge)
  const ramp = placed('ramp.concrete.common', 6, 6);
  const wall = placed('wall.concrete.common', 6, 4.5);
  const { rects } = placedPieceColliders([ramp, wall]);
  const wallRects = rects.slice(placedPieceColliders([ramp]).rects.length);
  assertEqual(wallRects.length, 1, 'the wall is still one band');
  assertClose(wallRects[0].maxZ, 4.5, 1e-9, 'trimmed flush to the ramp edge — no overhang into the slope');
  assert(wallRects[0].minZ < 4.5, 'the non-ramp side keeps its mass');
});

test('an upper-storey wall at the crest still blocks (its base IS the ramp top)', () => {
  const ramp = placed('ramp.concrete.common', 6, 6);
  const upper = placed('wall.concrete.common', 6, 4.5, { y: catalogEntry('ramp.concrete.common').size.heightMeters });
  const { rects } = placedPieceColliders([ramp, upper]);
  const wallRects = rects.slice(placedPieceColliders([ramp]).rects.length);
  const depth = catalogEntry('wall.concrete.common').size.depthMeters;
  assertClose(wallRects[0].maxZ - wallRects[0].minZ, depth, 1e-9, 'untrimmed — a wall above the slope is a legitimate blocker');
});

test('a landing plate over the crest keeps full collision (floors deliver, never trim)', () => {
  const ramp = placed('ramp.concrete.common', 6, 6);
  const landing = placed('floor.concrete.common', 6, 6, { y: catalogEntry('ramp.concrete.common').size.heightMeters });
  const { rects } = placedPieceColliders([ramp, landing]);
  const landingRects = rects.slice(placedPieceColliders([ramp]).rects.length);
  assertEqual(landingRects.length, 1, 'the plate is one band');
  assertClose(landingRects[0].maxZ - landingRects[0].minZ, catalogEntry('floor.concrete.common').size.depthMeters, 1e-9, 'full footprint — the crest delivery surface');
});

test('the surfaced edge case: a wall sandwiched between two ramps trims away entirely', () => {
  const wall = placed('wall.concrete.common', 6, 4.5);
  const rampA = placed('ramp.concrete.common', 6, 6);
  const rampB = placed('ramp.concrete.common', 6, 3);
  const { rects } = placedPieceColliders([rampA, rampB, wall]);
  const wallRects = rects.slice(placedPieceColliders([rampA, rampB]).rects.length);
  assertEqual(wallRects.length, 0, 'both overhangs trimmed — the band degenerates (documented in CAPTURE.md)');
});

// ── SMARTSEL-0605: one click grabs the connected shape ───────────────────────

test('the connected shape: floor → wall → next storey, in one grab; islands stay out', () => {
  const floorA = placed('floor.concrete.common', 1.5, 1.5);
  const wall = placed('wall.concrete.common', 1.5, 0, { yawDegrees: 0 }); // on floorA's edge line
  const storey = placed('floor.concrete.common', 1.5, 1.5, { y: 3 });    // resting on the wall top
  const island = placed('floor.concrete.common', 30.5, 30.5);            // far away
  const shape = connectedPieceIds(floorA.id, [floorA, wall, storey, island]);
  assert(shape.has(floorA.id) && shape.has(wall.id) && shape.has(storey.id), 'the whole tower comes along');
  assert(!shape.has(island.id), 'the detached island stays out');
  // transitivity: seeding from the TOP storey collects down to the ground floor
  const fromTop = connectedPieceIds(storey.id, [floorA, wall, storey, island]);
  assertEqual(fromTop.size, 3, 'the grab is transitive from any seed');
});

test('flush module neighbors touch: two grid-snapped plates are one shape', () => {
  const a = placed('floor.concrete.common', 1.5, 1.5);
  const b = placed('floor.concrete.common', 4.5, 1.5); // exactly abutting at x=3
  const shape = connectedPieceIds(a.id, [a, b]);
  assertEqual(shape.size, 2, 'abutting faces count as touching (module snap lands flush)');
  const apart = placed('floor.concrete.common', 7.5 + PLACED_TUNING.touchToleranceMeters * 4, 1.5);
  assert(!connectedPieceIds(a.id, [a, b, apart]).has(apart.id), 'a real gap breaks the shape');
});

test('an unknown seed grabs nothing', () => {
  assertEqual(connectedPieceIds('ghost', [placed('floor.concrete.common', 0, 0)]).size, 0, 'empty, no crash');
});

finish('build-placed');
