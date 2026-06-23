// game/nativeCamera.ts — V23 host-side camera controller transport.
//
// Importing this file is the metafile gate for -Dhas-game-camera. It is a
// transport wrapper only: JS sends rig parameters/mode/input deltas on change;
// framework/game/camera.zig owns per-frame solve/smoothing/interpolation.

import { GAME_TELEMETRY } from './telemetry';

declare const globalThis: any;

export type NativeCameraMode = 'walk' | 'orbit' | 'aim' | 'ads' | 'freefly' | 'freeFly';

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

export type NativeFreeFlyParams = {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  fov: number;
};

function callHost(name: string, ...args: unknown[]): unknown {
  const fn = globalThis[name];
  GAME_TELEMETRY.recordDiagnostic('bridge', name, {
    args: args.length,
    payloadBytes: estimatePayloadBytes(args),
  });
  GAME_TELEMETRY.recordDiagnostic('camera', name, { args: args.length });
  if (typeof fn !== 'function') return undefined;
  return fn(...args);
}

function estimatePayloadBytes(args: unknown[]): number {
  let total = 0;
  for (const arg of args) {
    if (typeof arg === 'number') total += 8;
    else if (typeof arg === 'string') total += arg.length;
    else if (typeof arg === 'boolean') total += 1;
    else if (arg == null) total += 0;
    else total += String(arg).length;
  }
  return total;
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

function sendFreeFly(name: string, params: NativeFreeFlyParams, nodeId?: number): void {
  callHost(
    name,
    ...(nodeId == null ? [] : [nodeId]),
    params.position[0], params.position[1], params.position[2],
    params.yaw, params.pitch, params.fov,
  );
}

function parseFreeFlySnapshot(raw: unknown): NativeFreeFlyParams | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    const pos = parsed?.pos;
    if (!Array.isArray(pos) || pos.length < 3) return null;
    const x = Number(pos[0]), y = Number(pos[1]), z = Number(pos[2]);
    const yaw = Number(parsed?.yaw), pitch = Number(parsed?.pitch), fov = Number(parsed?.fov);
    if (![x, y, z, yaw, pitch, fov].every(Number.isFinite)) return null;
    return { position: [x, y, z], yaw, pitch, fov };
  } catch {
    return null;
  }
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
  setFreeFly(params: NativeFreeFlyParams): void {
    sendFreeFly('__game_camera_set_freefly', params);
  },
  setMoveAxes(forward: number, strafe: number, lift: number, speed: number): void {
    callHost('__game_camera_set_move_axes', forward, strafe, lift, speed);
  },
  setInputDeltas(yawDelta: number, pitchDelta: number): void {
    callHost('__game_camera_set_input_deltas', yawDelta, pitchDelta);
  },
  setSmoothing(perSecond: number): void {
    callHost('__game_camera_set_smoothing', perSecond);
  },
  setDistanceConstraint(targetDistance: number, minDistance: number, smoothingPerSecond: number): void {
    callHost('__game_camera_set_distance_constraint', targetDistance, minDistance, smoothingPerSecond);
  },
  activeNode(): number {
    return Number(callHost('__game_camera_active_node') ?? 0);
  },
  /** The crosshair ray of the ACTIVE camera, resolved host-side (the real
   *  smoothed optical axis — what's under screen center). Origin + unit dir, or
   *  null when no camera is bound or the host binding is absent. Use this for
   *  shots / interacts / picks instead of re-deriving a direction from yaw/pitch
   *  (which diverges from the real camera). */
  activeRay(): { origin: [number, number, number]; dir: [number, number, number] } | null {
    const r = callHost('__game_camera_ray') as { ox?: number; oy?: number; oz?: number; dx?: number; dy?: number; dz?: number } | null;
    if (!r || typeof r.dx !== 'number') return null;
    return { origin: [Number(r.ox) || 0, Number(r.oy) || 0, Number(r.oz) || 0], dir: [Number(r.dx) || 0, Number(r.dy) || 0, Number(r.dz) || 0] };
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
      setFreeFly(params: NativeFreeFlyParams): void {
        sendFreeFly('__game_camera_set_freefly_node', params, nodeId);
      },
      setMoveAxes(forward: number, strafe: number, lift: number, speed: number): void {
        callHost('__game_camera_set_move_axes_node', nodeId, forward, strafe, lift, speed);
      },
      getFreeFly(): NativeFreeFlyParams | null {
        return parseFreeFlySnapshot(callHost('__game_camera_get_freefly_node', nodeId));
      },
      setInputDeltas(yawDelta: number, pitchDelta: number): void {
        callHost('__game_camera_set_input_deltas_node', nodeId, yawDelta, pitchDelta);
      },
      setSmoothing(perSecond: number): void {
        callHost('__game_camera_set_smoothing_node', nodeId, perSecond);
      },
      setDistanceConstraint(targetDistance: number, minDistance: number, smoothingPerSecond: number): void {
        callHost('__game_camera_set_distance_constraint_node', nodeId, targetDistance, minDistance, smoothingPerSecond);
      },
    });
  },
});
