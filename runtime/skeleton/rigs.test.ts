// runtime/skeleton/rigs.test.ts — locks the RIG vocabulary contract (req_2712/
// 2713): the prop/item rig drafts compile into well-formed skeletons using the
// canonical contact/mount names, the draft ⇄ skeleton mapping round-trips (the
// manifest stores ONLY the skeleton — the draft must be fully recoverable), and
// the body/car formation templates are valid formations (unique ids, parents
// resolve). Same run recipe as skeleton.test.ts:
//
//   tools/esbuild runtime/skeleton/rigs.test.ts --bundle \
//     --outfile=/tmp/rigs.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/rigs.test.js

import {
  propRigToSkeleton, skeletonToPropRig, itemRigToSkeleton, describePropRig,
  bodyRigBones, carRigBones,
  matchCharacterBones, partsToCharacterSkeleton,
  pocketName, placementName, seatName,
  GRIP_LEFT, GRIP_RIGHT, PHYSICAL_CONTACT, AMMO_MOUNT, PROJECTILE_MOUNT,
  CONTAINER_CAPABILITY, SEAT_CAPABILITY, COVER_CAPABILITY, DYNAMICS_CAPABILITY,
  type PropRig, type RigBounds,
} from './rigs';
import type { Bone, Skeleton } from './schema';

// ── micro harness (self-contained; the repo has no test framework) ───────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const BOUNDS: RigBounds = { minX: -1, minY: 0, minZ: -0.5, maxX: 1, maxY: 1.2, maxZ: 0.5 };

const FULL_RIG: PropRig = {
  container: { slots: 3, lootCategory: 'valuables', access: 'keyed', searchSeconds: 5, spawnFillChance: 0.6, keyId: 'safe_key' },
  placements: 2,
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 2 },
  cover: 'hard',
  dynamics: { bodyRadiusMeters: 0.3, restitution: 0.4 },
};

function contactNames(skel: Skeleton): string[] {
  return (skel.contacts ?? []).map((c) => c.name);
}

test('propRigToSkeleton compiles the full capability set onto one static root bone', () => {
  const skel = propRigToSkeleton('safe', 'safe', FULL_RIG, BOUNDS);
  assert(skel.bones.length === 1 && skel.bones[0]!.id === 'root', 'single root bone');
  assert(skel.static === true, 'prop fast path is static');
  assert(skel.meshes?.kind === 'perBone' && skel.meshes.items[0]!.geometryKey === 'safe', 'geometry by key, never embedded');
  const names = contactNames(skel);
  for (let i = 0; i < 3; i += 1) assert(names.includes(pocketName(i)), `${pocketName(i)} present`);
  for (let i = 0; i < 2; i += 1) assert(names.includes(placementName(i)), `${placementName(i)} present`);
  for (let i = 0; i < 2; i += 1) assert(names.includes(seatName(i)), `${seatName(i)} present`);
  const behaviorNames = (skel.behaviors ?? []).map((b) => b.name);
  assert(behaviorNames.includes(CONTAINER_CAPABILITY), 'container behavior carried');
  assert(behaviorNames.includes(SEAT_CAPABILITY), 'seat behavior carried');
  assert(behaviorNames.includes(COVER_CAPABILITY), 'cover behavior carried');
  assert(skel.physics?.name === DYNAMICS_CAPABILITY, 'dynamics rides as the physics capability');
});

test('placement contacts sit ON the mesh top (measured, never typed)', () => {
  const skel = propRigToSkeleton('table', 'table', { placements: 1 }, BOUNDS);
  const placement = (skel.contacts ?? []).find((c) => c.name === placementName(0));
  assert(!!placement, 'placement contact present');
  assert(placement!.transform?.pos?.[1] === BOUNDS.maxY, 'placement Y = mesh top');
});

