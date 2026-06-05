// world.test.ts — P4 behavior tests for GAME_WORLD (the V4 substrate, gap W-1).
//
// Meaning-tests per the dispatch: ground height at authored surfaces matches
// the reference math; spawn lands on ground; trigger cells fire; the collider
// derivation feeds GAME_PHYSICS and the figure stands on the authored map.

import {
  GAME_WORLD,
  WORLD_TUNING,
  type GridCell,
  type LandformPlacement,
  type WorldGridState,
  type WorldSurfaceRegion,
} from './index';
import { LANDFORM_TUNING, landformSurfaceTop, tileKindDefinition } from '../kinds';
import { assert, assertClose, assertEqual, assertThrows, finish, test, withHost } from '../_testkit';

declare const globalThis: any;

let regionSerial = 0;
function region(kind: WorldSurfaceRegion['kind'], x: number, z: number, width: number, depth: number, y = 0): WorldSurfaceRegion {
  regionSerial += 1;
  return { id: `r${regionSerial}`, label: `${kind} fill`, kind, x, y, z, width, depth, zoneKey: `zk${regionSerial}` };
}

function worldWith(mutate: (w: WorldGridState) => WorldGridState): WorldGridState {
  return mutate(GAME_WORLD.createState());
}

let landformSerial = 0;
function landform(kind: string, centerX: number, centerZ: number, params: Record<string, number>, field?: LandformPlacement['field'], baseY = 0): LandformPlacement {
  landformSerial += 1;
  return { id: `lf${landformSerial}`, kind, label: kind, centerX, centerZ, baseY, params, ...(field ? { field } : {}), createdByCommand: 'test' };
}

// ── heights: the reference math, case-swept ─────────────────────────────────

test('placed-cell top = cellBase + kind render height, across kinds and levels (R4: 1 tile = 1 m)', () => {
  const cases: Array<{ kind: any; y: number }> = [
    { kind: 'road', y: 0 }, { kind: 'sidewalk', y: 0 }, { kind: 'wall', y: 0 },
    { kind: 'save', y: 0 }, { kind: 'road', y: 2 }, { kind: 'wall', y: 3 },
  ];
  for (const c of cases) {
    const w = worldWith((s) => GAME_WORLD.placeCell(s, c.kind, { x: 4, y: c.y, z: 5 }, 'test'));
    const placed = GAME_WORLD.placedCellAt(w, { x: 4, y: c.y, z: 5 })!;
    assertClose(
      GAME_WORLD.placedCellTopMeters(placed, w.cellSizeMeters),
      c.y * 1 + tileKindDefinition(c.kind).render.heightMeters,
      1e-9,
      `${c.kind}@y${c.y} top must be cellBase + render height`,
    );
  }
});

test('surface-region top sinks by the mesh-sink so physics stands on the drawn surface', () => {
  for (const kind of ['road', 'sidewalk', 'sand', 'water'] as const) {
    const r = region(kind, 0, 0, 8, 8);
    const w = worldWith((s) => GAME_WORLD.addSurfaceRegion(s, r));
    assertClose(
      GAME_WORLD.surfaceRegionTopMeters(r, w.cellSizeMeters),
      tileKindDefinition(kind).render.heightMeters - WORLD_TUNING.surfaceRegionMeshSinkMeters,
      1e-9,
      `${kind} region top must be render height minus the sink`,
    );
  }
});

