// cookedAsset.test.ts — P4 tests for the asset compiler's cook core (Part 7,
// req_1122/req_1129). Pure + headless under tools/v8cli — proves the Guiding
// Light laws hold: content-addressed SEPARABLE factors (one model → prop + item
// shares the meshRef), MEASURED collision (derive, don't store twice), idempotent
// re-cook (same input → same hash), and fail-loud validation.

import { addTextureSlot, cuboid, addMount, setFaceGlass, type EditMesh } from './editMesh';
import { cookProp, flattenModel, validateProp, type CookPart, type PropDescriptorInput } from './cookedAsset';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

function part(mesh: EditMesh, lift = 0, visible = true): CookPart {
  return { mesh, lift, visible };
}

const PROP: PropDescriptorInput = { solid: true, tileKind: 'wall' };

test('flattenModel concats visible parts and measures bounds', () => {
  // a 2×1×2 cuboid lifted to sit on the ground (lift = 0.5).
  const blob = flattenModel([part(cuboid(2, 1, 2), 0.5)]);
  assert(blob.count > 0, 'soup has vertices');
  assertEqual(blob.verts.length, blob.count * 8, '8 floats per vertex');
  // bounds: x/z span 2, y span 1; lifted so y in [0,1].
  assertEqual(Math.round(blob.bounds.size[0]), 2, 'width 2');
  assertEqual(Math.round(blob.bounds.size[1]), 1, 'height 1');
  assertEqual(Math.round(blob.bounds.size[2]), 2, 'depth 2');
  assertEqual(Math.round(blob.bounds.min[1]), 0, 'sits on the ground (min y 0)');
});

test('invisible parts are excluded from the flatten', () => {
  const both = flattenModel([part(cuboid(1, 1, 1)), part(cuboid(1, 1, 1))]);
  const one = flattenModel([part(cuboid(1, 1, 1)), part(cuboid(1, 1, 1), 0, false)]);
  assertEqual(one.count * 2, both.count, 'one hidden = half the verts');
});

test('texture slots cook into named vertex ranges after unslotted triangles', () => {
  const added = addTextureSlot(cuboid(1, 1, 1), 'Screen', [0, 1]);
  const blob = flattenModel([part(added.mesh)]);
  assertEqual(blob.slots?.length ?? 0, 1, 'one cooked texture slot');
  const slot = blob.slots![0];
  assertEqual(slot.id, added.id, 'slot id carries');
  assertEqual(slot.label, 'Screen', 'slot label carries');
  assert(slot.start > 0, 'slotted range starts after unslotted triangles');
  assertEqual(slot.count, 12, 'two quad faces = four triangles = twelve vertices');
  assertEqual(slot.start + slot.count, blob.count, 'slot range ends at the soup end');
});

test('unassigned texture slots do not change the flattened mesh factor', () => {
  const plain = flattenModel([part(cuboid(1, 1, 1))]);
  const withEmptySlot = flattenModel([part(addTextureSlot(cuboid(1, 1, 1), 'Unused').mesh)]);
  assertEqual(withEmptySlot.slots, undefined, 'no assigned faces means no cooked slots');
  assertEqual(withEmptySlot.hash, plain.hash, 'mesh hash unchanged');
  assertEqual(withEmptySlot.verts.length, plain.verts.length, 'same vertex buffer length');
  assert(withEmptySlot.verts.every((v, i) => v === plain.verts[i]), 'vertex bytes unchanged');
});

test('glass faces split into a trailing sub-range, out of the opaque section (req_1673)', () => {
  // a cube (6 faces → 36 verts) with one face tagged glass: 5 opaque faces (30
  // verts) then the glass face's 2 triangles (6 verts) appended at the end.
  const glassy = setFaceGlass(cuboid(1, 1, 1), [0], true);
  const blob = flattenModel([part(glassy)]);
  assertEqual(blob.count, 36, 'every face still present (none dropped)');
  assert(blob.glass != null, 'a glass range is recorded');
  assertEqual(blob.glass!.count, 6, 'one glass face = two triangles = six vertices');
  assertEqual(blob.glass!.start, 30, 'glass sits after the five opaque faces');
  assertEqual(blob.glass!.start + blob.glass!.count, blob.count, 'glass is the trailing range');
});

