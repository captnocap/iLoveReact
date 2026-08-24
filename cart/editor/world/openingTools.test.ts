import {
  armedOpeningKitById,
  clampOpeningCell,
  openingWorldPose,
  armedOpeningKitFromEntries,
  openingCatalogIdOf,
  openingEdgeRefusal,
  openingGhostCorners,
  openingGizmoFrame,
  openingLatticeFill,
  openingPaletteGroups,
  openingPaletteId,
  openingRectCenter,
  openingSideOfPoint,
  snapOpeningSlot,
  type OpeningGizmoFrame,
  type OpeningKitArm,
} from './openingTools';
import type { ArchitectureCatalogEntry, ArchitectureSource, WallCell } from './architecture';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const HASH = 'ab'.repeat(32);

function doorEntry(overrides: Partial<ArchitectureCatalogEntry> = {}): ArchitectureCatalogEntry {
  return {
    catalogId: 'build:wall:opening:door:door-001',
    contentHash: HASH,
    packageId: 'package:door-001',
    label: 'door_001',
    family: 'wall',
    role: 'opening',
    semanticKind: 'door',
    categoryPath: ['Walls', 'Openings', 'Door'],
    themeTags: [],
    gameplayTags: [],
    measurement: {
      sourceBoundsU: { minXU: -8, minYU: 0, minZU: -2, maxXU: 8, maxYU: 34, maxZU: 2 },
      mountBoundsU: { minU: -8, minV: 0, maxU: 8, maxV: 34 },
      footprint: { minColumn: -8, minRow: 0, maxColumnExclusive: 8, maxRowExclusive: 34 },
      clearanceMask: [],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    wallOpeningCompatibility: { permittedProfiles: ['full'], minimumThicknessU: 4, portalClass: 'walk' },
    assetRefs: { meshContentHash: HASH, materialContentHashes: [] },
    ...overrides,
  };
}

const KIT: OpeningKitArm = armedOpeningKitFromEntries([doorEntry()], 'door')!;

test('lattice fill stretches a between-subdivisions kit onto its footprint (RULED req_4719)', () => {
  // window_003's real shape: mount face ±8.17u wide, 7.82..22.68u tall →
  // footprint -9..9 × 7..23. The wall cuts those whole cells; the fill must
  // map the mount extremes EXACTLY onto them (meters) or slivers show.
  const fractional = doorEntry({
    catalogId: 'build:wall:opening:window:window-003',
    semanticKind: 'window',
    measurement: {
      sourceBoundsU: { minXU: -8.17, minYU: 7.82, minZU: -0.8, maxXU: 8.17, maxYU: 22.68, maxZU: 0.8 },
      mountBoundsU: { minU: -8.17, minV: 7.82, maxU: 8.17, maxV: 22.68 },
      footprint: { minColumn: -9, minRow: 7, maxColumnExclusive: 9, maxRowExclusive: 23 },
      clearanceMask: [],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
  });
  const fill = openingLatticeFill(fractional)!;
  assert(fill !== null, 'fractional kit gets a fill');
  const u = 16;
  const mapX = (xU: number) => (xU / u) * fill.scaleX + fill.offsetX;
  const mapY = (yU: number) => (yU / u) * fill.scaleY + fill.offsetY;
  assert(Math.abs(mapX(-8.17) - (-9 / u)) < 1e-9, `left edge lands on the cut (${mapX(-8.17)})`);
  assert(Math.abs(mapX(8.17) - (9 / u)) < 1e-9, 'right edge lands on the cut');
  assert(Math.abs(mapY(7.82) - (7 / u)) < 1e-9, 'sill lands on the cut');
  assert(Math.abs(mapY(22.68) - (23 / u)) < 1e-9, 'header lands on the cut');
  // door_001 measures lattice-exact — identity fill is ABSENT, its resident
  // stays byte-identical (why doors never gapped in the first place).
  assert(openingLatticeFill(doorEntry()) === null, 'lattice-exact kit needs no fill');
});

test('the armed kit projects from the first installed entry of its kind', () => {
  assert(KIT && KIT.catalogId === 'build:wall:opening:door:door-001', 'door kit arms');
  assert(KIT.minimumThicknessU === 4 && KIT.footprint.maxRowExclusive === 34, 'measured fields carried');
  assert(armedOpeningKitFromEntries([doorEntry()], 'window') === null, 'no window kit installed → null, never a guess');
  const second = doorEntry({ catalogId: 'build:wall:opening:door:door-002', label: 'door_002' });
  assert(armedOpeningKitFromEntries([doorEntry(), second], 'door')!.label === 'door_001', 'first installed kit wins');
});

test('hover slides the column; the WHEEL owns the row, defaulting to the authored height', () => {
  const slots: WallCell[] = [
    { columnU: 8, rowU: 0 }, { columnU: 9, rowU: 0 }, { columnU: 40, rowU: 0 },
  ];
  assert(snapOpeningSlot(slots, 10, 0)!.columnU === 9, 'nearest column');
  assert(snapOpeningSlot(slots, 39, 0)!.columnU === 40, 'far hover finds the far slot');
  assert(snapOpeningSlot([], 10, 0) === null, 'no slots → no snap');
  // req_4524/4526: anchor rows 0..13 on a tall wall — lift 0 keeps the door on
  // the floor no matter where the cursor is; the wheel's lift walks the rows
  // and clamps at the top like a prop's height dial.
  const tallWall: WallCell[] = [
    { columnU: 12, rowU: 0 }, { columnU: 35, rowU: 0 },
    { columnU: 12, rowU: 8 }, { columnU: 35, rowU: 8 },
    { columnU: 12, rowU: 13 }, { columnU: 35, rowU: 13 },
  ];
  assert(snapOpeningSlot(tallWall, 35, 0)!.rowU === 0, 'no lift → floor-standing door');
  assert(snapOpeningSlot(tallWall, 35, 8)!.rowU === 8, 'lift walks to the matching row');
  assert(snapOpeningSlot(tallWall, 35, 999)!.rowU === 13, 'over-lift clamps at the highest legal row');
  const lifted = snapOpeningSlot(tallWall, 14, 8)!;
  assert(lifted.columnU === 12, 'column still follows the cursor within the lifted row');
});

// An exact-fit seat (wall thickness == kit depth): offset 0, the pre-req_4491 pose.
const EXACT_SEAT = { wallThicknessU: 4, kitDepthU: 4 };

test('the mounted pose runs along the edge with the loader yaw law', () => {
  // +x wall: model +X must map to world +X → yaw 0.
  const east = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'a', EXACT_SEAT)!;
  assert(Math.abs(east.x - 2) < 1e-9 && east.z === 0 && east.y === 0, 'anchor in meters along the edge');
  assert(east.yawDegrees === 0, '+x edge → yaw 0');
  // +z wall: +X must map to +Z → world (cos, -sin) = (0, 1) → yaw 270.
  const south = openingWorldPose({ xM: 0, zM: 0 }, { xM: 0, zM: 4 }, 1.5, { columnU: 16, rowU: 4 }, 'a', EXACT_SEAT)!;
  assert(Math.abs(south.z - 1) < 1e-9 && Math.abs(south.y - 1.75) < 1e-9, 'position on a +z edge, base + row lift');
  assert(Math.abs(south.yawDegrees - 270) < 1e-9, '+z edge → yaw 270 under the loader law');
  const flipped = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'b', EXACT_SEAT)!;
  assert(flipped.yawDegrees === 180, 'facing side b turns the door around');
  assert(openingWorldPose({ xM: 1, zM: 1 }, { xM: 1, zM: 1 }, 0, { columnU: 0, rowU: 0 }, 'a', EXACT_SEAT) === null, 'degenerate edge mounts nothing');
});

