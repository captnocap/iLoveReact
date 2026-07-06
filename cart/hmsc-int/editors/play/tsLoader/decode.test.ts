// decode tests — the TS loader's decoders must round-trip the SAME wire bytes the
// compile/ encoders produce (and the Zig constructor reads). We encode each core
// lump with the real encoder, wrap them in a map container exactly as
// createHmscMapfile does, decode with loadSceneFromMapContainer, and assert the
// values survive the trip. This is the load-path's contract test.

import { assert, assertClose, assertEqual, finish, test } from '../../../game/_testkit';
import { MAP_LUMP, writeLumpContainer, type LumpInput } from '@reactjit/workspace';
import { writeGameFile } from '@reactjit/workspace/gamefile';
import { encodeEnvironmentLump, DEFAULT_SCENE_ENVIRONMENT } from '../../../compile/sceneEnv';
import { encodeInstanceLump, encodeMaterials, encodeMaterialRefs, INSTANCE_STRIDE } from '../../../compile/worldGeometry';
import { encodeCollidersLump, encodePhysicsConfigLump, type BakedColliders, type BakedPhysicsConfig } from '../../../compile/worldColliders';
import type { Heightfield } from '@game';
import { loadGameFileStreams, loadSceneFromGameFile, loadSceneFromMapContainer } from './decode';

function ramp(): Heightfield {
  return {
    slot: 0,
    originX: 2,
    originZ: 3,
    cellSizeMeters: 0.6,
    cols: 2,
    rows: 2,
    baseY: 1.25,
    walkableSlopeCos: 0.6,
    heights: new Float32Array([0, 0.5, 1, 1.5]),
    yawRadians: 0.7,
    pivotX: 2,
    pivotZ: 3,
  };
}

function container(extra: LumpInput[]): Uint8Array {
  return writeLumpContainer(extra);
}

test('INSTANCES round-trips count/stride/pieceCount and the float rows', () => {
  // two rows, stride 13: pos3 rot3 scale3 rgb3 shapeId
  const rows = new Float32Array([
    1, 2, 3, 0, 90, 0, 4, 5, 6, 0.1, 0.2, 0.3, 0,
    7, 8, 9, 0, 45, 0, 1, 1, 1, 0.4, 0.5, 0.6, 1,
  ]);
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(rows, 1, INSTANCE_STRIDE) },
  ]));
  assertEqual(scene.instanceCount, 2, 'instance count');
  assertEqual(scene.instanceStride, INSTANCE_STRIDE, 'instance stride');
  assertEqual(scene.pieceCount, 1, 'piece count');
  assertClose(scene.instances[0], 1, 1e-6, 'row0 px');
  assertClose(scene.instances[INSTANCE_STRIDE + 12], 1, 1e-6, 'row1 shapeId');
});

test('MATERIALS + MATERIAL_REFS round-trip (shader recipe + opacity + per-row ref)', () => {
  const materials = [
    { wgsl: 'fn f() {}', data: new Float32Array([1, 2, 3]), opacity: 1, doc: null },
    { wgsl: '', data: new Float32Array([]), opacity: 0.4, doc: null }, // glass
  ];
  const refs = new Uint32Array([0, 1, 2, 0]);
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.MATERIALS, encoding: 'raw', data: encodeMaterials(materials as any) },
    { type: MAP_LUMP.MATERIAL_REFS, encoding: 'raw', data: encodeMaterialRefs(refs) },
  ]));
  assertEqual(scene.materials.length, 2, 'material count');
  assertEqual(scene.materials[0].wgsl, 'fn f() {}', 'shader source survives');
  assertEqual(scene.materials[0].data.length, 3, 'shader data length');
  assertClose(scene.materials[0].data[1], 2, 1e-6, 'shader data value');
  assertClose(scene.materials[1].opacity, 0.4, 1e-6, 'glass opacity');
  assertEqual(scene.materials[1].wgsl, '', 'glass has no shader');
  assertEqual(scene.materialRefs.length, 4, 'material refs length');
  assertEqual(scene.materialRefs[2], 2, 'material ref value');
});