test('a glass-free model carries no glass range and keeps its old factor', () => {
  const plain = flattenModel([part(cuboid(1, 1, 1))]);
  assertEqual(plain.glass, undefined, 'no glass faces means no glass range');
});

test('cookProp carries the glass range into the asset and its identity', () => {
  const glassy = setFaceGlass(cuboid(1, 1, 1), [0], true);
  const withGlass = cookProp({ id: 'studio.pane', name: 'Pane', parts: [part(glassy)], descriptor: PROP });
  const solid = cookProp({ id: 'studio.pane', name: 'Pane', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  assertEqual(withGlass.errors.length, 0, 'glass prop cooks clean');
  assertEqual(withGlass.asset.glass?.count, 6, 'asset carries the glass vertex count');
  assert(withGlass.asset.hash !== solid.asset.hash, 'glass participates in asset identity');
});

test('cookProp carries texture slots and folds them into the asset identity', () => {
  const added = addTextureSlot(cuboid(1, 1, 1), 'Screen', [0]);
  const slotted = cookProp({ id: 'studio.screen', name: 'Screen', parts: [part(added.mesh)], descriptor: PROP });
  const unslotted = cookProp({ id: 'studio.screen', name: 'Screen', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  assertEqual(slotted.errors.length, 0, 'slotted prop cooks clean');
  assertEqual(slotted.asset.slots?.[0]?.id, added.id, 'asset carries the slot id');
  assert(slotted.asset.hash !== unslotted.asset.hash, 'slot table participates in asset identity');
});

test('cookProp MEASURES footprint + height from the mesh (derive, not store)', () => {
  const { asset, errors } = cookProp({
    id: 'studio.crate', name: 'Crate', parts: [part(cuboid(2, 3, 4), 1.5)], descriptor: PROP,
  });
  assertEqual(errors.length, 0, 'valid prop cooks clean');
  assertEqual(Math.round(asset.descriptor.footprintWidthMeters), 2, 'measured width');
  assertEqual(Math.round(asset.descriptor.footprintDepthMeters), 4, 'measured depth');
  assertEqual(Math.round(asset.descriptor.heightMeters), 3, 'measured height');
  assertEqual(asset.kind, 'prop', 'kind = prop');
  assertEqual(asset.descriptor.kind, asset.id, 'descriptor kind = asset id (the placement key)');
  assertEqual(asset.meshRef, asset.meshRef && asset.meshRef.length === 64 ? asset.meshRef : 'BAD', 'meshRef is a sha256');
});

test('re-cooking the same model is idempotent (the hash is the cache key)', () => {
  const make = () => cookProp({ id: 'studio.a', name: 'A', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  assertEqual(make().asset.hash, make().asset.hash, 'same input → same asset hash');
  assertEqual(make().blob.hash, make().blob.hash, 'same input → same mesh blob hash');
});

test('factors are SEPARABLE: same mesh + different descriptor shares meshRef, differs in asset hash', () => {
  const parts = [part(cuboid(1, 1, 1))];
  const a = cookProp({ id: 'studio.x', name: 'X', parts, descriptor: { solid: true, tileKind: 'wall' } });
  const b = cookProp({ id: 'studio.x', name: 'X', parts, descriptor: { solid: false, tileKind: 'bush' } });
  assertEqual(a.asset.meshRef, b.asset.meshRef, 'shared geometry factor (one blob)');
  assert(a.asset.hash !== b.asset.hash, 'a descriptor change changes the asset identity');
});

test('a different mesh yields a different meshRef', () => {
  const a = cookProp({ id: 'studio.a', name: 'A', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  const b = cookProp({ id: 'studio.b', name: 'B', parts: [part(cuboid(2, 2, 2))], descriptor: PROP });
  assert(a.asset.meshRef !== b.asset.meshRef, 'distinct geometry → distinct content hash');
});

test('texRef rides as a reference when supplied (texture factor)', () => {
  const withTex = cookProp({ id: 'studio.t', name: 'T', parts: [part(cuboid(1, 1, 1))], texRef: 'abc123', descriptor: PROP });
  const noTex = cookProp({ id: 'studio.t', name: 'T', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  assertEqual(withTex.asset.texRef, 'abc123', 'texRef stored');
  assert(noTex.asset.texRef === undefined, 'untextured asset has no texRef');
  assertEqual(withTex.asset.meshRef, noTex.asset.meshRef, 'texture is separable from geometry');
  assert(withTex.asset.hash !== noTex.asset.hash, 'the texture factor is part of the identity');
});

test('mounts gather into the model frame with lift baked in', () => {
  const m = addMount(cuboid(1, 1, 1), { name: 'hub', kind: 'socket', position: [0, 0, 0] });
  const { asset } = cookProp({ id: 'studio.m', name: 'M', parts: [part(m, 0.5)], descriptor: PROP });
  assertEqual(asset.mounts.length, 1, 'one mount carried');
  assertEqual(asset.mounts[0].position[1], 0.5, 'lift baked into the mount position');
});

test('validation FAILS LOUD on an under-specified container prop', () => {
  const bad = cookProp({
    id: 'studio.safe', name: 'Safe', parts: [part(cuboid(1, 1, 1))],
    descriptor: { solid: true, tileKind: 'wall', container: { lootCategory: 'valuables', capacity: 0, spawnFillChance: 0.5, searchSeconds: 3, access: 'keyed' } },
  });
  assert(bad.errors.length > 0, 'a container with capacity 0 is rejected');
  assert(bad.errors.some((e) => e.includes('capacity')), 'the error names the missing field');
});

test('a PHYSICS prop cooks a dynamic body with a MEASURED radius + authored bounce', () => {
  // a barrel-ish 0.8×1.1×0.8 cuboid, kickable, bounce 0.18 (a drum/can).
  const { asset, errors } = cookProp({
    id: 'studio.drum', name: 'Drum', parts: [part(cuboid(0.8, 1.1, 0.8), 0.55)],
    descriptor: { solid: true, tileKind: 'wall', physics: { restitution: 0.18 } },
  });
  assertEqual(errors.length, 0, 'a valid physics prop cooks clean');
  assert(asset.descriptor.dynamics != null, 'it carries a dynamics body (KICKPROP)');
  assertEqual(asset.descriptor.dynamics!.restitution, 0.18, 'bounce is the authored value');
  // body radius is MEASURED from the footprint, not hand-typed.
  assertEqual(asset.descriptor.dynamics!.bodyRadiusMeters, asset.descriptor.footprintRadiusMeters, 'body radius = measured footprint radius');
});

test('a STATIC prop carries NO dynamics (the default nature)', () => {
  const { asset } = cookProp({ id: 'studio.s', name: 'S', parts: [part(cuboid(1, 1, 1), 0.5)], descriptor: PROP });
  assert(asset.descriptor.dynamics === undefined, 'static scenery has no physics body');
});

test('validation FAILS LOUD on out-of-range bounce', () => {
  const bad = cookProp({
    id: 'studio.bouncy', name: 'B', parts: [part(cuboid(1, 1, 1), 0.5)],
    descriptor: { solid: true, tileKind: 'wall', physics: { restitution: 1.8 } },
  });
  assert(bad.errors.some((e) => e.includes('restitution')), 'restitution > 1 is rejected loud');
});

test('validation FAILS LOUD on an empty mesh (no measurable footprint)', () => {
  const errors = validateProp({ kind: 'x' as any, label: 'X', solid: true, footprintRadiusMeters: 0, heightMeters: 0, tileKind: 'wall', trafficControl: 'none' });
  assert(errors.length >= 2, 'zero footprint AND zero height both flagged');
});

test('cookProp derives SHAPE-AWARE collision boxes — an archway keeps the gap walkable (req_1587)', () => {
  // two posts (0.5×3×0.5, lifted to stand on the ground) + a high beam (4×0.5×0.5,
  // lifted to y≈3) — three separate parts → three connected components → three boxes.
  const post = () => cuboid(0.5, 3, 0.5);
  const beam = cuboid(4, 0.5, 0.5);
  const { asset } = cookProp({
    id: 'studio.arch', name: 'Arch',
    parts: [part(post(), 1.5), part(post(), 1.5), part(beam, 3.25)],
    descriptor: PROP,
  });
  const boxes = asset.collision.boxes;
  assertEqual(boxes.length, 3, 'one box per component (two posts + a beam)');
  assertEqual(asset.descriptor.collisionBoxes?.length ?? 0, 3, 'boxes ride the descriptor for the physics consumer');
  const high = boxes.filter((b) => b.minY > 2.5);
  assertEqual(high.length, 1, 'exactly one HIGH band — the beam the player walks under');
  assert(high[0].maxX - high[0].minX > 3.5, 'the beam box spans the full width');
  const onGround = boxes.filter((b) => b.minY < 0.01);
  assertEqual(onGround.length, 2, 'two posts rest on the ground (solid to the floor)');
});

test('a single welded component cooks ONE collision box — no regression for solid props', () => {
  const { asset } = cookProp({ id: 'studio.block', name: 'Block', parts: [part(cuboid(2, 2, 2), 1)], descriptor: PROP });
  assertEqual(asset.collision.boxes.length, 1, 'one welded shape = one box');
  const b = asset.collision.boxes[0];
  assert(b.minY < 0.01 && b.maxY > 1.9, 'box spans the full height, solid to the ground');
});

test('a door leaf with a window splits into an opaque frame then a trailing glass pane (req_2020)', () => {
  // a wall body + a swinging leaf whose face 0 is glass (the window). The leaf is
  // laid out opaque-frame faces (5 faces, 30 verts) then the glass pane (6 verts),
  // so the compiled bake can render the window see-through and swing it with the frame.
  const body = cuboid(2, 2, 0.2);
  const leaf = setFaceGlass(cuboid(1, 2, 0.1), [0], true);
  const blob = flattenModel([part(body), part(leaf)], { leafPart: (p) => p.mesh === leaf });
  assert(blob.leaf != null, 'the leaf range is recorded');
  assert(blob.leafGlass != null, 'the leaf carries a trailing glass sub-range');
  assertEqual(blob.leafGlass!.count, 6, 'one window face = two triangles = six vertices');
  assertEqual(blob.leafGlass!.start + blob.leafGlass!.count, blob.leaf!.start + blob.leaf!.count, 'leaf glass is the tail of the leaf');
  assert(blob.leafGlass!.count < blob.leaf!.count, 'the leaf still has its opaque frame faces');
});

test('a glassless door leaf carries no leafGlass (no regression for solid doors)', () => {
  const body = cuboid(2, 2, 0.2);
  const leaf = cuboid(1, 2, 0.1);
  const blob = flattenModel([part(body), part(leaf)], { leafPart: (p) => p.mesh === leaf });
  assert(blob.leaf != null, 'the leaf range is recorded');
  assert(blob.leafGlass == null, 'a solid leaf records no glass sub-range');
});

// ── seat cook from a face-rig (req_2028-2030) ────────────────────────────────

test('a tagged seat face cooks into the prop seat (height + capacity + pose derived)', () => {
  // a 0.5×0.5 seat top, lifted 0.45 → top face at y = 0.45 + 0.45 = 0.9.
  const seatPart: CookPart = { id: 'p_seat', mesh: cuboid(0.5, 0.9, 0.5), lift: 0.45, visible: true };
  const r = cookProp({
    id: 'studio.chair', name: 'Chair', parts: [seatPart],
    seatRig: [{ part: 'p_seat', face: 0, bodyPart: 'seat' }], // face 0 = +Y top
    descriptor: PROP,
  });
  const seat = r.asset.descriptor.seat;
  assert(!!seat, 'the cook derived a seat from the rigged face');
  assertEqual(seat!.pose, 'sit', 'no head tagged → sit');
  assertEqual(seat!.capacity, 1, '0.5m seat → one slot');
  assert(Math.abs(seat!.seatHeightMeters - 0.9) < 1e-5, 'seat height = the top face Y (0.9)');
});

test('a long bench face cooks a multi-seat (booth) prop', () => {
  const bench: CookPart = { id: 'p_bench', mesh: cuboid(2.2, 0.9, 0.5), lift: 0.45, visible: true };
  const r = cookProp({
    id: 'studio.booth', name: 'Booth', parts: [bench],
    seatRig: [{ part: 'p_bench', face: 0, bodyPart: 'seat' }],
    descriptor: PROP,
  });
  const seat = r.asset.descriptor.seat!;
  assertEqual(seat.capacity, 4, '2.2m bench → 4 seats');
  assertEqual(seat.pins?.length, 4, 'four pins cooked onto the descriptor');
});

test('no seat-rig → no cooked seat', () => {
  const r = cookProp({ id: 'studio.plain', name: 'Plain', parts: [part(cuboid(1, 1, 1))], descriptor: PROP });
  assertEqual(r.asset.descriptor.seat, undefined, 'a plain prop has no seat');
});

finish('cookedAsset');
