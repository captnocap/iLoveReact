import { EMPTY_WORLD_FINISHES, validWorldFinishes } from './worldFinishes';
import { pickFloorTriangleHit, type FloorPickTriangle } from './floorPick';

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

test('finishes parse strictly and absence is the empty layer (req_4739)', () => {
  assert(validWorldFinishes(undefined) === EMPTY_WORLD_FINISHES, 'absent block must be THE empty layer');
  assert(validWorldFinishes(null) === EMPTY_WORLD_FINISHES, 'null block must be the empty layer');
  const parsed = validWorldFinishes({ floors: { 'room:1': 'shader:brick' }, openings: { 'o:0': 'skin-a' } });
  assert(parsed.floors['room:1'] === 'shader:brick' && parsed.openings['o:0'] === 'skin-a', 'round-trip lost entries');
  const empty = validWorldFinishes({});
  assert(Object.keys(empty.floors).length === 0 && Object.keys(empty.openings).length === 0, 'missing maps default empty');
  let threw = false;
  try { validWorldFinishes({ floors: { 'room:1': 7 } }); } catch { threw = true; }
  assert(threw, 'a non-string finish must be refused');
  threw = false;
  try { validWorldFinishes({ floors: [] }); } catch { threw = true; }
  assert(threw, 'an array floors block must be refused');
});

// One unit square room plate at y=0 split into two top triangles, plus a
// bottom triangle that must never take a pick.
const PLATE: FloorPickTriangle[] = [
  { faceSignature: 'room:a', role: 'top', corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { faceSignature: 'room:a', role: 'top', corners: [[0, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { faceSignature: 'room:a', role: 'bottom', corners: [[0, -0.1, 0], [1, -0.1, 1], [1, -0.1, 0]] },
  { faceSignature: 'room:b', role: 'top', corners: [[3, 1, 0], [4, 1, 0], [4, 1, 1]] },
];

test('the floor pick hits the plate under the ray, nearest room wins (req_4739)', () => {
  const down = { x: 0, y: -1, z: 0 };
  const hit = pickFloorTriangleHit({ x: 0.5, y: 5, z: 0.5 }, down, PLATE);
  assert(hit && hit.faceSignature === 'room:a', 'the ray over room a must pick room a');
  assert(hit && Math.abs(hit.t - 5) < 1e-6, 'the hit distance must be exact');
  assert(pickFloorTriangleHit({ x: 3.5, y: 5, z: 0.5 }, down, PLATE)?.faceSignature === 'room:b', 'the raised room b plate picks under its own ray');
  assert(pickFloorTriangleHit({ x: 9, y: 5, z: 9 }, down, PLATE) === null, 'off every plate is an honest miss');
  assert(pickFloorTriangleHit({ x: 0.5, y: -5, z: 0.5 }, down, PLATE) === null, 'plates behind the ray never pick');
  // A slanted ray that leaves room b's column before reaching its height lands
  // where the geometry says: room a at t=1 (y=0, x=0.5).
  const slanted = pickFloorTriangleHit({ x: 3.5, y: 2, z: 0.5 }, { x: -3, y: -2, z: 0 }, PLATE);
  assert(slanted && slanted.faceSignature === 'room:a' && Math.abs(slanted.t - 1) < 1e-6, 'the slanted ray picks the plate it actually crosses');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