// Order-independent object equality (the round-trip rebuilds objects, so key
// insertion order legitimately differs from the authored literal).
function sameShape(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.join(',') !== kb.join(',')) return false;
  return ka.every((k) => sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

test('draft ⇄ skeleton round-trips losslessly (the manifest stores only the skeleton)', () => {
  const back = skeletonToPropRig(propRigToSkeleton('safe', 'safe', FULL_RIG, BOUNDS));
  assert(sameShape(back.container, FULL_RIG.container), 'container params + slot count survive');
  assert(back.placements === FULL_RIG.placements, 'placement count survives');
  assert(sameShape(back.seat, FULL_RIG.seat), 'seat params + capacity survive');
  assert(back.cover === FULL_RIG.cover, 'cover survives');
  assert(sameShape(back.dynamics, FULL_RIG.dynamics), 'dynamics survive');
});

test('an empty rig compiles to the plain static prop and round-trips empty', () => {
  const skel = propRigToSkeleton('vase', 'vase', {}, BOUNDS);
  assert((skel.contacts ?? []).length === 0 && (skel.behaviors ?? []).length === 0, 'no carried capability');
  assert(JSON.stringify(skeletonToPropRig(skel)) === '{}', 'round-trips to the empty draft');
  assert(describePropRig({}) === 'plain (no capabilities)', 'honest plain summary');
});

test('itemRigToSkeleton carries grips/physical as contacts, ammo/projectile as mounts', () => {
  const skel = itemRigToSkeleton('pistol', 'pistol', { grip: { right: true }, ammo: true, projectile: true, physical: true }, BOUNDS);
  const names = contactNames(skel);
  assert(names.includes(GRIP_RIGHT) && !names.includes(GRIP_LEFT), 'only the declared grip');
  assert(names.includes(PHYSICAL_CONTACT), 'physical contact carried');
  const mounts = (skel.mounts ?? []).map((m) => m.name);
  assert(mounts.includes(AMMO_MOUNT) && mounts.includes(PROJECTILE_MOUNT), 'ammo + projectile mounts carried');
});

// A JS mirror of the two formation invariants the host validator enforces that
// template DATA can break: unique ids + every parent resolves. (Cycles are
// impossible in a literal list whose parents are all earlier entries.)
function assertValidFormation(bones: Bone[], label: string) {
  const ids = new Set<string>();
  for (const b of bones) {
    assert(!ids.has(b.id), `${label}: duplicate bone id ${b.id}`);
    ids.add(b.id);
  }
  for (const b of bones) {
    if (b.parent != null) assert(ids.has(b.parent), `${label}: dangling parent ${b.parent} on ${b.id}`);
  }
}

test('the BODY formation template is a valid formation with mirrored limb chains', () => {
  const bones = bodyRigBones();
  assertValidFormation(bones, 'body');
  const byId = new Map(bones.map((b) => [b.id, b]));
  assert(byId.get('knee_left')?.parent === 'upper_leg_left', 'left chain links left');
  assert(byId.get('knee_right')?.parent === 'upper_leg_right', 'right chain links right');
  assert(byId.get('back')?.parent === 'chest', 'back rides the chest (backpack mount / seat-back contact)');
});

test('the CAR formation template is valid; wheels spin, doors/hood/trunk hinge', () => {
  const bones = carRigBones();
  assertValidFormation(bones, 'car');
  const byId = new Map(bones.map((b) => [b.id, b]));
  assert(byId.get('wheel_front_left')?.joint?.kind === 'spin', 'wheel spins');
  assert(byId.get('door_driver')?.joint?.kind === 'hinge', 'door hinges');
  assert(byId.get('hood')?.joint?.kind === 'hinge' && byId.get('trunk')?.joint?.kind === 'hinge', 'hood + trunk hinge');
});

test('character binding: normalized names bind, Blender side suffixes alias, strays report', () => {
  const b = matchCharacterBones(['Head', 'chest', 'Hand.L', 'hand_r', 'upper arm-left', 'Blob 3']);
  const boundBones = b.bound.map((x) => x.bone);
  assert(boundBones.includes('head') && boundBones.includes('chest'), 'case-insensitive bind');
  assert(boundBones.includes('hand_left') && boundBones.includes('hand_right'), '.L/_r suffixes alias to _left/_right');
  assert(boundBones.includes('upper_arm_left'), 'spaces/dashes normalize to underscores');
  assert(b.unbound.length === 1 && b.unbound[0] === 'Blob 3', 'stray part reported by NAME');
  assert(b.duplicates.length === 0, 'no false duplicates');
});

test('character binding: duplicate bone claims report, first claimant wins', () => {
  const b = matchCharacterBones(['head', 'HEAD', 'chest']);
  assert(b.duplicates.length === 1 && b.duplicates[0] === 'head', 'second head claim reported');
  assert(b.bound.filter((x) => x.bone === 'head').length === 1, 'exactly one head binding survives');
  assert(b.bound.find((x) => x.bone === 'head')?.part === 'head', 'first claimant wins');
});

test('partsToCharacterSkeleton compiles the LIVE outliner: full formation, bound-only assignments, measured transforms', () => {
  const rows = [
    { name: 'head', center: [0, 1.8, 0] as [number, number, number] },
    { name: 'chest', center: [0, 1.4, 0] as [number, number, number] },
    { name: 'Blob 3', center: [9, 9, 9] as [number, number, number] },
  ];
  const c = partsToCharacterSkeleton('char-test', rows);
  assertValidFormation(c.skeleton.bones as Bone[], 'compiled character');
  assert(c.skeleton.bones.length === bodyRigBones().length, 'the FULL body formation ships regardless of which parts exist');
  assert(c.skeleton.meshes?.kind === 'perBone', 'per-bone assignments');
  const items = c.skeleton.meshes?.kind === 'perBone' ? c.skeleton.meshes.items : [];
  assert(items.length === 2, 'ONLY bound parts get assignments (deleted/stray parts bind nothing)');
  assert(!items.some((i) => i.geometryKey.includes('Blob')), 'stray geometry never enters the rig');
  const head = c.skeleton.bones.find((x) => x.id === 'head');
  // chest is head's nearest measured ancestor: local pos = [0,1.8,0] - [0,1.4,0].
  assert(Math.abs((head?.transform?.pos?.[1] ?? 0) - 0.4) < 1e-6, 'rest transform measured parent-relative from part centers');
  const knee = c.skeleton.bones.find((x) => x.id === 'knee_left');
  assert(knee?.transform === undefined, 'bones without a measured part keep identity');
});

test('partsToCharacterSkeleton with zero bound parts ships a bare formation (no meshes section)', () => {
  const c = partsToCharacterSkeleton('char-empty', [{ name: 'whatever' }]);
  assert(c.skeleton.meshes === undefined, 'no assignments — absence is the valid default');
  assert(c.unbound.length === 1, 'the stray still reports');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
