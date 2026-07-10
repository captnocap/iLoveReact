// cart/editor/model/buildPieceStarter.test.ts — semantic build bases are real,
// grounded, editable meshes derived from the active build catalog.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/buildPieceStarter.test.ts --bundle \
//     --outfile=/tmp/editor-build-starter.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-build-starter.test.js

import { BUILD_PIECE_STARTERS } from '../data/buildStarters';
import { KIND_ORDER, catalogRowFor } from '../world/buildCatalog';
import { pieceVisualShapes } from '../world/pieceShapes';
import { editMeshToGeometry, meshHealth, type EditMesh } from './editMesh';
import { buildPieceStarterParts } from './buildPieceStarter';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function minY(mesh: EditMesh): number {
  return Math.min(...mesh.verts.map((vert) => vert[1]));
}

test('starter registry covers the complete build-kind grammar in palette order', () => {
  assert(BUILD_PIECE_STARTERS.map((starter) => starter.kind).join('|') === KIND_ORDER.join('|'), 'starter kind/order drift');
  for (const starter of BUILD_PIECE_STARTERS) {
    const row = catalogRowFor(starter.catalogPieceId);
    assert(row?.kind === starter.kind, `${starter.name} points at ${row?.kind ?? 'missing'} catalog geometry`);
  }
});

test('every build starter is grounded, editable, and emits triangles', () => {
  for (const kind of KIND_ORDER) {
    const parts = buildPieceStarterParts(kind);
    assert(parts.length === 1, `${kind} should open as one model part, got ${parts.length}`);
    const mesh = parts[0]?.mesh;
    assert(!!mesh, `${kind} has no EditMesh`);
    assert(mesh!.verts.length > 0 && mesh!.faces.length > 0, `${kind} mesh is empty`);
    assert(Math.abs(minY(mesh!)) < 1e-6, `${kind} starts off the ground at y=${minY(mesh!)}`);
    assert(meshHealth(mesh!).errors === 0, `${kind} starter has invalid topology`);
    assert(editMeshToGeometry(mesh!).positions.length > 0, `${kind} emits no render triangles`);
  }
});

test('stairs and elevator retain their compound silhouettes', () => {
  const stairs = buildPieceStarterParts('stairs')[0]!.mesh!;
  const elevator = buildPieceStarterParts('elevator')[0]!.mesh!;
  assert(stairs.verts.length > buildPieceStarterParts('wall')[0]!.mesh!.verts.length, 'stairs collapsed to a box');
  assert(elevator.verts.length > buildPieceStarterParts('pillar')[0]!.mesh!.verts.length, 'elevator collapsed to a pillar');
});

test('the arch kind seeds a real open frame instead of a solid wall', () => {
  const starter = BUILD_PIECE_STARTERS.find((entry) => entry.kind === 'arch')!;
  const shapes = pieceVisualShapes({ id: 'arch-proof', pieceId: starter.catalogPieceId, x: 0, y: 0, z: 0, yawDegrees: 0 }, '#ffffff');
  const keys = shapes.map((shape) => shape.kind === 'box' ? shape.box.key : shape.ramp.key);
  assert(keys.some((key) => key.includes('leftJamb')), `arch has no left jamb: ${keys.join(', ')}`);
  assert(keys.some((key) => key.includes('rightJamb')), `arch has no right jamb: ${keys.join(', ')}`);
  assert(keys.some((key) => key.includes('header')), `arch has no header: ${keys.join(', ')}`);
  assert(!keys.some((key) => key.includes('.band.')), 'arch regressed to a solid band');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
