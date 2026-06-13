// compile/worldInteractables tests — the INTERACTABLES lump carries /test's
// prop interaction layer (E to sit/lie/search) into the compiled game, so the
// wire layout the Zig decoder (framework/world/constructor.zig
// parseInteractables) reads must round-trip exactly here, and the factoring
// must hold: one archetype per kind, thin instance refs.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import { propContainer, propKindDefinition, propSeat } from '../game/kinds/props';
import type { WorldProp } from '../design';
import { createInteractableSink, decodeInteractables, encodeInteractables } from './worldInteractables';

const prop = (kind: WorldProp['kind'], x: number, y: number, z: number, yawDegrees = 0): WorldProp => ({
  id: `t-${kind}-${x}-${z}`,
  kind,
  x,
  y,
  z,
  yawDegrees,
  createdByCommand: 'test',
});

test('sink collects only seat/container kinds, one archetype per kind', () => {
  const sink = createInteractableSink();
  sink.collect(prop('diningChair', 1, 0, 1));
  sink.collect(prop('diningChair', 4, 0, 2, 90));
  sink.collect(prop('dumpster', 8, 0, 3));
  sink.collect(prop('fireHydrant', 2, 0, 9)); // neither seat nor container
  assertEqual(sink.archetypes.length, 2, 'chair + dumpster archetypes, hydrant skipped');
  assertEqual(sink.instances.length, 3, 'three interactable instances');
  assertEqual(sink.instances[0].archetype, sink.instances[1].archetype, 'both chairs reference ONE archetype');
  assert(sink.instances[2].archetype !== sink.instances[0].archetype, 'dumpster references its own archetype');
});

test('encode/decode round-trips the registry data exactly', () => {
  const sink = createInteractableSink();
  sink.collect(prop('bedDouble', 10, 0.5, 20, 45));
  sink.collect(prop('mailbox', -3, 0, 7));
  const decoded = decodeInteractables(encodeInteractables(sink));
  assertEqual(decoded.version, 1, 'lump version');
  assertEqual(decoded.archetypes.length, 2, 'two archetypes');
  assertEqual(decoded.instances.length, 2, 'two instances');

  const bed = decoded.archetypes[decoded.instances[0].archetype];
  const bedSeat = propSeat('bedDouble');
  assert(bedSeat !== null, 'bedDouble carries seat data in the registry');
  assertEqual(bed.flags & 1, 1, 'bed archetype has the seat flag');
  assertEqual(bed.seatPose, bedSeat!.pose, 'bed pose is lay');
  assertClose(bed.seatHeightMeters, bedSeat!.seatHeightMeters, 1e-6, 'seat height travels');
  assertEqual(bed.label, propKindDefinition('bedDouble').label, 'label travels');

  const mailbox = decoded.archetypes[decoded.instances[1].archetype];
  const mailboxContainer = propContainer('mailbox');
  assert(mailboxContainer !== null, 'mailbox carries container data in the registry');
  assertEqual(mailbox.flags & 2, 2, 'mailbox archetype has the container flag');
  assertEqual(mailbox.access, mailboxContainer!.access, 'locked access travels');
  assertEqual(mailbox.lootCategory, mailboxContainer!.lootCategory, 'loot category travels');
  assertClose(mailbox.searchSeconds, mailboxContainer!.searchSeconds, 1e-6, 'search seconds travel');

  assertClose(decoded.instances[0].x, 10, 1e-6, 'instance x');
  assertClose(decoded.instances[0].y, 0.5, 1e-6, 'instance y');
  assertClose(decoded.instances[0].yawDegrees, 45, 1e-6, 'instance yaw');
});

test('empty world encodes a valid empty lump', () => {
  const decoded = decodeInteractables(encodeInteractables(createInteractableSink()));
  assertEqual(decoded.archetypes.length, 0, 'no archetypes');
  assertEqual(decoded.instances.length, 0, 'no instances');
});

finish('worldInteractables');