test('walkable ground: regions and cells report, walls and water do not, step-height gates reach', () => {
  const at = { x: 2.5, y: 0, z: 2.5 };
  const step = 0.5;

  const road = worldWith((s) => GAME_WORLD.addSurfaceRegion(s, region('road', 0, 0, 8, 8)));
  assertClose(GAME_WORLD.groundTopAtWorldPosition(road, at, step)!, 0.08 - 0.01, 1e-9, 'road region is ground');

  const water = worldWith((s) => GAME_WORLD.addSurfaceRegion(s, region('water', 0, 0, 8, 8)));
  assertEqual(GAME_WORLD.groundTopAtWorldPosition(water, at, step), undefined, 'water is not walkable ground');

  const wall = worldWith((s) => GAME_WORLD.placeCell(s, 'wall', { x: 2, y: 0, z: 2 }, 'test'));
  assertEqual(GAME_WORLD.groundTopAtWorldPosition(wall, at, step), undefined, 'a wall cell is not walkable ground');

  const tooHigh = worldWith((s) => GAME_WORLD.placeCell(s, 'road', { x: 2, y: 3, z: 2 }, 'test'));
  assertEqual(GAME_WORLD.groundTopAtWorldPosition(tooHigh, at, step), undefined, 'a top past step reach is unreachable');
  assertClose(GAME_WORLD.groundTopAtWorldPosition(tooHigh, { ...at, y: 3 }, step)!, 3.08, 1e-9, 'the same top within reach reports');
});

test('overlapping walkable layers: the highest reachable top wins', () => {
  const w = worldWith((s) => GAME_WORLD.placeCell(
    GAME_WORLD.addSurfaceRegion(s, region('road', 0, 0, 8, 8)),
    'sidewalk', { x: 2, y: 0, z: 2 }, 'test',
  ));
  assertClose(
    GAME_WORLD.groundTopAtWorldPosition(w, { x: 2.5, y: 0.2, z: 2.5 }, 0.5)!,
    0.11,
    1e-9,
    'the placed sidewalk top (0.11) must beat the sunk road region (0.07)',
  );
});

test('landform walkable ground matches the kind surface on flats and refuses the steep flank', () => {
  const lf = landform('mountain', 100, 100, { baseRadius: 48, peak: 30, trailStartAngle: Math.PI / 2 });
  const w = worldWith((s) => GAME_WORLD.placeLandform(s, lf));
  const T = LANDFORM_TUNING.mountain;

  // crater floor: flat, walkable, surface = peak − craterDepth
  const floorTop = GAME_WORLD.groundTopAtWorldPosition(w, { x: 100, y: 30, z: 100 }, 0.5);
  assertClose(floorTop!, 30 - T.craterDepthMeters, 1e-6, 'crater floor must report the cone formula height');
  assertClose(floorTop!, landformSurfaceTop(lf, 100, 100), 1e-9, 'walkable top must equal the kind registry surface');

  // mid-flank: the steep cone face is past the 24° walk limit → a wall, not
  // ground. (Radius picked OFF the spiral bench: the trail crosses angle 0 at
  // r=35 — its only walkable carve through this bearing.)
  const flankX = 100 + 29;
  assertEqual(
    GAME_WORLD.landformWalkableTopAt(w, { x: flankX, y: 30, z: 100 }, 60),
    undefined,
    'the steep flank must be a wall',
  );
  // …but the RAW surface (what a placed object rests on) still reports there
  const raw = GAME_WORLD.landformGroundTopAt(w, flankX, 100);
  assertClose(raw!, landformSurfaceTop(lf, flankX, 100), 1e-9, 'raw ground top must be the unguarded surface');
});

test('painted heightfield landform: ground follows the authored grid bilinearly', () => {
  // 3×3 grid, 2 m between samples: a single 4 m peak in the middle.
  const field = { cols: 3, rows: 3, cell: 2, heights: [0, 0, 0, 0, 4, 0, 0, 0, 0] };
  const lf = landform('heightfield', 0, 0, {}, field);
  const w = worldWith((s) => GAME_WORLD.placeLandform(s, lf));
  assertClose(GAME_WORLD.landformGroundTopAt(w, 0, 0)!, 4, 1e-6, 'the painted peak must be the surface');
  assertClose(GAME_WORLD.landformGroundTopAt(w, 1, 0)!, 2, 1e-6, 'half a cell off-peak must bilinear to half');
});

