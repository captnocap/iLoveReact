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

test('AssistMeshViewer uses the V23 native viewport drive', () => {
  const source = read('cart/hmsc-int/assist3d/AssistMeshViewer.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(!source.includes('position={solved.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={solved.target}'), 'JS-solved camera target must not drive the renderer');
  assert(!source.includes('solveCamera('), 'runtime solveCamera must not drive this viewport');
  assert(!source.includes('CAMERAS.Orbit'), 'runtime Orbit registry import must not drive this viewport');
});

test('assist3d SceneSurface uses native render drive and keeps registry math only for picking', () => {
  const source = read('cart/hmsc-int/assist3d/SceneSurface.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(source.includes('shadowCamRef.current'), 'picking shadow must be explicit and separate from renderer drive');
  assert(!source.includes('position={solved.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={solved.target}'), 'JS-solved camera target must not drive the renderer');
  assert(!source.includes('solveCamera('), 'runtime solveCamera must not drive this viewport');
  assert(!source.includes('CAMERAS.Orbit'), 'runtime Orbit registry import must not drive this viewport');
});

test('IsoPreview uses native FreeFly drive, not a JS animation-frame camera loop', () => {
  const source = read('cart/hmsc-int/IsoPreview.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'surface must engage the node-scoped native controller');
  assert(source.includes("ctl.setMode('freefly')"), 'preview must use the native FreeFly controller mode');
  assert(source.includes('.setMoveAxes('), 'WASD intent must be sent as native movement axes');
  assert(source.includes('.getFreeFly()'), 'camera persistence must read back the native integrated pose');
  assert(!source.includes('requestAnimationFrame'), 'JS must not run the per-frame camera movement loop');
  assert(!source.includes('bumpTick'), 'JS camera movement must not force per-frame rerenders');
  assert(!source.includes('position={eye}'), 'JS-computed eye must not drive the renderer');
  assert(!source.includes('target={target}'), 'JS-computed target must not drive the renderer');
});

test('IsoAuthor uses native render drive; IsoStage solve stays semantic only', () => {
  const source = read('cart/hmsc-int/IsoAuthor.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode(nodeId)'), 'surface must engage the node-scoped native controller with the real node id');
  assert(source.includes('stage.nativeOrbitParams()'), 'iso rig params must be transported into the native controller');
  assert(source.includes('ctl.setSmoothing(0)'), 'authoring camera should not trail cursor pan/zoom');
  assert(!source.includes('position={cam.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={cam.target}'), 'JS-solved camera target must not drive the renderer');
  assert(!source.includes('const cam = stage.solve()'), 'stage solve must not be rerendered as live camera props');
});

test('lab scaffold has no placeholder JS camera solve', () => {
  const source = read('cart/hmsc-int/labs/_scaffold.tsx');
  assert(!source.includes('GAME_CAMERA'), 'dead scaffold must not import the camera door for a placeholder solve');
  assert(!source.includes('camera.fov'), 'dead scaffold must not teach JS camera solve as the lab pattern');
});

finish('native-viewport');
