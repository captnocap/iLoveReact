// runtime/skeleton/skeleton.test.ts — locks the skeleton object-model TS contract:
// the authoring event factories emit the right types + targets (skeleton id always
// rides as a TargetRef), the dispatch helpers fan out through the editorbus, and
// the pure schema helpers assemble the documented shape. The validator itself is a
// HOST (Zig) system — there is nothing to test here for it (and nothing to mock).
//
//   tools/esbuild runtime/skeleton/skeleton.test.ts --bundle \
//     --outfile=/tmp/skel.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/skel.test.js

import {
  boneAdd, jointSet, meshAssign, mountAdd, contactPin, behaviorSet,
  addBone, setJoint, assignMesh, addMount, pinContact, setBehavior, setPhysics,
  SKELETON, BONE, MOUNT, CONTACT, skeletonTarget,
} from './events';
import { defineSkeleton, staticProp, type Skeleton } from './schema';
import { registeredEventTypes, SEQ_PENDING, peerId, type TargetRef } from '../editorbus/event';
import { onEvent, since, head, isHostBacked, type EditorEvent } from '../editorbus/bus';

// ── micro harness (self-contained; the repo has no test framework) ───────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function hasTarget(refs: TargetRef[], kind: string, id: string): boolean {
  return refs.some((r) => r.kind === kind && r.id === id);
}

// ── factories stamp well-formed, not-yet-ordered envelopes ────────────────────
test('boneAdd factory carries type, payload, and pending seq', () => {
  const e = boneAdd({ bone: { id: 'pelvis' } }, [skeletonTarget('player')]);
  assert(e.type === 'skeleton.bone.add', 'type carried');
  assert(e.seq === SEQ_PENDING, 'seq pending until authority assigns');
  assert(e.origin === peerId(), 'origin stamped');
  assert(e.payload.bone.id === 'pelvis', 'payload carried');
  assert(hasTarget(e.targets, SKELETON, 'player'), 'skeleton id rides as a target');
});

test('jointSet factory describes itself and carries the joint payload', () => {
  const e = jointSet({ boneId: 'wheel-fl', joint: { kind: 'spin', axis: [1, 0, 0] } });
  assert(e.type === 'skeleton.joint.set', 'type carried');
  assert(e.payload.joint.kind === 'spin', 'joint kind carried');
});

// ── dispatch helpers emit through the editorbus, skeleton id on the target ────
test('addBone dispatches and a subscriber sees the confirmed event + targets', () => {
  assert(!isHostBacked(), 'bare v8cli run → local fallback bus');
  const base = head();
  const seen: EditorEvent[] = [];
  const off = onEvent((e) => seen.push(e));
  const seq = addBone('vehicle-1', { id: 'chassis' });
  off();
  assert(seq === base + 1, 'dispatch assigns a monotonic seq');
  assert(seen.length === 1, 'subscriber saw exactly the dispatched event');
  const e = seen[0]!;
  assert(e.type === 'skeleton.bone.add', 'confirmed event type');
  assert(hasTarget(e.targets, SKELETON, 'vehicle-1'), 'skeleton id target');
  assert(hasTarget(e.targets, BONE, 'chassis'), 'bone id target rides along');
});

test('setJoint / addMount / pinContact / setBehavior carry the right finer refs', () => {
  const base = head();
  setJoint('vehicle-1', 'door-l', { kind: 'hinge', axis: [0, 1, 0], limits: { min: 0, max: 1.5 } });
  addMount('vehicle-1', { name: 'wheel-fl', boneId: 'axle-f' });
  pinContact('vehicle-1', { name: 'seat-0', boneId: 'chassis' });
  setBehavior('vehicle-1', { name: 'open', capability: { name: 'hinge.swing' }, mount: 'wheel-fl' });
  const tail = since(base);
  assert(tail.length === 4, 'four events committed in order');
  assert(hasTarget(tail[0]!.targets, BONE, 'door-l'), 'joint event targets its bone');
  assert(hasTarget(tail[1]!.targets, MOUNT, 'wheel-fl') && hasTarget(tail[1]!.targets, BONE, 'axle-f'), 'mount targets name + bone');
  assert(hasTarget(tail[2]!.targets, CONTACT, 'seat-0'), 'contact targets its name');
  assert(hasTarget(tail[3]!.targets, MOUNT, 'wheel-fl'), 'behavior bound to its mount');
});

test('assignMesh: a bone assignment vs a skinned mesh', () => {
  const base = head();
  assignMesh('prop-1', 'crate', 'root');     // per-bone
  assignMesh('player-1', 'body-skin');        // skinned (no boneId)
  const tail = since(base);
  assert((tail[0]!.payload as any).skinned === false && hasTarget(tail[0]!.targets, BONE, 'root'), 'per-bone assign');
  assert((tail[1]!.payload as any).skinned === true, 'no boneId ⇒ skinned mesh');
  setPhysics('prop-1', { name: 'rigidbody', params: { mass: 12 } }); // exercises a capability-ref helper
});

// ── the anti-collision registry holds every skeleton type ─────────────────────
test('all skeleton authoring types are registered for settings/console UIs', () => {
  const types = registeredEventTypes();
  for (const t of [
    'skeleton.bone.add', 'skeleton.bone.remove', 'skeleton.joint.set',
    'skeleton.mesh.assign', 'skeleton.collision.add', 'skeleton.physics.set',
    'skeleton.animation.set', 'skeleton.mount.add', 'skeleton.contact.pin',
    'skeleton.behavior.set', 'skeleton.static.set',
  ]) assert(types.includes(t), `${t} registered`);
});

// ── pure schema helpers assemble the documented shape ─────────────────────────
test('defineSkeleton assembles formation + carried data; staticProp is the prop fast path', () => {
  const turret: Skeleton = defineSkeleton('turret', [
    { id: 'base' },
    { id: 'head', parent: 'base', joint: { kind: 'pivot', axis: [0, 1, 0] } },
  ], {
    mounts: [{ name: 'barrel', boneId: 'head' }],
    behaviors: [{ name: 'rotate', capability: { name: 'pivot.track' }, mount: 'barrel' }],
  });
  assert(turret.bones.length === 2, 'two bones');
  assert(turret.bones[1]!.joint!.kind === 'pivot', 'articulated head');
  assert(turret.mounts!.length === 1 && turret.behaviors!.length === 1, 'carried data assembled');

  const crate = staticProp('crate', 'crate-mesh');
  assert(crate.static === true, 'static prop is frozen');
  assert(crate.meshes!.kind === 'perBone' && crate.bones.length === 1, 'one bone, one mesh');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