test('footing: water wins over everything, placed cell over landform, landform region footing over its surface tile', () => {
  const mountain = landform('mountain', 0, 0, { baseRadius: 48, peak: 30, trailStartAngle: 0 });
  const w = worldWith((s) => GAME_WORLD.placeLandform(s, mountain));

  // wading the crater tarn → 'water' regardless of the bed
  const T = LANDFORM_TUNING.mountain;
  const bedY = 30 - T.craterDepthMeters;
  assertEqual(GAME_WORLD.footingKindAtWorldPosition(w, { x: 0, y: bedY, z: 0 }), 'water', 'the crater tarn must read water');

  // the trailhead bench (u=0 → surface = baseY) reads the carved 'mud' footing
  const trailhead = { x: 48, y: 0, z: 0 };
  assertEqual(GAME_WORLD.footingKindAtWorldPosition(w, trailhead), 'mud', 'the trail bench must read its carved footing');

  // off-trail on the flank, standing on the surface → the kind surface tile
  const flankX = (T.craterRimRadiusMeters + 48) / 2;
  const flankY = landformSurfaceTop(mountain, flankX, 0);
  assertEqual(GAME_WORLD.footingKindAtWorldPosition(w, { x: flankX, y: flankY, z: 0 }), 'sand', 'off-trail flank must read the surface tile');

  // a placed cell wins over the landform footing
  const cellOnTrail = GAME_WORLD.placeCell(w, 'marker', { x: 48, y: 0, z: 0 }, 'test');
  assertEqual(GAME_WORLD.footingKindAtWorldPosition(cellOnTrail, trailhead), 'marker', 'a placed cell must shadow landform footing');
});

// ── spawn / respawn ──────────────────────────────────────────────────────────

test('a save marker pairs to its spawn; a self-pair is dropped', () => {
  const spawnCell: GridCell = { x: 1, y: 0, z: 1 };
  let w = worldWith((s) => GAME_WORLD.placeMarker(s, { kind: 'spawn', x: 1, z: 1 }, 'test'));
  w = GAME_WORLD.placeMarker(w, { kind: 'save', x: 5, z: 5, spawnKey: GAME_WORLD.cellKey(spawnCell) }, 'test');
  assertEqual(w.placedCells['5,0,5'].spawnKey, '1,0,1', 'the save must carry its paired spawn key');

  const selfPaired = GAME_WORLD.placeMarker(GAME_WORLD.createState(), { kind: 'save', x: 3, z: 3, spawnKey: '3,0,3' }, 'test');
  assertEqual(selfPaired.placedCells['3,0,3'].spawnKey, undefined, 'a save never spawns you on itself');
});

test('default spawn: the first spawn marker wins', () => {
  let w = worldWith((s) => GAME_WORLD.placeMarker(s, { kind: 'save', x: 0, z: 0 }, 'test'));
  assertEqual(GAME_WORLD.defaultSpawnCell(w), undefined, 'a save is not a spawn');
  w = GAME_WORLD.placeMarker(w, { kind: 'spawn', x: 7, z: 7 }, 'test');
  w = GAME_WORLD.placeMarker(w, { kind: 'spawn', x: 9, z: 9 }, 'test');
  const cell = GAME_WORLD.defaultSpawnCell(w)!;
  assertEqual(GAME_WORLD.cellKey(cell), '7,0,7', 'the first authored spawn must win');
});

test('respawn lands on the ground under the cell centre', () => {
  const w = worldWith((s) => GAME_WORLD.addSurfaceRegion(s, region('sidewalk', 0, 0, 8, 8)));
  const point = GAME_WORLD.respawnPoint(w, { x: 3, y: 0, z: 3 }, 0.5, 99);
  assertClose(point.position.x, 3.5, 1e-9, 'respawn x must be the cell centre');
  assertClose(point.position.z, 3.5, 1e-9, 'respawn z must be the cell centre');
  assertClose(point.position.y, 0.11 - 0.01, 1e-9, 'respawn y must snap to the walkable ground top');
  assert(point.groundedOnWorld, 'ground was under the cell');

  const bare = GAME_WORLD.respawnPoint(GAME_WORLD.createState(), { x: 3, y: 0, z: 3 }, 0.5, 99);
  assertClose(bare.position.y, 99, 1e-9, 'no ground → the caller fallback height');
  assert(!bare.groundedOnWorld, 'no ground was under the cell');
});