test('a thicker wall deep-sets the kit flush with its facing side (RULED req_4491)', () => {
  // 16u (1m) wall, 4u (0.25m) kit → surplus 12u, offset 0.375m toward the
  // facing side. +x edge: side-a normal = (-dirZ, dirX) = (0, +1) → +Z.
  const seat = { wallThicknessU: 16, kitDepthU: 4 };
  const sideA = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'a', seat)!;
  assert(Math.abs(sideA.x - 2) < 1e-9, 'along-edge anchor is untouched by the seat');
  assert(Math.abs(sideA.z - 0.375) < 1e-9, `side a shifts +Z toward its face (z=${sideA.z})`);
  const sideB = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'b', seat)!;
  assert(Math.abs(sideB.z + 0.375) < 1e-9, `side b shifts -Z toward the opposite face (z=${sideB.z})`);
  // An exact fit stays on the centerline — the pose the user already verified.
  const exact = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'a', EXACT_SEAT)!;
  assert(exact.z === 0, 'exact-fit wall keeps the centerline mount');
  // A kit deeper than the wall never mounts short — the refusal gate already
  // rejected it; the seat clamps at flush rather than inventing a negative.
  const clamped = openingWorldPose({ xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0, { columnU: 32, rowU: 0 }, 'a', { wallThicknessU: 4, kitDepthU: 16 })!;
  assert(clamped.z === 0, 'over-deep kit clamps to the centerline, never negative');
});

