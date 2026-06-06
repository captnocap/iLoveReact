// editors/sculptCamera.ts — the sculpt-viewport camera, shared (ITEMSCULPT-0606).
//
// The orbit + noclip-fly rig /characters debugged across GRABQOL/GRABNAV/
// GRABFLY-0605, extracted VERBATIM so /items (and any future sculpt route)
// gets the identical hands instead of a parallel re-implementation (the
// no-duplication law). One call site change: the route id keys the twig
// state, so each route keeps its own saved camera pose.
//
// V23/V26 LAW UNCHANGED: the host (framework/game/camera.zig) owns per-frame
// solve/smoothing of the route's own camera node. JS sends rig params on
// CHANGE and deltas per drag move; idle frames send nothing and a drag never
// re-renders the cart. solvedCam() is the JS SHADOW — registry pure math for
// picking (V26-sanctioned), never a per-frame driver.
//
// What the hook owns:
//   - orbit: yaw/pitch drag (full pole-to-pole), zoom knob distance, wheel
//     zoom-to-cursor (converge the pivot on what the cursor points at; wheel
//     out drifts the pivot home), pan clamps.
//   - fly (noclip): WASD + q/e move on the key bus (host-integrated per
//     frame), drag-look, wheel dolly along the cursor ray, pose persisted
//     per route at rest points.
//   - FOCUS (CAMFOCUS-0606): deterministic subject framing — at boot (the
//     persisted pose no longer drives the load; it was arbitrary), on
//     focusKey change (part/model switch), and on the F key. C flips
//     orbit ⇄ fly. Pure math in sculptFraming.ts.
//   - the boot-frame declarative camera (static props; the host writes the
//     node's fields every frame once engaged).
// What the route owns: the Pressable, the grab-beats-orbit split (call
// orbitDown only when the press misses the mesh), and the Scene3D.Camera
// node itself (render it with cameraRef + bootCam).
//
// Tuning rides PAINT_EDITOR_TUNING.orbit/.fly/.knobs.zoom — ONE hand-feel
// for every sculpt surface, by construction.

import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { GAME_CAMERA, type Solved } from '../game/camera';
import { GAME_NATIVE_CAMERA } from '../game/nativeCamera';
import { useRouteTwigState } from './twigs';
import { PAINT_EDITOR_TUNING } from './characters/paintKit';
import { frameFly, frameOrbit, type SubjectBounds } from './sculptFraming';

const TUNE = PAINT_EDITOR_TUNING;

type V3 = [number, number, number];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type SculptCameraDefaults = {
  dist: number;
  look: { yaw: number; pitch: number };
  flyPose: { pos: V3; yaw: number; pitch: number };
  mode: 'orbit' | 'fly';
};

export type SculptCameraOpts = {
  /** keys the per-route twig state ('/characters', '/items', ...) */
  route: string;
  /** the orbit pivot's home — zoom-to-cursor pans around it, wheel-out
   *  drifts back to it. May change per render (the /characters view toggle). */
  center: V3;
  /** the viewport's screen rect (the route's onLayout ref) */
  viewRect: { current: { x: number; y: number; width: number; height: number } };
  /** the world point under a pixel (mesh pick) — zoom-to-cursor aims at it;
   *  null falls back to the ray's closest approach to the pivot */
  pickWorld?: (sx: number, sy: number, cam: Solved) => V3 | null;
  /** the subject's bounding sphere (CAMFOCUS-0606) — boot/refocus framing
   *  centers on it at a bounds-fitted distance; null/absent frames the view
   *  center at defaults.dist. Routes derive it from their grab clouds. */
  subjectBounds?: () => SubjectBounds | null;
  /** when this changes, the camera reframes the subject (the route's
   *  "part/model switched" signal — e.g. `part:${selPart}:${epoch}`).
   *  Mount framing happens regardless; this drives the in-session switches. */
  focusKey?: string;
  defaults: SculptCameraDefaults;
};