test('stepping on a save arms the paired spawn cell, once per entry; unpaired/dangling arm the save cell itself', () => {
  let w = worldWith((s) => GAME_WORLD.placeMarker(s, { kind: 'spawn', x: 1, z: 1 }, 'test'));
  w = GAME_WORLD.placeMarker(w, { kind: 'save', x: 5, z: 5, spawnKey: '1,0,1' }, 'test');
  const onSave = { x: 5.5, y: 0, z: 5.5 };

  const first = GAME_WORLD.enteredSaveStep(w, onSave, null);
  assertEqual(GAME_WORLD.cellKey(first.armed!.respawnCell), '1,0,1', 'the paired spawn must be armed');
  const held = GAME_WORLD.enteredSaveStep(w, onSave, first.lastSaveCellKey);
  assertEqual(held.armed, undefined, 'standing on the save must not re-fire');
  const reentered = GAME_WORLD.enteredSaveStep(w, onSave, GAME_WORLD.enteredSaveStep(w, { x: 0.5, y: 0, z: 0.5 }, held.lastSaveCellKey).lastSaveCellKey);
  assertEqual(GAME_WORLD.cellKey(reentered.armed!.respawnCell), '1,0,1', 'leaving and returning must re-fire');

  const unpaired = GAME_WORLD.placeMarker(GAME_WORLD.createState(), { kind: 'save', x: 5, z: 5 }, 'test');
  assertEqual(GAME_WORLD.cellKey(GAME_WORLD.enteredSaveStep(unpaired, onSave, null).armed!.respawnCell), '5,0,5', 'an unpaired save arms itself');

  const dangling = GAME_WORLD.placeMarker(GAME_WORLD.createState(), { kind: 'save', x: 5, z: 5, spawnKey: '9,0,9' }, 'test');
  assertEqual(GAME_WORLD.cellKey(GAME_WORLD.enteredSaveStep(dangling, onSave, null).armed!.respawnCell), '5,0,5', 'a dangling pair falls back to the save cell');
});

// ── trigger cells ────────────────────────────────────────────────────────────

test('a trigger cell fires its command once per entry and re-arms on command edit', () => {
  let w = worldWith((s) => GAME_WORLD.placeCell(s, 'marker', { x: 2, y: 0, z: 2 }, 'test'));
  w = GAME_WORLD.setCellTrigger(w, { x: 2, y: 0, z: 2 }, 'gv_scene boot.console', 'doorway');
  const onCell = { x: 2.5, y: 0, z: 2.5 };

  const first = GAME_WORLD.enteredTriggerStep(w, onCell, null);
  assertEqual(first.fired?.command, 'gv_scene boot.console', 'entering must fire the command line');
  assertEqual(first.fired?.label, 'doorway', 'the label must ride along');
  const held = GAME_WORLD.enteredTriggerStep(w, onCell, first.lastTriggerKey);
  assertEqual(held.fired, undefined, 'standing on the cell must not re-fire');

  const off = GAME_WORLD.enteredTriggerStep(w, { x: 9.5, y: 0, z: 9.5 }, held.lastTriggerKey);
  assertEqual(off.lastTriggerKey, null, 'leaving must reset the debounce');
  assert(GAME_WORLD.enteredTriggerStep(w, onCell, off.lastTriggerKey).fired != null, 'returning must fire again');

  const edited = GAME_WORLD.setCellTrigger(w, { x: 2, y: 0, z: 2 }, 'pv_teleport 0 0');
  const refired = GAME_WORLD.enteredTriggerStep(edited, onCell, first.lastTriggerKey);
  assertEqual(refired.fired?.command, 'pv_teleport 0 0', 'an edited command must re-arm in place');

  const cleared = GAME_WORLD.setCellTrigger(w, { x: 2, y: 0, z: 2 }, null);
  assertEqual(GAME_WORLD.enteredTriggerStep(cleared, onCell, null).fired, undefined, 'a cleared trigger must not fire');
  assertEqual(GAME_WORLD.triggerCellAtWorldPosition(cleared, onCell), undefined, 'a cleared cell is no trigger cell');
});