test('static edge refusals name the reason the wall can never take the kit', () => {
  const fits = { profile: 'full' as const, thicknessU: 4, heightU: 48 };
  assert(openingEdgeRefusal(KIT, fits) === null, 'a compatible wall refuses nothing');
  assert(openingEdgeRefusal(KIT, { ...fits, thicknessU: 6 }) === null, 'thicker walls fit — minimum, not whitelist (req_4491)');
  const thin = openingEdgeRefusal(KIT, { ...fits, thicknessU: 2 });
  assert(thin && thin.includes('at least 4u'), `thin wall names the housing minimum (${thin})`);
  const half = openingEdgeRefusal(KIT, { ...fits, profile: 'half' });
  assert(half && half.includes('full'), 'profile refusal names the needed profile');
  const short = openingEdgeRefusal(KIT, { ...fits, heightU: 20 });
  assert(short && short.includes('taller'), 'a kit taller than the wall says so');
});

test('the ghost rectangle spans the footprint along the edge from its start', () => {
  const corners = openingGhostCorners(
    { xM: 0, zM: 0 }, { xM: 4, zM: 0 }, 0,
    { columnU: 32, rowU: 0 }, KIT.footprint,
  )!;
  // anchor 32u = 2m along a +x wall; footprint −8..8u = ±0.5m around it.
  assert(Math.abs(corners[0]!.x - 1.5) < 1e-9 && Math.abs(corners[1]!.x - 2.5) < 1e-9, 'columns → meters along the edge');
  assert(corners[0]!.y === 0 && Math.abs(corners[2]!.y - 2.125) < 1e-9, 'rows → meters of height');
  assert(corners.every((corner) => corner.z === 0), 'a +x wall keeps z fixed');
  const diagonal = openingGhostCorners({ xM: 0, zM: 0 }, { xM: 3, zM: 4 }, 1, { columnU: 40, rowU: 8 }, KIT.footprint)!;
  // 40u = 2.5m along the 5m edge; direction (0.6, 0.8).
  assert(Math.abs(diagonal[0]!.x - (2.5 - 0.5) * 0.6) < 1e-9, 'diagonal edges project through the unit direction');
  assert(Math.abs(diagonal[0]!.y - 1.5) < 1e-9, 'base height + row offset');
  assert(openingGhostCorners({ xM: 1, zM: 1 }, { xM: 1, zM: 1 }, 0, { columnU: 0, rowU: 0 }, KIT.footprint) === null, 'a degenerate edge draws nothing');
});

test('the palette is the kit picker: doors and windows group, ids round-trip, exact-id arming', () => {
  const window = doorEntry({
    catalogId: 'build:wall:opening:window:window-001', label: 'window_001',
    semanticKind: 'window',
    wallOpeningCompatibility: { permittedProfiles: ['full'], minimumThicknessU: 2, portalClass: 'none' },
  });
  const arch = doorEntry({ catalogId: 'build:wall:opening:arch:arch-001', label: 'arch_001', semanticKind: 'arch' });
  const groups = openingPaletteGroups([doorEntry(), window, arch]);
  assert(groups.length === 2 && groups[0]!.key === 'doorKits' && groups[1]!.key === 'windowKits', 'doors first, windows second');
  assert(groups[0]!.entries.length === 2, 'arch joins the door family');
  assert(groups[0]!.entries[0]!.paletteId === 'opening:build:wall:opening:door:door-001', 'palette id carries the catalog id');
  assert(openingCatalogIdOf(groups[0]!.entries[0]!.paletteId) === 'build:wall:opening:door:door-001', 'palette id round-trips');
  assert(openingCatalogIdOf('model:cube') === null, 'foreign palette ids resolve to null');
  assert(openingPaletteGroups([]).length === 0, 'no kits, no dead categories');
  const armed = armedOpeningKitById([doorEntry(), window], 'build:wall:opening:window:window-001');
  assert(armed && armed.label === 'window_001' && armed.minimumThicknessU === 2, 'exact-id arming picks THAT kit');
  assert(armedOpeningKitById([doorEntry()], 'build:wall:opening:door:gone') === null, 'a missing id arms nothing');
  assert(openingPaletteId('x') === 'opening:x', 'prefix law');
});

