import {
  measuredWallOpeningKit,
  wallOpeningCatalogSlug,
  wallOpeningExportTargetForCommand,
  wallOpeningKitPlaceable,
  WALL_OPENING_EXPORT_TARGETS,
  type MeshBoundsMeters,
} from './architectureKitExport';
import { validateArchitectureKitDeclaration } from './architecture';
import { projectArchitectureCatalogEntry } from './architectureCatalog';

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

// door_001's real shape: 1m wide, 2.125m tall from the floor, 0.25m deep, centered on x/z.
const DOOR_BOUNDS: MeshBoundsMeters = { minX: -0.5, minY: 0, minZ: -0.125, maxX: 0.5, maxY: 2.125, maxZ: 0.125 };

test('measurement projects meters onto the 16u lattice with an outward-rounded footprint', () => {
  const { measurement, minimumThicknessU } = measuredWallOpeningKit(DOOR_BOUNDS);
  assert(measurement.sourceBoundsU.minXU === -8 && measurement.sourceBoundsU.maxXU === 8, 'x bounds in u');
  assert(measurement.sourceBoundsU.maxYU === 34, 'height in u');
  assert(measurement.mountBoundsU!.minU === -8 && measurement.mountBoundsU!.maxV === 34, 'mount face rect');
  assert(measurement.footprint!.minColumn === -8 && measurement.footprint!.maxColumnExclusive === 8, 'footprint columns');
  assert(measurement.footprint!.minRow === 0 && measurement.footprint!.maxRowExclusive === 34, 'footprint rows');
  assert(measurement.clearanceMask.length === 0, 'flush placement allowed — no clearance (req_4500)');
  assert(minimumThicknessU === 4, '0.25m housing depth = minimum 4u');
});

test('fractional bounds round the footprint outward, never inward', () => {
  const { measurement } = measuredWallOpeningKit({ minX: -0.51, minY: 0, minZ: -0.1, maxX: 0.52, maxY: 2.01, maxZ: 0.1 });
  assert(measurement.footprint!.minColumn === -9, 'floor of -8.16');
  assert(measurement.footprint!.maxColumnExclusive === 9, 'ceil of 8.32');
  assert(measurement.footprint!.maxRowExclusive === 33, 'ceil of 32.16');
  assert(measurement.mountBoundsU!.minU !== measurement.footprint!.minColumn, 'mount keeps the exact measured floats');
});

test('degenerate and non-finite bounds refuse loudly', () => {
  let threw = 0;
  for (const bad of [
    { ...DOOR_BOUNDS, maxX: DOOR_BOUNDS.minX },
    { ...DOOR_BOUNDS, maxY: DOOR_BOUNDS.minY },
    { ...DOOR_BOUNDS, minX: Number.NaN },
  ]) {
    try { measuredWallOpeningKit(bad); } catch { threw += 1; }
  }
  assert(threw === 3, 'every degenerate bounds threw');
});

test('paper-thin kits still declare a walkable 1u minimum housing depth', () => {
  const { minimumThicknessU } = measuredWallOpeningKit({ ...DOOR_BOUNDS, minZ: 0, maxZ: 0.01 });
  assert(minimumThicknessU === 1, 'depth clamps up to 1u');
});

test('the door placeable validates, projects, and content-addresses itself', () => {
  const target = wallOpeningExportTargetForCommand('export-wall-opening-door');
  assert(target && target.kind === 'door' && target.portalClass === 'walk', 'door target resolves');
  assert(target!.needsDoorLeafPart, 'door export keeps the named Door Leaf contract');
  const placeable = wallOpeningKitPlaceable({ target: target!, name: 'door_001', bounds: DOOR_BOUNDS, meshContentHash: HASH });
  const { install, ...declaration } = placeable;
  validateArchitectureKitDeclaration(declaration);
  assert(install.catalogId === 'build:wall:opening:door:door-001', 'catalog id from kind + slug');
  assert(/^[0-9a-f]{64}$/.test(install.contentHash), 'content hash is 64-hex');
  assert(install.assetRefs.meshContentHash === HASH, 'mesh hash carried');
  assert(install.wallOpeningCompatibility!.minimumThicknessU === 4, 'measured minimum housing depth');
  assert(install.wallOpeningCompatibility!.portalClass === 'walk', 'a door is a walk portal');
  const entry = projectArchitectureCatalogEntry({ id: 'package:door-001', name: 'door_001', placeable });
  assert(entry && entry.semanticKind === 'door', 'boot projection installs the kit');
});

test('same content addresses the same entry; any measured change re-addresses', () => {
  const target = WALL_OPENING_EXPORT_TARGETS.find((t) => t.id === 'door')!;
  const a = wallOpeningKitPlaceable({ target, name: 'door_001', bounds: DOOR_BOUNDS, meshContentHash: HASH });
  const b = wallOpeningKitPlaceable({ target, name: 'door_001', bounds: DOOR_BOUNDS, meshContentHash: HASH });
  assert(a.install.contentHash === b.install.contentHash, 'deterministic content hash');
  const moved = wallOpeningKitPlaceable({ target, name: 'door_001', bounds: { ...DOOR_BOUNDS, maxY: 2.25 }, meshContentHash: HASH });
  assert(moved.install.contentHash !== a.install.contentHash, 'remeasured content re-addresses');
  const repainted = wallOpeningKitPlaceable({ target, name: 'door_001', bounds: DOOR_BOUNDS, meshContentHash: 'cd'.repeat(32) });
  assert(repainted.install.contentHash !== a.install.contentHash, 'new mesh document re-addresses');
});

test('window and vehicle kinds declare their own portal classes', () => {
  const window = WALL_OPENING_EXPORT_TARGETS.find((t) => t.id === 'window')!;
  const win = wallOpeningKitPlaceable({
    target: window, name: 'window_001', meshContentHash: HASH,
    bounds: { minX: -0.625, minY: 0.875, minZ: -0.1, maxX: 0.625, maxY: 2.125, maxZ: 0.1 },
  });
  assert(win.install.wallOpeningCompatibility!.portalClass === 'none', 'a window is not a portal');
  assert(win.measurement.footprint!.minRow === 14, 'sill height survives in the footprint');
  assert(!window.needsDoorLeafPart, 'windows have no swinging leaf contract');
  const garage = WALL_OPENING_EXPORT_TARGETS.find((t) => t.id === 'garage-door')!;
  assert(garage.portalClass === 'vehicle', 'garage doors pass vehicles');
});

test('catalog slugs are stable and readable', () => {
  assert(wallOpeningCatalogSlug('door_001') === 'door-001', 'underscores become dashes');
  assert(wallOpeningCatalogSlug('  Fancy DOOR (v2)! ') === 'fancy-door-v2', 'punctuation collapses');
  let threw = false;
  try { wallOpeningCatalogSlug('___'); } catch { threw = true; }
  assert(threw, 'an unnameable model refuses');
});

test('unknown export commands resolve to null, never a guess', () => {
  assert(wallOpeningExportTargetForCommand('export-wall-opening-portcullis') === null, 'unknown kind');
  assert(wallOpeningExportTargetForCommand('export-prop') === null, 'foreign command family');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