// ── the world→physics adapter ────────────────────────────────────────────────

test('collision rects carry the reference semantics: tops, blockers, surface profiles', () => {
  let w = worldWith((s) => GAME_WORLD.addSurfaceRegion(s, region('road', 0, 0, 8, 8)));
  w = GAME_WORLD.addSurfaceRegion(w, region('water', 10, 0, 4, 4));
  w = GAME_WORLD.placeCell(w, 'wall', { x: 2, y: 0, z: 2 }, 'test');
  const { rects, dropped } = GAME_WORLD.collisionRects(w);
  assertEqual(dropped, 0, 'nothing dropped under the cap');
  assertEqual(rects.length, 3, 'two regions + one cell');

  const road = rects[0];
  assertClose(road.topMeters, 0.07, 1e-9, 'road rect top must match the sunk region top');
  assertEqual(road.blocksPlayer, false, 'walkable road never blocks');
  assertClose(road.friction, tileKindDefinition('road').surface.friction, 1e-9, 'friction from the kind table');
  assertEqual(road.maxX, 8, 'region width in meters');

  const water = rects[1];
  assertEqual(water.blocksPlayer, false, 'water does not block (you wade/swim, the surface slows you)');

  const wall = rects[2];
  assertEqual(wall.blocksPlayer, true, 'a wall blocks');
  assertClose(wall.topMeters, 1.6, 1e-9, 'wall rect top = render height');
  assertEqual(wall.maxX - wall.minX, 1, 'a placed cell is one tile');
});

test('rect derivation truncates at the host cap and SAYS so', () => {
  let w = GAME_WORLD.createState();
  for (let i = 0; i < 520; i += 1) {
    w = GAME_WORLD.placeCell(w, 'wall', { x: i, y: 0, z: 0 }, 'test');
  }
  const { rects, dropped } = GAME_WORLD.collisionRects(w);
  assertEqual(rects.length, 512, 'the host rect cap');
  assertEqual(dropped, 8, 'every dropped rect is reported');
});

test('a painted landform bakes to the host heightfield 1:1 — see-it == walk-it', () => {
  const field = { cols: 3, rows: 3, cell: 2, heights: [0, 1, 0, 1, 4, 1, 0, 1, 0] };
  const lf = landform('heightfield', 50, 60, {}, field, 0.5);
  const w = worldWith((s) => GAME_WORLD.placeLandform(s, lf));
  const { fields, dropped } = GAME_WORLD.heightfields(w);
  assertEqual(dropped, 0, 'nothing dropped');
  assertEqual(fields.length, 1, 'one landform, one field');
  const hf = fields[0];
  assertEqual(hf.slot, 0, 'slots assign in array order');
  assertEqual(hf.cols, 3, 'a painted field bakes its own grid, no resampling');
  assertClose(hf.cellSizeMeters, 2, 1e-9, 'grid spacing preserved');
  assertClose(hf.originX, 50 - 2, 1e-9, 'origin = center − halfWidth');
  assertClose(hf.originZ, 60 - 2, 1e-9, 'origin = center − halfWidth');
  assertClose(hf.baseY, 0.5, 1e-9, 'baseY carried');
  for (let i = 0; i < field.heights.length; i += 1) {
    assertClose(hf.heights[i], field.heights[i], 1e-6, `authored sample ${i} must bake verbatim`);
  }
});