export type SculptCamera = {
  /** render <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} /> */
  cameraRef: { current: any };
  bootCam: Solved;
  camMode: 'orbit' | 'fly';
  setCamMode: (mode: 'orbit' | 'fly') => void;
  dist: number;
  zoomTo: (d: number) => void;
  /** knob reflection constant: knob value = zoomReflect − dist (bigger = closer) */
  zoomReflect: number;
  /** the ACTIVE rig solved from the JS shadow (fly reads the host pose back)
   *  — the pick camera IS the rendered camera, even mid-flight */
  solvedCam: () => Solved;
  /** center + the zoom-to-cursor pan offsets — what the orbit rig looks at */
  camTarget: () => V3;
  orbitDown: (e: any) => void;
  orbitMove: (e: any) => void;
  orbitUp: () => void;
  /** an orbit/look drag is in flight (the route's move handler routes here) */
  dragging: () => boolean;
  /** the wheel: orbit zoom-to-cursor dolly, or fly dolly along the cursor ray */
  onWheel: (e: any) => void;
  /** REFOCUS (CAMFOCUS-0606): deterministically reframe the subject in the
   *  ACTIVE rig — the escape hatch from any lost position. Also on the F key;
   *  runs automatically at boot and on focusKey change. */
  focus: () => void;
};

