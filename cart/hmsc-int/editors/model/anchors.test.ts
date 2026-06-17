// anchors.test.ts — pins the fixed-anchor helper layer (req_1244): a seat/cargo
// marker is a `kind:'anchor'` MountPoint that rides the same mount machinery as
// joints, but carries a FACING + role instead of a spin axis + rotation limit.
// Pure + headless (the editMesh idiom).

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { addAnchor, anchorFacing, anchorRole, isAnchor, nextAnchorName, splitMounts, DEFAULT_ANCHOR_FACING, DEFAULT_ANCHOR_ROLE } from './anchors';
import { addMount, cuboid, removeMount, renameMount, updateMount, type EditMesh } from './editMesh';

test('addAnchor makes a kind:anchor mount with default facing + role', () => {
  const m = addAnchor(cuboid(2, 2, 2), { name: 'driver', position: [0, 1, 0] });
  const a = (m.mounts ?? [])[0];
  assert(!!a, 'anchor was appended');
  assertEqual(a.kind, 'anchor', 'kind is anchor');
  assertEqual(a.role, DEFAULT_ANCHOR_ROLE, 'default role = driver');
  assertEqual(JSON.stringify(a.axis), JSON.stringify(DEFAULT_ANCHOR_FACING), 'default facing = +Z');
  assert(a.limit === undefined, 'anchor carries NO rotation limit');
  assert(isAnchor(a), 'isAnchor true for an anchor');
});

test('addAnchor honors an explicit facing + role', () => {
  const m = addAnchor(cuboid(2, 2, 2), { name: 'shotgun', position: [1, 1, 0], facing: [-1, 0, 0], role: 'passenger' });
  const a = (m.mounts ?? [])[0];
  assertEqual(a.role, 'passenger', 'role passed through');
  assertEqual(JSON.stringify(anchorFacing(a)), JSON.stringify([-1, 0, 0]), 'facing passed through');
});

test('splitMounts separates rotating joints from fixed anchors, preserving order', () => {
  let m: EditMesh = cuboid(2, 2, 2);
  m = addMount(m, { name: 'axle', kind: 'socket', position: [0, 0, 0], axis: [1, 0, 0], limit: { full: true } });
  m = addAnchor(m, { name: 'driver', position: [0, 1, 0] });
  m = addMount(m, { name: 'hinge', kind: 'socket', position: [0, 0, 1], axis: [0, 1, 0], limit: { min: -90, max: 90 } });
  m = addAnchor(m, { name: 'cargo', position: [0, 1, 2], role: 'cargo' });
  const { joints, anchors } = splitMounts(m);
  assertEqual(joints.map((j) => j.name).join(','), 'axle,hinge', 'joints = the two sockets in order');
  assertEqual(anchors.map((a) => a.name).join(','), 'driver,cargo', 'anchors = the two anchors in order');
  assert(joints.every((j) => !isAnchor(j)), 'no anchor leaked into joints');
  assert(anchors.every((a) => isAnchor(a)), 'every anchor is an anchor');
});

test('nextAnchorName is unique across the WHOLE mount namespace (joints + anchors)', () => {
  let m: EditMesh = cuboid(2, 2, 2);
  assertEqual(nextAnchorName(m), 'seat_1', 'first free is seat_1');
  // a JOINT named seat_1 must still block the anchor name — one binding namespace.
  m = addMount(m, { name: 'seat_1', kind: 'socket', position: [0, 0, 0] });
  assertEqual(nextAnchorName(m), 'seat_2', 'seat_1 taken by a joint → seat_2');
});

test('anchors reuse the kind-agnostic mount mutators (role patch, rename, remove)', () => {
  let m: EditMesh = addAnchor(cuboid(2, 2, 2), { name: 'driver', position: [0, 1, 0] });
  m = updateMount(m, 'driver', { role: 'mount' });
  assertEqual(anchorRole((m.mounts ?? [])[0]), 'mount', 'updateMount patched the anchor role');
  m = renameMount(m, 'driver', 'pilot');
  assertEqual((m.mounts ?? [])[0].name, 'pilot', 'renameMount renamed the anchor');
  m = removeMount(m, 'pilot');
  assertEqual((m.mounts ?? []).length, 0, 'removeMount dropped the anchor');
});

finish('anchors');
