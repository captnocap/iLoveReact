import type { MeshDocPartMeta } from '../data/meshDoc';
import { FART_RACER_VEHICLE_PART_NAMES, isFartRacerVehicleVisual, partitionFartRacerVehicleMesh } from './fartRacerVehicleVisual';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A saved package: one range per part, joined by durable object id. `order`
 *  permutes the STORAGE order of both tables — which is host-part order on
 *  disk, and is not the order the modeller sees or controls. */
function saved(order: readonly number[] = FART_RACER_VEHICLE_PART_NAMES.map((_, index) => index)) {
  const parts: MeshDocPartMeta[] = order.map((source) => ({
    name: FART_RACER_VEHICLE_PART_NAMES[source]!,
    objectId: `part:${source}`,
    color: '#fff',
    visible: true,
  } as MeshDocPartMeta));
  const doc = {
    ranges: order.map((source) => ({ lo: source, hi: source + 1 })),
    rangeObjectIds: order.map((source) => `part:${source}`),
  };
  return { doc, parts };
}

test('the schema is a set of named parts, not a storage order', () => {
  const forward = saved();
  assert(isFartRacerVehicleVisual(forward.doc, forward.parts), 'exact vehicle schema was rejected');

  // The real regression: a correctly built car — right names, right outliner
  // order — whose parts.json and blob happen to store rows in host-part order.
  const shuffled = saved([5, 4, 2, 3, 1, 0, 6, 7, 8, 9]);
  assert(isFartRacerVehicleVisual(shuffled.doc, shuffled.parts), 'schema depended on the order rows happen to be stored in');

  const renamed = saved();
  renamed.parts[1] = { ...renamed.parts[1]!, name: 'wheel' } as MeshDocPartMeta;
  assert(!isFartRacerVehicleVisual(renamed.doc, renamed.parts), 'renamed wheel escaped the schema');

  const unjoinable = saved();
  unjoinable.doc.rangeObjectIds = unjoinable.doc.rangeObjectIds.map((id) => `${id}-stale`);
  assert(!isFartRacerVehicleVisual(unjoinable.doc, unjoinable.parts), 'ranges that join no part passed the schema');
});

test('interleaved authored triangles become contiguous runtime slots in schema order', () => {
  // Stored back-to-front, so a slot order that came from storage order rather
  // than the schema would put the body's triangles somewhere else.
  const order = FART_RACER_VEHICLE_PART_NAMES.map((_, index) => FART_RACER_VEHICLE_PART_NAMES.length - 1 - index);
  const { doc, parts } = saved(order);
  const triangleCount = FART_RACER_VEHICLE_PART_NAMES.length * 2;
  const vertices = new Float32Array(triangleCount * 24);
  const faceGroups = new Uint32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    faceGroups[triangle] = triangle % FART_RACER_VEHICLE_PART_NAMES.length;
    vertices[triangle * 24] = triangle + 1;
  }
  const partitioned = partitionFartRacerVehicleMesh({ vertices, faceGroups, ...doc }, parts);
  assert(partitioned.slots.length === 10, 'part slot count drifted');
  assert(partitioned.slots.every((slot) => slot.count === 6), 'each two-triangle part did not become six vertices');
  assert(partitioned.vertices[0] === 1 && partitioned.vertices[24] === 11, 'body triangles did not become the first contiguous slot');
  assert(partitioned.vertices[48] === 2, 'front-left wheel did not follow the body slot');
});

log(`\nfart racer vehicle visual: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} Fart Racer vehicle visual test(s) failed`);