// ── Placed-opening gizmo laws (req_4738) ────────────────────────────────────

/** One 4m wall along +X on floor 0 with a 1m-wide door at column 24u. */
function gizmoSource(): ArchitectureSource {
  return {
    version: 1,
    revision: 3,
    walls: {
      vertices: [
        { id: 'v:0', floor: 0, xU: 0, zU: 0 },
        { id: 'v:1', floor: 0, xU: 64, zU: 0 },
      ],
      edges: [{
        id: 'e:0',
        startVertexId: 'v:0',
        endVertexId: 'v:1',
        support: { kind: 'absolute', baseYU: 0 },
        heightU: 48,
        thicknessU: 4,
        profile: 'full',
        styleId: 'build:wall:style:basic',
        sideA: { materialId: 'build:wall:style:basic' },
        sideB: { materialId: 'build:wall:style:basic' },
        openings: [{
          id: 'o:0', kind: 'door', kitId: 'kit:door', columnU: 24, rowU: 0,
          facingSide: 'a', hinge: 'start',
        }],
      }],
      anchors: [],
    },
  };
}

const DOOR_FOOTPRINT = { minColumn: -8, maxColumnExclusive: 8, minRow: 0, maxRowExclusive: 32 };

test('the gizmo frame resolves the selected opening on its wall (req_4738)', () => {
  const frame = openingGizmoFrame(gizmoSource(), { 'kit:door': DOOR_FOOTPRINT }, 'e:0', 'o:0');
  assert(frame, 'frame did not resolve');
  assert(frame.dir.x === 1 && frame.dir.z === 0, 'along-wall direction drifted');
  assert(frame.anchor.columnU === 24 && frame.anchor.rowU === 0, 'anchor cell drifted');
  assert(frame.edgeLengthU === 64 && frame.edgeHeightU === 48, 'wall bounds drifted');
  assert(frame.facingSide === 'a', 'facing side drifted');
  const center = openingRectCenter(frame, frame.anchor);
  // Column 24u + centered ±8u footprint → 24u = 1.5m along; rows 0..32 → 16u = 1m up.
  assert(Math.abs(center.x - 1.5) < 1e-9 && Math.abs(center.y - 1) < 1e-9 && Math.abs(center.z) < 1e-9, `rect center drifted: (${center.x},${center.y},${center.z})`);
  assert(openingGizmoFrame(gizmoSource(), {}, 'e:0', 'o:0') === null, 'an unmeasured kit must not grow a gizmo');
  assert(openingGizmoFrame(gizmoSource(), { 'kit:door': DOOR_FOOTPRINT }, 'e:0', 'o:gone') === null, 'a deleted opening must not grow a gizmo');
});

test('the drag clamp keeps the footprint inside the wall face, on whole units (req_4738)', () => {
  const frame = openingGizmoFrame(gizmoSource(), { 'kit:door': DOOR_FOOTPRINT }, 'e:0', 'o:0')!;
  assert(clampOpeningCell(frame, 30.4, 0).columnU === 30, 'a candidate must round to whole lattice units');
  assert(clampOpeningCell(frame, 500, 0).columnU === 56, 'the right clamp is length minus the footprint reach');
  assert(clampOpeningCell(frame, -500, 0).columnU === 8, 'the left clamp holds the footprint at the start vertex');
  assert(clampOpeningCell(frame, 24, 500).rowU === 16, 'the top clamp is height minus the footprint top');
  assert(clampOpeningCell(frame, 24, -3).rowU === 0, 'the bottom clamp is the floor');
});

test('the ring flip law names the wall side under a world point (req_4738)', () => {
  const frame = openingGizmoFrame(gizmoSource(), { 'kit:door': DOOR_FOOTPRINT }, 'e:0', 'o:0')!;
  // Engine side law: side-a normal = (-dirZ, dirX) = (0, 1) for a +X wall.
  assert(openingSideOfPoint(frame, { x: 1.5, z: 2 }) === 'a', '+Z of a +X wall is side a');
  assert(openingSideOfPoint(frame, { x: 1.5, z: -2 }) === 'b', '-Z of a +X wall is side b');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