export function useSculptCamera(opts: SculptCameraOpts): SculptCamera {
  const { route, defaults } = opts;
  // zoom is a KNOB (param-rate); yaw/pitch live in lookRef — drag deltas ride
  // the native controller (V23), never React state
  const [dist, setDist] = useRouteTwigState(route, 'orbitDistance', defaults.dist);
  // the orbit pivot's offset from the view center — zoom-to-cursor writes it
  // (wheel in = converge on the cursor point, wheel out = drift home), so
  // zooming reaches the extremities instead of diving at the center
  const [targetPan, setTargetPan] = useRouteTwigState(route, 'orbitTargetPan', { x: 0, y: 0, z: 0 });
  const [orbitLook, setOrbitLook] = useRouteTwigState(route, 'orbitLook', defaults.look);
  const lookRef = useRef(orbitLook);
  // V23 native camera: the route's own Scene3D.Camera node (nativeCamera prop
  // binds it host-side; the ref's id keys the per-node param/delta channel)
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const orbitRef = useRef<{ x: number; y: number } | null>(null);
  // the FLY camera (noclip, GRABFLY-0605): host freefly mode — WASD + q/e
  // move (host-integrated per frame), drag looks, wheel dollies along the
  // cursor ray. Pose persists per route.
  const [camMode, setCamMode] = useRouteTwigState<'orbit' | 'fly'>(route, 'camMode', defaults.mode);
  const [flyPose, setFlyPose] = useRouteTwigState(route, 'flyPose', defaults.flyPose);
  const camModeRef = useRef(camMode); camModeRef.current = camMode;
  const flyPosRef = useRef<V3>(flyPose.pos);
  const flyLookRef = useRef({ yaw: flyPose.yaw, pitch: flyPose.pitch });
  const flyKeysRef = useRef<Record<string, boolean>>({});

  const center = opts.center;
  const camTarget = (): V3 => [center[0] + targetPan.x, center[1] + targetPan.y, center[2] + targetPan.z];

  const sendOrbit = (target: V3, distance: number) => {
    const l = lookRef.current;
    camCtlRef.current?.setOrbit({ target, yaw: l.yaw, pitch: l.pitch, distance, fov: 45 });
  };

  // ── FOCUS (CAMFOCUS-0606): deterministically frame the subject ────────────
  // The framed pose is pure registry math (sculptFraming.ts) from the
  // subject's bounds (or the view center) + the route's default angles; sent
  // once at param rate in whichever rig is ACTIVE. Runs at boot (outranking
  // the persisted twig pose — a noclip pose is relative to nothing, so the
  // verbatim restore put the camera somewhere arbitrary on every load), on
  // focusKey change (part/model switch), and on the F verb. The persistence
  // machinery stays untouched: mid-session mode flips still resume their pose.
  const focusNow = () => {
    const bounds = opts.subjectBounds?.() ?? null;
    const clampTo = { minDist: TUNE.knobs.zoom.min, maxDist: TUNE.knobs.zoom.max };
    const o = frameOrbit(bounds, center, defaults.look, 45, TUNE.frame.margin, clampTo, defaults.dist);
    // the orbit shadow adopts the framed pose in full (pan = the bounds
    // center's offset from the view center, so camTarget() IS the subject)
    lookRef.current = { yaw: o.yaw, pitch: o.pitch };
    setOrbitLook({ yaw: o.yaw, pitch: o.pitch });
    setTargetPan({ x: o.target[0] - center[0], y: o.target[1] - center[1], z: o.target[2] - center[2] });
    setDist(o.dist);
    if (camModeRef.current === 'fly') {
      const f = frameFly(bounds, center, defaults.look, 45, TUNE.frame.margin, clampTo, defaults.dist);
      flyPosRef.current = f.pos;
      flyLookRef.current = { yaw: f.yaw, pitch: f.pitch };
      sendFlyPose();
      setFlyPose({ pos: f.pos, yaw: f.yaw, pitch: f.pitch });
    } else {
      sendOrbit(o.target, o.dist);
    }
  };
  // effects + the key bus call through the ref so they never hold a stale
  // closure (center/defaults change per render; the bus subscribes once)
  const focusRef = useRef(focusNow);
  focusRef.current = focusNow;

  // Engage: params ride the node id from the camera ref (the nativeCamera prop
  // already bound it host-side at CREATE). Disable on unmount returns the node
  // to the declarative JS-props path.
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn(`[${route}] native camera not engaged — camera node id unavailable (rebuild the host with has-game-camera?)`);
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    camCtlRef.current = ctl;
    ctl.setOrbit({ target: camTarget(), yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: dist, fov: 45 });
    ctl.setMode('orbit');
    // BOOT FRAMING (CAMFOCUS-0606): frame the subject before the mode effect
    // engages the active rig — the framed fly refs are what it sends.
    focusRef.current();
    return () => {
      camCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; param changes ride the effect below
  }, []);

  // part/model switch (the route bumps focusKey) → reframe. Boot framing
  // belongs to the engage effect, so the mount run is skipped.
  const focusKeyRef = useRef(opts.focusKey);
  useEffect(() => {
    if (focusKeyRef.current === opts.focusKey) return;
    focusKeyRef.current = opts.focusKey;
    focusRef.current();
  }, [opts.focusKey]);

  // Param changes (view center / zoom-to-cursor move the target, the zoom
  // knob and wheel move distance) re-send the rig params; yaw/pitch ride
  // along from the ref unchanged. Orbit-mode only — fly owns its own pose.
  useEffect(() => {
    if (camMode === 'orbit') sendOrbit(camTarget(), dist);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the target derives from exactly these
  }, [center[0], center[1], center[2], dist, targetPan, camMode]);

  // ── fly machinery (GRABFLY-0605) — the IsoPreview noclip pattern ──────────
  const sendFlyPose = () => {
    camCtlRef.current?.setFreeFly({
      position: flyPosRef.current, yaw: flyLookRef.current.yaw, pitch: flyLookRef.current.pitch, fov: 45,
    });
  };
  /** read the host-integrated pose back into the refs + the twig (called at
   *  rest points: drag release, key release, wheel — never per frame) */
  const saveFlyPose = () => {
    if (camModeRef.current !== 'fly') return;
    const snap = camCtlRef.current?.getFreeFly?.();
    if (snap) {
      flyPosRef.current = snap.position;
      flyLookRef.current = { yaw: snap.yaw, pitch: snap.pitch };
    }
    setFlyPose({ pos: flyPosRef.current, yaw: flyLookRef.current.yaw, pitch: flyLookRef.current.pitch });
  };
  const sendFlyAxes = () => {
    const ctl = camCtlRef.current;
    if (!ctl) return;
    if (camModeRef.current !== 'fly') { ctl.setMoveAxes(0, 0, 0, 0); return; }
    const k = flyKeysRef.current;
    const forward = (k['w'] ? 1 : 0) + (k['s'] ? -1 : 0);
    const strafe = (k['d'] ? 1 : 0) + (k['a'] ? -1 : 0);
    const lift = ((k['e'] || k['space']) ? 1 : 0) + ((k['q'] || k['__shift']) ? -1 : 0);
    ctl.setMoveAxes(forward, strafe, lift, TUNE.fly.speed);
  };
  // mode switch: the host flips rigs; fly resumes its saved pose, orbit
  // re-sends its rig (runs on mount too — right after the engage effect)
  useEffect(() => {
    const ctl = camCtlRef.current;
    if (!ctl) return;
    if (camMode === 'fly') {
      ctl.setMode('freefly');
      ctl.setSmoothing(0);
      sendFlyPose();
      ctl.setMoveAxes(0, 0, 0, 0);
    } else {
      ctl.setMoveAxes(0, 0, 0, 0);
      ctl.setMode('orbit');
      sendOrbit(camTarget(), dist);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mode flips only; params ride their own effects
  }, [camMode]);
  // the key bus drives move axes (the host integrates per frame). A focused
  // TextInput consumes keys BEFORE the bus fires (engine.zig input_consumed),
  // so typing a name never flies the camera.
  useEffect(() => {
    const setk = (e: any, down: boolean) => {
      const key = String(e?.key ?? '').toLowerCase();
      // camera verbs (CAMFOCUS-0606), taught in the routes' hint lines:
      // F reframes the subject (the lost-position escape hatch), C flips
      // orbit ⇄ fly. Plain keys only — a focused TextInput consumes keys
      // before the bus fires, so typing never triggers them.
      if (down && !e?.ctrlKey && !e?.metaKey && !e?.altKey) {
        if (key === 'f') { focusRef.current(); return; }
        if (key === 'c') { setCamMode((m: any) => (m === 'fly' ? 'orbit' : 'fly')); return; }
      }
      if (key) flyKeysRef.current[key] = down;
      if (typeof e?.shiftKey === 'boolean') flyKeysRef.current['__shift'] = e.shiftKey;
      sendFlyAxes();
      if (!down) saveFlyPose();
    };
    const offD = busOn('__keydown', (e: any) => setk(e, true));
    const offU = busOn('__keyup', (e: any) => setk(e, false));
    return () => { offD(); offU(); camCtlRef.current?.setMoveAxes(0, 0, 0, 0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bus handlers read refs
  }, []);

  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    if (camModeRef.current === 'fly') {
      // FPS look: drag right = look right (lookForward convention), pitch
      // clamped to the host freefly's own ±89 so shadow and host agree
      const l = flyLookRef.current;
      const nextYaw = l.yaw + dx * TUNE.fly.lookPerPx;
      const nextPitch = clamp(l.pitch - dy * TUNE.fly.lookPerPx, TUNE.fly.pitchMin, TUNE.fly.pitchMax);
      camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
      l.yaw = nextYaw;
      l.pitch = nextPitch;
      return;
    }
    // Horizontal sign: the engine renders world +X as screen-LEFT and the rig
    // uses compass yaw, so yaw DECREASES with a rightward drag (the /test
    // USER-VERDICT-pinned sign). Clamps apply HERE so the JS shadow and the
    // host accumulate identically — only the post-clamp delta is sent.
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * TUNE.orbit.yawPerPx;
    const nextPitch = clamp(l.pitch - dy * TUNE.orbit.pitchPerPx, TUNE.orbit.pitchMin, TUNE.orbit.pitchMax);
    camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const orbitUp = () => {
    if (camModeRef.current === 'fly') saveFlyPose();
    else setOrbitLook({ ...lookRef.current });
    orbitRef.current = null;
  };

  // The DECLARATIVE camera is the boot frame only — static props, so React
  // never sends camera UPDATEs after mount; the host writes the node fields
  // every frame once engaged.
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: center,
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: defaults.dist,
      fov: 45,
    }));

  // Picking solves the ACTIVE rig from the JS shadow — orbit from
  // lookRef/dist/camTarget, fly from the host's own freefly readback (so the
  // pick camera IS the rendered camera even mid-flight). Registry pure math,
  // V26-sanctioned; the host owns per-frame driving.
  const solvedCam = (): Solved => {
    if (camModeRef.current === 'fly') {
      const snap = camCtlRef.current?.getFreeFly?.();
      if (snap) {
        flyPosRef.current = snap.position;
        flyLookRef.current = { yaw: snap.yaw, pitch: snap.pitch };
      }
      return GAME_CAMERA.solve(GAME_CAMERA.rigs.FreeFly, {
        position: flyPosRef.current, yaw: flyLookRef.current.yaw, pitch: flyLookRef.current.pitch, fov: 45,
      });
    }
    return GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: camTarget(), yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist, fov: 45,
    });
  };

  const zoomTo = (d: number) => setDist(clamp(d, TUNE.knobs.zoom.min, TUNE.knobs.zoom.max));

  // ── the wheel: dolly + zoom-to-cursor (GRABNAV-0605) ──────────────────────
  // Rides the raw onScroll fallback (events.zig hitTestScroll). Wheel IN
  // converges the orbit pivot on what the cursor points at — the mesh point
  // if pickWorld hits, else the ray's closest approach to the pivot — so
  // aiming at a feature and rolling brings the FEATURE in. Wheel OUT drifts
  // the pivot home: fully zoomed out is always the whole subject, recentered.
  // Pan offsets clamp to TUNE.orbit.panY/panXZ.
  const onWheel = (e: any) => {
    const notches = Number(e?.deltaY ?? 0);
    if (!notches) return;
    if (camModeRef.current === 'fly') {
      // noclip dolly: fly straight along the cursor ray (up = toward it)
      const r = opts.viewRect.current;
      const ray = GAME_CAMERA.screenRay(Number(e?.x ?? 0) - r.x, Number(e?.y ?? 0) - r.y, { x: 0, y: 0, width: r.width, height: r.height }, solvedCam());
      const step = notches * TUNE.fly.wheelStep;
      const next: V3 = [
        flyPosRef.current[0] + ray.dir[0] * step,
        flyPosRef.current[1] + ray.dir[1] * step,
        flyPosRef.current[2] + ray.dir[2] * step,
      ];
      flyPosRef.current = next;
      sendFlyPose();
      setFlyPose({ pos: next, yaw: flyLookRef.current.yaw, pitch: flyLookRef.current.pitch });
      return;
    }
    const target = camTarget();
    const next = clamp(dist - notches * TUNE.knobs.zoom.step, TUNE.knobs.zoom.min, TUNE.knobs.zoom.max);
    if (next < dist) {
      const sx = Number(e?.x ?? 0), sy = Number(e?.y ?? 0);
      const cam = solvedCam();
      let aim = opts.pickWorld?.(sx, sy, cam) ?? null;
      if (!aim) {
        const r = opts.viewRect.current;
        const ray = GAME_CAMERA.screenRay(sx - r.x, sy - r.y, { x: 0, y: 0, width: r.width, height: r.height }, cam);
        const t = (target[0] - ray.origin[0]) * ray.dir[0] + (target[1] - ray.origin[1]) * ray.dir[1] + (target[2] - ray.origin[2]) * ray.dir[2];
        aim = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
      }
      const k = 1 - next / dist; // the dolly fraction covered this notch
      const B = TUNE.orbit;
      setTargetPan((p) => ({
        x: clamp(p.x + (aim![0] - target[0]) * k, -B.panXZ, B.panXZ),
        y: clamp(p.y + (aim![1] - target[1]) * k, -B.panY, B.panY),
        z: clamp(p.z + (aim![2] - target[2]) * k, -B.panXZ, B.panXZ),
      }));
    } else if (next > dist) {
      const k = clamp((next - dist) / Math.max(next, 0.001), 0, 1);
      setTargetPan((p) => ({ x: p.x * (1 - k), y: p.y * (1 - k), z: p.z * (1 - k) }));
    }
    setDist(next);
  };

  return {
    cameraRef,
    bootCam,
    camMode,
    setCamMode,
    dist,
    zoomTo,
    zoomReflect: TUNE.knobs.zoom.min + TUNE.knobs.zoom.max,
    solvedCam,
    camTarget,
    orbitDown,
    orbitMove,
    orbitUp,
    dragging: () => orbitRef.current !== null,
    onWheel,
    focus: () => focusRef.current(),
  };
}
