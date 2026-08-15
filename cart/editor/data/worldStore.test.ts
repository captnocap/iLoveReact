import {
  emptyWorldSave,
  parseWorldSaveText,
  readWorldSave,
  saveWorldNow,
  worldStoreTesting,
  type WorldSnapshotInput,
} from './worldStore';
import { cloneArchitectureSource, type ArchitectureSource } from '../world/architecture';
import { createMapDocument, mapDocumentPaths } from './mapDocuments';
import { readFile, remove, writeFile } from '../../../runtime/hooks/fs';
import type { PlacedPiece } from '../world/pieces';

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

function rejects(run: () => void, contains: string): void {
  try {
    run();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(contains),
      `expected rejection containing '${contains}', got '${error instanceof Error ? error.message : String(error)}'`);
    return;
  }
  throw new Error(`expected rejection containing '${contains}'`);
}

function architecture(): ArchitectureSource {
  return {
    version: 1,
    revision: 4,
    walls: {
      vertices: [
        { id: 'v0', floor: 0, xU: 0, zU: 0 },
        { id: 'v1', floor: 0, xU: 32, zU: 0 },
      ],
      edges: [{
        id: 'edge0',
        startVertexId: 'v0',
        endVertexId: 'v1',
        support: { kind: 'absolute', baseYU: 0 },
        heightU: 48,
        thicknessU: 4,
        profile: 'full',
        styleId: 'build:wall:style:measured',
        sideA: { materialId: 'material:inside' },
        sideB: { materialId: 'material:outside' },
        openings: [{
          id: 'door0',
          kind: 'door',
          kitId: 'build:wall:opening:door:measured',
          columnU: 8,
          rowU: 0,
          facingSide: 'a',
          hinge: 'start',
        }],
      }],
      anchors: [],
    },
  };
}

function ordinaryPiece(id: string, pieceId = 'floor.concrete.common'): PlacedPiece {
  return { id, pieceId, x: 1, y: 0, z: 2, yawDegrees: 0, floor: 0 };
}

test('v5 round-trips semantic architecture and ordinary pieces exactly', () => {
  const save = emptyWorldSave('v5-roundtrip', 12);
  save.architecture = architecture();
  save.pieces = [ordinaryPiece('floor'), ordinaryPiece('prop', 'prop:chair')];
  const loaded = parseWorldSaveText(JSON.stringify(save), 'v5-roundtrip');
  assert(loaded.version === 5 && loaded.architecture.revision === 4, 'v5 architecture revision was lost');
  assert(loaded.architecture.walls.edges[0]?.openings[0]?.kitId === 'build:wall:opening:door:measured', 'opening kit reference was lost');
  assert(loaded.pieces.map(piece => piece.id).join('|') === 'floor|prop', 'ordinary pieces did not round-trip');
});

test('v5 rejects missing, fractional, derived, and wall-piece architecture shapes', () => {
  const missing: any = emptyWorldSave('strict-v5');
  delete missing.architecture;
  rejects(() => parseWorldSaveText(JSON.stringify(missing), 'strict-v5'), 'architecture');

  const fractional: any = emptyWorldSave('strict-v5');
  fractional.architecture = architecture();
  fractional.architecture.walls.vertices[0].xU = 0.5;
  rejects(() => parseWorldSaveText(JSON.stringify(fractional), 'strict-v5'), 'whole architecture unit');

  const derived: any = emptyWorldSave('strict-v5');
  derived.architecture = architecture();
  derived.architecture.walls.edges[0].face = 3;
  rejects(() => parseWorldSaveText(JSON.stringify(derived), 'strict-v5'), 'persisted field');

  const wallPiece = emptyWorldSave('strict-v5');
  wallPiece.pieces = [ordinaryPiece('legacy-wall', 'wall.concrete.common')];
  rejects(() => parseWorldSaveText(JSON.stringify(wallPiece), 'strict-v5'), 'legacy wall-kind record');
});

test('malformed source makes the named file write-protected', () => {
  const stem = createMapDocument(`world-v5-invalid-${Date.now()}`);
  const paths = mapDocumentPaths(stem);
  const invalid: any = emptyWorldSave(stem);
  invalid.architecture = { version: 1, revision: 0, walls: { vertices: 'broken', edges: [], anchors: [] } };
  const original = JSON.stringify(invalid);
  try {
    assert(writeFile(paths.world, original), 'could not write malformed v5 fixture');
    assert(readWorldSave(stem).status === 'invalid', 'malformed fixture did not enter write protection');
    assert(!saveWorldNow(emptyWorldSave(stem)), 'write-protected document accepted replacement bytes');
    assert(readFile(paths.world) === original, 'refused save changed malformed forensic bytes');
  } finally {
    remove(paths.world);
    remove(paths.painting);
    remove(paths.legacyMarker);
    remove(paths.dir);
  }
});

