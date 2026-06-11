import { assert, assertClose, assertEqual, finish, test } from './_testkit';
import { cameraOcclusionResponse } from './cameraOcclusion';
import type { CameraOcclusionResult } from './physics';

const TUNING = {
  minDistanceMeters: 1.6,
  skinOffsetMeters: 0.14,
  residualOpacity: 0.62,
};

function hit(overrides: Partial<CameraOcclusionResult> = {}): CameraOcclusionResult {
  return {
    hostMicroseconds: 3,
    ownerIndices: [1],
    nearestTargetDistanceMeters: 5.15,
    nearestOwnerIndex: 1,
    ...overrides,
  };
}

test('enclosed room occlusion constrains camera inside and leaves walls visible', () => {
  const response = cameraOcclusionResponse(hit(), ['front-wall'], 7.65, TUNING);
  assertClose(response.distanceMeters, 5.01, 1e-6, 'camera sits just inside the obstructing surface');
  assertEqual(response.residualOwnerIds.length, 0, 'normal room obstruction must not fade/remove the wall');
});

test('min-distance corner case keeps a readable translucent wall, never invisibility', () => {
  const response = cameraOcclusionResponse(hit({ nearestTargetDistanceMeters: 0.7 }), ['corner-pillar'], 7.65, TUNING);
  assertClose(response.distanceMeters, TUNING.minDistanceMeters, 1e-6, 'camera clamps to minimum player distance');
  assertEqual(response.residualOwnerIds.join(','), 'corner-pillar', 'only the tight residual owner fades');
  assert(TUNING.residualOpacity >= 0.4, 'residual opacity must keep the wall visibly present');
});

test('clear camera ray releases to the authored follow distance', () => {
  const response = cameraOcclusionResponse(hit({ ownerIndices: [], nearestOwnerIndex: 0, nearestTargetDistanceMeters: 0 }), ['wall'], 7.65, TUNING);
  assertClose(response.distanceMeters, 7.65, 1e-6, 'clear ray uses the normal camera distance');
  assertEqual(response.residualOwnerIds.length, 0, 'clear ray has no residual translucency');
});

finish('game/cameraOcclusion');