test('unknown landform kinds and slots past the host table count as dropped', () => {
  let w = worldWith((s) => GAME_WORLD.placeLandform(s, landform('not-a-kind', 0, 0, {})));
  assertEqual(GAME_WORLD.heightfields(w).dropped, 1, 'an unknown kind is dropped, not faked');

  w = GAME_WORLD.createState();
  const field = { cols: 2, rows: 2, cell: 1, heights: [0, 0, 0, 0] };
  for (let i = 0; i < GAME_WORLD.heightfieldSlots + 3; i += 1) {
    w = GAME_WORLD.placeLandform(w, landform('heightfield', i * 10, 0, {}, field));
  }
  const baked = GAME_WORLD.heightfields(w);
  assertEqual(baked.fields.length, GAME_WORLD.heightfieldSlots, 'the host slot table bounds registration');
  assertEqual(baked.dropped, 3, 'overflow is reported');
});

test('registerHeightfields clears then registers through the GAME_PHYSICS door', () => {
  const calls: string[] = [];
  const registered: any[] = [];
  withHost({
    __game_physics_clear_heightfields: () => { calls.push('clear'); },
    __game_physics_register_heightfield: (...args: any[]) => { calls.push('register'); registered.push(args); },
  }, () => {
    const field = { cols: 2, rows: 2, cell: 3, heights: [0, 1, 2, 3] };
    let w = worldWith((s) => GAME_WORLD.placeLandform(s, landform('heightfield', 0, 0, {}, field)));
    w = GAME_WORLD.placeLandform(w, landform('heightfield', 20, 0, {}, field));
    const result = GAME_WORLD.registerHeightfields(w);
    assertEqual(result.fields.length, 2, 'both baked');
  });
  assertEqual(calls[0], 'clear', 'clear must precede registration (replace, never accrete)');
  assertEqual(calls.length, 3, 'clear + one register per field');
  assertEqual(registered[0][0], 0, 'slot 0 first');
  assertEqual(registered[1][0], 1, 'slot 1 second');
  assert(registered[0][8] instanceof Float32Array, 'heights ride the wire as a Float32Array');
});

// ── the authored map, end to end ─────────────────────────────────────────────

const AUTHORED = {
  schemaVersion: 9,
  player: { position: { x: 60.5, y: 0, z: 60.5 }, respawnCell: { x: 60, y: 0, z: 60 } },
  world: {
    cellSizeMeters: 1,
    surfaceRegions: [
      { id: 'chunk', label: 'sand fill', kind: 'sand', x: 0, y: 0, z: 0, width: 120, depth: 120, zoneKey: 'chunk' },
    ],
    placedCells: {
      '60,0,60': { key: '60,0,60', kind: 'spawn', cell: { x: 60, y: 0, z: 60 }, createdByCommand: 'hmsc-int:marker' },
      '64,0,60': { key: '64,0,60', kind: 'save', cell: { x: 64, y: 0, z: 60 }, spawnKey: '60,0,60', createdByCommand: 'hmsc-int:marker' },
    },
    landforms: [
      {
        id: 'painted_hill', kind: 'heightfield', label: 'painted hill',
        centerX: 80, centerZ: 80, baseY: 0,
        params: {},
        field: { cols: 3, rows: 3, cell: 4, heights: [0, 0, 0, 0, 6, 0, 0, 0, 0] },
        createdByCommand: 'hmsc-int:paint',
      },
    ],
    roads: [],
  },
};

test('the authored map loads through the door from the editor compile channel', () => {
  withHost({
    __localstoreGet: (ns: string, key: string) =>
      ns === 'hmsc' && key === 'game-state' ? JSON.stringify(AUTHORED) : null,
  }, () => {
    const authored = GAME_WORLD.loadAuthoredWorld();
    assert(authored != null, 'the boot key must load');
    assertEqual(authored!.grid.surfaceRegions.length, 1, 'the painted chunk region arrives');
    assertEqual(Object.keys(authored!.grid.placedCells).length, 2, 'the markers arrive');
    assertEqual(authored!.grid.landforms.length, 1, 'the painted hill arrives');
    assertEqual(GAME_WORLD.cellKey(authored!.player.respawnCell!), '60,0,60', 'the armed respawn arrives');
    assertClose(authored!.player.position!.x, 60.5, 1e-9, 'the start position arrives');
    assert(Array.isArray((authored!.raw as any).world.roads), 'unowned layers pass through raw for their lanes');
  });
});

