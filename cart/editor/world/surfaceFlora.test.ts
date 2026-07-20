// Focused pure tests for Studio-rigged flora-face painting recipes.
import {
  applyFloraPaintSamples,
  builtinFloraSpeciesId,
  builtinSurfaceFloraResidentMeshes,
  floraPaintSampleKey,
  rayTriangleIntersection,
  surfaceFloraMeshRefs,
  surfaceFloraResidentKey,
  type FloraPaintSample,
} from './surfaceFlora';
import type { PlacedPiece } from './pieces';
import { cacheAuthoredMesh } from './authoredMesh';
import { setAuthoredPieces } from './authoredRegistry';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

const hit = rayTriangleIntersection(
  { x: 0.25, y: 2, z: 0.25 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  10,
);
assert(hit?.t === 2, 'downward ray missed the authored triangle');
assert(rayTriangleIntersection(
  { x: 2, y: 2, z: 2 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 10,
) === null, 'ray outside the triangle produced a false hit');

const piece: PlacedPiece = { id: 'planter', pieceId: 'prop:planter', x: 0, y: 0, z: 0, yawDegrees: 0, floor: 0 };
const surface: FloraPaintSample = { kind: 'surface', pieceId: piece.id, role: 'flora-1', triangle: 2, lx: 0.2, ly: 1, lz: 0.3 };
const ground: FloraPaintSample = { kind: 'ground', x: 8, y: 0, z: 9 };
const painted = applyFloraPaintSamples(
  [piece], [], [surface, surface, ground],
  { speciesId: 'custom-flora:fern', mode: 'paint', density: 0.35, radiusM: 1.25 }, 20,
);
assert(painted.added === 2, 'stroke sample de-duplication failed');
assert(painted.pieces[0]!.surfaceFlora?.[0]?.role === 'flora-1', 'surface recipe did not attach to its semantic piece');
assert(painted.pieces[0]!.surfaceFlora?.[0]?.density === 0.35, 'stroke density was not stored on the surface recipe');
assert(painted.worldFlora[0]?.speciesId === 'custom-flora:fern', 'custom ground recipe was not stored');
assert(painted.sequence === 22, 'recipe ids did not consume the shared monotonic sequence');

const erased = applyFloraPaintSamples(
  painted.pieces, painted.worldFlora, [surface, ground],
  { speciesId: 'custom-flora:fern', mode: 'erase', density: 1, radiusM: 1.25 }, painted.sequence,
);
assert(erased.removed === 2, 'erase did not remove both recipe concerns');
assert(!erased.pieces[0]!.surfaceFlora && erased.worldFlora.length === 0, 'erased recipes survived');
assert(floraPaintSampleKey(surface) !== floraPaintSampleKey(ground), 'surface and ground sample namespaces collided');

const residentKeys = new Set(builtinSurfaceFloraResidentMeshes().map((mesh) => mesh.key));
for (const kind of ['grassLush', 'palmDense', 'bushDense'] as const) {
  assert(residentKeys.has(surfaceFloraResidentKey(builtinFloraSpeciesId(kind))), `${kind} has no rig-surface resident geometry`);
}

const vertex = (x: number, y: number, z: number) => [x, y, z, 0, 1, 0, 0, 0];
cacheAuthoredMesh('rotated-planter', new Float32Array([
  ...vertex(1, 0, 0), ...vertex(2, 0, 0), ...vertex(1, 0, 1),
]));
setAuthoredPieces([{ id: 'prop:rotated-planter', modelId: 'rotated-planter', pkgId: 'missing:rotated-planter', label: 'Planter', kind: 'prop', hex: '#fff' }]);
const rotatedRefs = surfaceFloraMeshRefs([{
  id: 'rotated', pieceId: 'prop:rotated-planter', x: 0, y: 0, z: 0, yawDegrees: 90,
  surfaceFlora: [{
    id: 'surface-flora-30', speciesId: 'builtin-flora:grassLush', role: 'flora_1', triangle: 0,
    lx: 1.2, ly: 0, lz: 0.2, density: 1, radiusM: 10, seed: 30,
  }],
}], [], []);
assert(rotatedRefs.length > 0, 'surface flora recipe did not expand');
assert(rotatedRefs.every((ref) => ref.x >= -1e-6 && ref.x <= 1.000001 && ref.z >= -2.000001 && ref.z <= -0.999999), 'surface flora detached from a +90° parent yaw');

console.log('surfaceFlora.test.ts: ok');
