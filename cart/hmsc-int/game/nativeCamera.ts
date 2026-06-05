// game/nativeCamera.ts — V23 host-side camera controller transport.
//
// Importing this file is the metafile gate for -Dhas-game-camera. It is a
// transport wrapper only: JS sends rig parameters/mode/input deltas on change;
// framework/game/camera.zig owns per-frame solve/smoothing/interpolation.

declare const globalThis: any;

export type NativeCameraMode = 'walk' | 'orbit' | 'aim' | 'ads';

export type NativeOrbitParams = {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
  zoom?: number;
};

export type NativeAimParams = {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  crouch?: number;
  shoulderShift?: number;
  pivotHeight?: number;
  crouchDrop?: number;
  distance?: number;
  lookAhead?: number;
  fov?: number;
};

function callHost(name: string, ...args: unknown[]): unknown {
  const fn = globalThis[name];
  if (typeof fn !== 'function') return undefined;
  return fn(...args);
}

function sendOrbit(name: string, params: NativeOrbitParams, nodeId?: number): void {
  callHost(
    name,
    ...(nodeId == null ? [] : [nodeId]),
    params.target[0], params.target[1], params.target[2],
    params.yaw, params.pitch, params.distance, params.fov, params.zoom ?? 1,
  );
}

function sendAim(name: string, params: NativeAimParams, nodeId?: number): void {
  callHost(
    name,
    ...(nodeId == null ? [] : [nodeId]),
    params.target[0], params.target[1], params.target[2],
    params.yaw, params.pitch,
    params.crouch ?? 0,
    params.shoulderShift ?? 0.62,
    params.pivotHeight ?? 1.62,
    params.crouchDrop ?? 0.42,
    params.distance ?? 2.4,
    params.lookAhead ?? 12,
    params.fov ?? 47,
  );
}

export const GAME_NATIVE_CAMERA = Object.freeze({
  bindNode(nodeId: number): void {
    callHost('__game_camera_bind_node', nodeId);
  },
  bindFirst(): number {
    return Number(callHost('__game_camera_bind_first') ?? 0);
  },
  disable(): void {
    callHost('__game_camera_disable');
  },
  setMode(mode: NativeCameraMode): void {
    callHost('__game_camera_set_mode', mode);
  },
  setOrbit(params: NativeOrbitParams): void {
    sendOrbit('__game_camera_set_orbit', params);
  },
  setAim(params: NativeAimParams): void {
    sendAim('__game_camera_set_aim', params);
  },
  setInputDeltas(yawDelta: number, pitchDelta: number): void {
    callHost('__game_camera_set_input_deltas', yawDelta, pitchDelta);
  },
  setSmoothing(perSecond: number): void {
    callHost('__game_camera_set_smoothing', perSecond);
  },
  activeNode(): number {
    return Number(callHost('__game_camera_active_node') ?? 0);
  },
  forNode(nodeId: number) {
    return Object.freeze({
      disable(): void {
        callHost('__game_camera_disable_node', nodeId);
      },
      setMode(mode: NativeCameraMode): void {
        callHost('__game_camera_set_mode_node', nodeId, mode);
      },
      setOrbit(params: NativeOrbitParams): void {
        sendOrbit('__game_camera_set_orbit_node', params, nodeId);
      },
      setAim(params: NativeAimParams): void {
        sendAim('__game_camera_set_aim_node', params, nodeId);
      },
      setInputDeltas(yawDelta: number, pitchDelta: number): void {
        callHost('__game_camera_set_input_deltas_node', nodeId, yawDelta, pitchDelta);
      },
      setSmoothing(perSecond: number): void {
        callHost('__game_camera_set_smoothing_node', nodeId, perSecond);
      },
    });
  },
});