test('pre-v5 loads drop legacy wall pieces and keep every ordinary piece (req_4462)', () => {
  const v4: any = {
    version: 4,
    document: 'v4-wall-drop',
    seq: 7,
    pieces: [
      ordinaryPiece('floor'),
      ordinaryPiece('doomed-wall', 'wall.concrete.common'),
      ordinaryPiece('doomed-window', 'wall.stucco.window'),
      ordinaryPiece('prop', 'prop:chair'),
    ],
    objects: [], zones: [],
  };
  const loaded = parseWorldSaveText(JSON.stringify(v4), 'v4-wall-drop');
  assert(loaded.version === 5, 'pre-v5 load did not produce in-memory v5');
  assert(loaded.pieces.map(piece => piece.id).join('|') === 'floor|prop', 'wall drop disturbed ordinary pieces');
  assert(loaded.architecture.walls.edges.length === 0, 'pre-v5 load invented architecture');
  assert(loaded.seq === 7, 'pre-v5 seq was lost');
});

test('a v4 document on disk rewrites as v5 on the first save after load', () => {
  const stem = createMapDocument(`world-v4-upgrade-${Date.now()}`);
  const paths = mapDocumentPaths(stem);
  const v4 = { version: 4, document: stem, seq: 3, pieces: [ordinaryPiece('floor'), ordinaryPiece('gone', 'wall.plywood.brokenWindow')] };
  try {
    assert(writeFile(paths.world, JSON.stringify(v4)), 'could not write v4 fixture');
    const loaded = readWorldSave(stem);
    assert(loaded.status === 'ok' && loaded.save.pieces.length === 1, 'v4 fixture did not load with walls dropped');
    assert(saveWorldNow(loaded.save), 'first save after v4 load was refused');
    const text = readFile(paths.world);
    assert(text !== null && (JSON.parse(text) as { version: number }).version === 5, 'first save left pre-v5 bytes on disk');
  } finally {
    remove(paths.world);
    remove(paths.painting);
    remove(paths.legacyMarker);
    remove(paths.dir);
  }
});

test('v5 preserves all ordinary non-wall placed-piece payloads', () => {
  const save = emptyWorldSave('ordinary-preservation');
  save.pieces = [{
    ...ordinaryPiece('decor', 'prop:chair'),
    scale: 1.25,
    slots: { seat: { assetId: 'material:red' } },
    overrides: { opacity: 0.75, walkable: false },
    spinDegPerSec: 4,
  }];
  const loaded = parseWorldSaveText(JSON.stringify(save), 'ordinary-preservation');
  const piece = loaded.pieces[0]!;
  assert(piece.pieceId === 'prop:chair' && piece.scale === 1.25, 'ordinary transform payload changed');
  assert(piece.slots?.seat?.assetId === 'material:red' && piece.overrides?.walkable === false, 'ordinary material/property payload changed');
  assert(piece.spinDegPerSec === 4, 'ordinary motion payload changed');
});

test('debounce snapshot identity includes architecture and every named slice', () => {
  const shared = {
    pieces: [] as PlacedPiece[], worldFlora: [], prefabs: [], objects: [], zones: [], facades: [], views: [],
  };
  const input: WorldSnapshotInput = {
    document: 'identity', seq: 2, architecture: architecture(), ...shared,
  };
  const first = worldStoreTesting.snapshot(input);
  const same = worldStoreTesting.snapshot(input);
  assert(worldStoreTesting.sameWorldSnapshot(first, same), 'identical named snapshot references did not deduplicate');
  const changedArchitecture = worldStoreTesting.snapshot({ ...input, architecture: cloneArchitectureSource(input.architecture) });
  assert(!worldStoreTesting.sameWorldSnapshot(first, changedArchitecture), 'architecture identity was absent from debounce equality');
  const changedPieces = worldStoreTesting.snapshot({ ...input, pieces: [] });
  assert(!worldStoreTesting.sameWorldSnapshot(first, changedPieces), 'ordinary piece identity was absent from debounce equality');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