test('the figure stands on the authored map: ground + colliders derive from the loaded data', () => {
  withHost({
    __localstoreGet: (ns: string, key: string) =>
      ns === 'hmsc' && key === 'game-state' ? JSON.stringify(AUTHORED) : null,
  }, () => {
    const authored = GAME_WORLD.loadAuthoredWorld()!;
    const grid = authored.grid;

    // spawn lands on the painted chunk's ground
    const spawn = GAME_WORLD.respawnPoint(grid, authored.player.respawnCell!, 0.5, 99);
    assert(spawn.groundedOnWorld, 'the authored spawn must be over ground');
    assertClose(
      spawn.position.y,
      tileKindDefinition('sand').render.heightMeters - WORLD_TUNING.surfaceRegionMeshSinkMeters,
      1e-9,
      'spawn y must be the painted chunk surface',
    );

    // the painted hill is walkable ground at its authored height
    assertClose(GAME_WORLD.landformGroundTopAt(grid, 80, 80)!, 6, 1e-6, 'the painted peak stands 6 m');

    // the collider derivation hands GAME_PHYSICS exactly the authored heights
    const registered: any[] = [];
    withHost({
      __game_physics_clear_heightfields: () => undefined,
      __game_physics_register_heightfield: (...args: any[]) => { registered.push(args); },
    }, () => {
      GAME_WORLD.registerHeightfields(grid);
    });
    assertEqual(registered.length, 1, 'the painted hill registers as one heightfield');
    const heights = registered[0][8] as Float32Array;
    assertClose(heights[4], 6, 1e-6, 'the host receives the authored peak verbatim');

    const { rects } = GAME_WORLD.collisionRects(grid);
    assert(rects.length >= 1, 'the chunk region contributes a stand-on rect');
    assertEqual(rects[0].blocksPlayer, false, 'painted ground is stand-on, not a wall');
  });
});

test('mutators validate at the boundary: an unknown tile kind throws', () => {
  assertThrows(
    () => GAME_WORLD.placeCell(GAME_WORLD.createState(), 'lava' as any, { x: 0, y: 0, z: 0 }, 'test'),
    'an unknown kind must be rejected loudly',
  );
});

// ── the V20 world stream ─────────────────────────────────────────────────────

test('the world stream materializes grid edits into the snapshot the game loads', () => {
  let s = GAME_WORLD.stream.initial();
  s = GAME_WORLD.stream.apply(s, { kind: 'regionFilled', region: region('road', 0, 0, 4, 4) });
  s = GAME_WORLD.stream.apply(s, { kind: 'cellPlaced', tile: 'spawn', cell: { x: 1, y: 0, z: 1 }, sourceLine: 'wv_place spawn 1 1' });
  s = GAME_WORLD.stream.apply(s, { kind: 'cellPlaced', tile: 'marker', cell: { x: 2, y: 0, z: 2 }, sourceLine: 'wv_place marker 2 2' });
  s = GAME_WORLD.stream.apply(s, { kind: 'triggerSet', cell: { x: 2, y: 0, z: 2 }, command: 'pv_respawn' });
  s = GAME_WORLD.stream.apply(s, { kind: 'cellRemoved', cell: { x: 2, y: 0, z: 2 } });
  s = GAME_WORLD.stream.apply(s, { kind: 'respawnArmed', cell: { x: 1, y: 0, z: 1 } });

  assertEqual(s.grid.surfaceRegions.length, 1, 'the fill landed');
  assertEqual(Object.keys(s.grid.placedCells).length, 1, 'place + place + remove = one cell');
  assertEqual(s.grid.placedCells['1,0,1'].kind, 'spawn', 'the spawn survived');
  assertEqual(GAME_WORLD.cellKey(s.respawnCell!), '1,0,1', 'the armed respawn materialized');

  const before = s;
  s = GAME_WORLD.stream.apply(s, { kind: 'somethingFromTheFuture' } as any);
  assertEqual(s, before, 'unknown event kinds pass through untouched (V20: addition, never migration)');
});

finish('world');
