// nativeViewport.test.ts — CAMNUKE-0605 viewport-surface guards.
//
// The native controller's renderer-consumed behavior is tested in Zig; this
// suite pins each hmsc-int viewport to that controller path so a route cannot
// silently fall back to JS-driven Scene3D.Camera props.

import { assert, finish, test } from './game/_testkit';

declare const globalThis: any;

function read(path: string): string {
  const fn = globalThis.__fs_read;
  if (typeof fn !== 'function') throw new Error('__fs_read unavailable');
  return String(fn(path));
}

test('/voxels uses the V23 native viewport drive, not JS camera props', () => {
  const source = read('cart/hmsc-int/VoxelHybridRoute.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(!source.includes('position={solved.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={solved.target}'), 'JS-solved camera target must not drive the renderer');
  assert(!source.includes('solveCamera('), 'runtime solveCamera must not drive this viewport');
  assert(!source.includes('CAMERAS.Orbit'), 'runtime Orbit registry import must not drive this viewport');
});

test('ModelViewer uses the V23 native viewport drive, not OrbitCamera', () => {
  const source = read('cart/hmsc-int/ModelViewer.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(!source.includes('<OrbitCamera'), 'OrbitCamera must not drive the renderer');
  assert(!source.includes('from \'@reactjit/cameras\''), 'runtime camera component import must stay removed');
});

test('ObjectInspect3D uses native render drive and keeps registry math only for picking', () => {
  const source = read('cart/hmsc-int/ObjectInspect3D.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(source.includes('shadowCamRef.current'), 'picking shadow must be explicit and separate from renderer drive');
  assert(!source.includes('position={solved.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={solved.target}'), 'JS-solved camera target must not drive the renderer');
  assert(!source.includes('solveCamera('), 'runtime solveCamera must not drive this viewport');
  assert(!source.includes('CAMERAS.Orbit'), 'runtime Orbit registry import must not drive this viewport');
});

finish('native-viewport');