test('COLLIDERS round-trip rects, oriented, and ramps with their height grids', () => {
  // 1 rect (9 floats), 1 oriented (12 floats), 1 ramp.
  const colliders: BakedColliders = {
    rects: [0, 0, 10, 10, 3, 1, 0.55, 0, -1e9],
    oriented: [1, 1, 5, 5, 2.5, 1, 0.55, 0, 0, 3, 3, 0.785],
    ramps: [ramp()],
  };
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.COLLIDERS, encoding: 'raw', data: encodeCollidersLump(colliders) },
  ]));
  assert(scene.colliders != null, 'colliders decoded');
  assertEqual(scene.colliders!.rects.length, 9, 'one rect = 9 floats');
  assertClose(scene.colliders!.rects[3], 10, 1e-6, 'rect maxZ');
  assertEqual(scene.colliders!.oriented.length, 12, 'one oriented = 12 floats');
  assertClose(scene.colliders!.oriented[11], 0.785, 1e-5, 'oriented yaw');
  assertEqual(scene.colliders!.ramps.length, 1, 'one ramp');
  const r = scene.colliders!.ramps[0];
  assertEqual(r.cols, 2, 'ramp cols');
  assertEqual(r.rows, 2, 'ramp rows');
  assertClose(r.baseY, 1.25, 1e-6, 'ramp baseY');
  assertClose(r.heights[3], 1.5, 1e-6, 'ramp corner height');
  assertClose(r.yawRadians ?? 0, 0.7, 1e-6, 'ramp yaw');
});

test('PHYSICS_CONFIG round-trips the 13 tuning floats', () => {
  const config: BakedPhysicsConfig = {
    tuning: {
      gravityMetersPerSecondSquared: 10,
      jumpSpeedMetersPerSecond: 5.2,
      playerCapsuleRadiusMeters: 0.42,
      playerCapsuleHeightMeters: 1.9,
      playerStepHeightMeters: 0.5,
      wallRestitution: 0,
      bodyRestitution: 0,
      walkableRectSidePushGraceMeters: 0.08,
    } as any,
    accelerationMultiplier: 1,
    surfaceFriction: 0.2,
    surfaceRestitution: 0,
    walkSpeedMetersPerSecond: 2.4,
    runSpeedMetersPerSecond: 5.8,
  };
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.PHYSICS_CONFIG, encoding: 'raw', data: encodePhysicsConfigLump(config) },
  ]));
  assert(scene.physicsConfig != null, 'physics config decoded');
  assertClose(scene.physicsConfig!.gravity, 10, 1e-6, 'gravity');
  assertClose(scene.physicsConfig!.stepHeight, 0.5, 1e-6, 'step height');
  assertClose(scene.physicsConfig!.walkSpeed, 2.4, 1e-6, 'walk speed');
  assertClose(scene.physicsConfig!.runSpeed, 5.8, 1e-6, 'run speed');
});

test('ENVIRONMENT round-trips the lighting/sky/camera floats', () => {
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.ENVIRONMENT, encoding: 'raw', data: encodeEnvironmentLump(DEFAULT_SCENE_ENVIRONMENT) },
  ]));
  assert(scene.environment != null, 'environment decoded');
  assertClose(scene.environment!.camFov, DEFAULT_SCENE_ENVIRONMENT.camera.fov, 1e-5, 'camera fov');
  assertClose(scene.environment!.ambientIntensity, DEFAULT_SCENE_ENVIRONMENT.ambient.intensity, 1e-5, 'ambient intensity');
});

test('absent lumps decode to empty/null, never throw', () => {
  const scene = loadSceneFromMapContainer(container([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(new Float32Array(0), 0, INSTANCE_STRIDE) },
  ]));
  assertEqual(scene.instanceCount, 0, 'no instances');
  assertEqual(scene.materials.length, 0, 'no materials');
  assertEqual(scene.colliders, null, 'no colliders');
  assertEqual(scene.physicsConfig, null, 'no physics config');
  assertEqual(scene.flora, null, 'no flora');
  assertEqual(scene.environment, null, 'no environment');
});

test('platform game-file wrapper exposes STREAM_MAP and decodes the same scene', () => {
  const rows = new Float32Array([
    1, 2, 3, 0, 90, 0, 4, 5, 6, 0.1, 0.2, 0.3, 4,
  ]);
  const map = container([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(rows, 1, INSTANCE_STRIDE) },
  ]);
  const file = writeGameFile({
    logic: { refs: [], data: new Uint8Array([1, 2, 3]) },
    map: { refs: [2001], data: map },
    skins: { refs: [], data: new Uint8Array(0) },
    assets: [{ key: 2001, kind: 9, bytes: new Uint8Array([9, 8, 7]), embed: true }],
  });

  const streams = loadGameFileStreams(file);
  assertEqual(streams.map.refs.length, 1, 'map stream ref count');
  assertEqual(streams.map.refs[0], 2001, 'map stream ref value');
  assertEqual(streams.map.data.byteLength, map.byteLength, 'map stream contains nested map container');

  const scene = loadSceneFromGameFile(file);
  assertEqual(scene.instanceCount, 1, 'gamefile scene instance count');
  assertClose(scene.instances[12], 4, 1e-6, 'shape id survives through gamefile wrapper');
});

finish('tsLoader/decode');
