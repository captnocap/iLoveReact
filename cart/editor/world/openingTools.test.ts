import {
  armedOpeningKitById,
  armedOpeningKitFromEntries,
  openingCatalogIdOf,
  openingEdgeRefusal,
  openingGhostCorners,
  openingPaletteGroups,
  openingPaletteId,
  snapOpeningSlot,
  type OpeningKitArm,
} from './openingTools';
import type { ArchitectureCatalogEntry, WallCell } from './architecture';

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

test('the armed kit projects from the first installed entry of its kind', () => {
  assert(KIT && KIT.catalogId === 'build:wall:opening:door:door-001', 'door kit arms');
  assert(KIT.minimumThicknessU === 4 && KIT.footprint.maxRowExclusive === 34, 'measured fields carried');
  assert(armedOpeningKitFromEntries([doorEntry()], 'window') === null, 'no window kit installed → null, never a guess');
  const second = doorEntry({ catalogId: 'build:wall:opening:door:door-002', label: 'door_002' });
  assert(armedOpeningKitFromEntries([doorEntry(), second], 'door')!.label === 'door_001', 'first installed kit wins');
});

test('hover slides along the wall at the AUTHORED height; empty enumeration snaps nowhere', () => {
  const slots: WallCell[] = [
    { columnU: 8, rowU: 0 }, { columnU: 9, rowU: 0 }, { columnU: 40, rowU: 0 },
  ];
  assert(snapOpeningSlot(slots, 10, 2)!.columnU === 9, 'nearest column');
  assert(snapOpeningSlot(slots, 39, 0)!.columnU === 40, 'far hover finds the far slot');
  assert(snapOpeningSlot(slots, 8, 0)!.columnU === 8, 'exact hover keeps its slot');
  assert(snapOpeningSlot([], 10, 0) === null, 'no slots → no snap');
  // req_4524: a 35u door in a 48u wall enumerates anchor rows 0..13 — hovering
  // HIGH on the wall must not pin the doorway to the ceiling. The lowest legal
  // row (the authored elevation) always wins; the hover only picks the column.
  const tallWall: WallCell[] = [
    { columnU: 12, rowU: 0 }, { columnU: 35, rowU: 0 },
    { columnU: 12, rowU: 13 }, { columnU: 35, rowU: 13 },
  ];
  const high = snapOpeningSlot(tallWall, 35, 33)!;
  assert(high.rowU === 0 && high.columnU === 35, 'high hover stays a floor-standing door');
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

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
