// cart/editor/world/poseMarkers.test.ts
//
//   tools/esbuild cart/editor/world/poseMarkers.test.ts --bundle \
//     --outfile=/tmp/editor-pose-markers.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-pose-markers.test.js

import { POSE_MARKER_KIND, poseMarkerKindForBone } from './poseMarkers';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('tracked model joints map onto the camera overlay color regions', () => {
  assert(poseMarkerKindForBone('Head') === POSE_MARKER_KIND.face, 'head did not represent the face bundle');
  assert(poseMarkerKindForBone('shoulder.l') === POSE_MARKER_KIND.upper, 'Blender left shoulder alias was not cyan');
  assert(poseMarkerKindForBone('Elbow Right') === POSE_MARKER_KIND.upper, 'right elbow was not cyan');
  assert(poseMarkerKindForBone('hip-l') === POSE_MARKER_KIND.leg, 'left hip was not orange');
  assert(poseMarkerKindForBone('Foot Right') === POSE_MARKER_KIND.leg, 'foot did not represent the ankle endpoint');
});

test('non-COCO helper and mesh parts do not manufacture diagnostic joints', () => {
  for (const name of ['chest', 'upper_arm_left', 'hand_right', 'fingers_left', 'hair']) {
    assert(poseMarkerKindForBone(name) === POSE_MARKER_KIND.none, `${name} manufactured a marker`);
  }
});

log(`${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} pose marker test(s) failed`);
