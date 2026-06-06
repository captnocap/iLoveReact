// sculptFraming.test.ts — P4 behavior suite for the sculpt camera's boot/
// refocus framing (CAMFOCUS-0606). The bug under test: boot restored a
// persisted noclip pose verbatim, so the camera loaded offset every time.
// These cases pin the cure — a framed pose is DETERMINISTIC, CENTERED on the
// subject's bounds, at a distance that fits them, in both rigs.

import { GAME_CAMERA, type Vec3 } from '../game/camera';
import {
  applySculptEngagement, cloudBounds, fpsLookAt, frameDistance, frameFly, frameOrbit, normalizeDeg,
  type SculptEngageCtl,
} from './sculptFraming';
import { PAINT_EDITOR_TUNING } from './characters/paintKit';
import { assert, assertClose, finish, test } from '../game/_testkit';

const TUNE = PAINT_EDITOR_TUNING;
const CLAMP = { minDist: TUNE.knobs.zoom.min, maxDist: TUNE.knobs.zoom.max };
const LOOK = { yaw: 20, pitch: 12 };
const FOV = 45;

function cloud(points: number[][]): { points: Float32Array } {
  const flat = new Float32Array(points.length * 3);
  points.forEach((p, i) => { flat[i * 3] = p[0]; flat[i * 3 + 1] = p[1]; flat[i * 3 + 2] = p[2]; });
  return { points: flat };
}

test('normalizeDeg wraps accumulated orbit yaw home (the -365° twig)', () => {
  assertClose(normalizeDeg(-365.315), -5.315, 1e-9, 'lap 2 of a spin normalizes');
  assertClose(normalizeDeg(540), 180, 1e-9, '540 → 180');
  assertClose(normalizeDeg(20), 20, 1e-9, 'in-range angles untouched');
});

test('cloudBounds: bbox center + half-diagonal radius over every cloud', () => {
  const b = cloudBounds([
    cloud([[-1, 0, 0], [1, 0, 0]]),
    cloud([[0, 2, 0], [0, 0, 2]]),
  ])!;
  assert(b !== null, 'bounds resolve');
  assertClose(b.center[0], 0, 1e-6, 'center x');
  assertClose(b.center[1], 1, 1e-6, 'center y');
  assertClose(b.center[2], 1, 1e-6, 'center z');
  assertClose(b.radius, Math.hypot(2, 2, 2) / 2, 1e-6, 'radius = half diagonal');
  assert(cloudBounds([]) === null, 'no clouds → null (fallback framing)');
  assert(cloudBounds([cloud([])]) === null, 'empty cloud → null');
});

test('frameDistance fits the sphere in the fov and clamps to the zoom range', () => {
  const d = frameDistance(1, FOV, 1, { minDist: 0, maxDist: 100 });
  assertClose(d, 1 / Math.tan((FOV / 2) * Math.PI / 180), 1e-9, 'margin 1 = exact frustum fit');
  assert(frameDistance(0.01, FOV, 1, CLAMP) >= CLAMP.minDist, 'tiny subject clamps to min zoom');
  assert(frameDistance(100, FOV, 1, CLAMP) <= CLAMP.maxDist, 'huge subject clamps to max zoom');
  assert(frameDistance(1, FOV, 1.25, CLAMP) > frameDistance(1, FOV, 1.0, CLAMP), 'margin backs off');
});

test('frameOrbit centers the subject bounds; deterministic; falls back sanely', () => {
  const bounds = { center: [0.3, 1.1, -0.2] as Vec3, radius: 1.2 };
  const a = frameOrbit(bounds, [0, 1.4, 0], LOOK, FOV, TUNE.frame.margin, CLAMP, 4.2);
  const b = frameOrbit(bounds, [0, 1.4, 0], LOOK, FOV, TUNE.frame.margin, CLAMP, 4.2);
  assert(JSON.stringify(a) === JSON.stringify(b), 'same subject → same pose, every load');
  assertClose(a.target[0], 0.3, 1e-9, 'target = bounds center x');
  assertClose(a.target[1], 1.1, 1e-9, 'target = bounds center y');
  assertClose(a.target[2], -0.2, 1e-9, 'target = bounds center z');
  assertClose(a.yaw, LOOK.yaw, 1e-9, 'angles are the route defaults');
  const noBounds = frameOrbit(null, [0, 1.4, 0], { yaw: -365.315, pitch: 12 }, FOV, TUNE.frame.margin, CLAMP, 4.2);
  assertClose(noBounds.target[1], 1.4, 1e-9, 'no bounds → the view center');
  assertClose(noBounds.dist, 4.2, 1e-9, 'no bounds → the default distance');
  assertClose(noBounds.yaw, -5.315, 1e-6, 'accumulated yaw normalizes at framing');
});

test('fpsLookAt is lookForward\'s exact inverse (host = shadow = framed aim)', () => {
  // round-trip: pick angles, walk lookForward's formula, recover the angles
  for (const [yaw, pitch] of [[0, 0], [35, -20], [-120, 44], [179, -80]]) {
    const DEG = Math.PI / 180;
    const eye: Vec3 = [2, 1, -3];
    const dir = [
      -Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
      Math.sin(pitch * DEG),
      Math.cos(yaw * DEG) * Math.cos(pitch * DEG),
    ];
    const target: Vec3 = [eye[0] + dir[0] * 5, eye[1] + dir[1] * 5, eye[2] + dir[2] * 5];
    const got = fpsLookAt(eye, target);
    assertClose(got.yaw, yaw, 1e-6, `yaw round-trips (${yaw},${pitch})`);
    assertClose(got.pitch, pitch, 1e-6, `pitch round-trips (${yaw},${pitch})`);
  }
});

test('frameFly: the framed eye looks dead at the subject (no boot offset)', () => {
  const bounds = { center: [0.5, 1.0, 0.25] as Vec3, radius: 1.1 };
  const f = frameFly(bounds, [0, 1.4, 0], LOOK, FOV, TUNE.frame.margin, CLAMP, 4.2);
  // solve the resulting freefly through the registry — its look ray must pass
  // through the bounds center (the ruling: "frames the model ... no offset")
  const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.FreeFly, {
    position: f.pos, yaw: f.yaw, pitch: f.pitch, fov: FOV,
  });
  const d: Vec3 = [
    solved.target[0] - solved.pos[0], solved.target[1] - solved.pos[1], solved.target[2] - solved.pos[2],
  ];
  const toC: Vec3 = [
    bounds.center[0] - solved.pos[0], bounds.center[1] - solved.pos[1], bounds.center[2] - solved.pos[2],
  ];
  const dl = Math.hypot(d[0], d[1], d[2]);
  const cl = Math.hypot(toC[0], toC[1], toC[2]);
  const dot = (d[0] * toC[0] + d[1] * toC[1] + d[2] * toC[2]) / (dl * cl);
  assert(dot > 0.99999, `the framed fly aim passes through the subject center (cos=${dot})`);
  // and the eye sits at the framed orbit distance from the subject
  const o = frameOrbit(bounds, [0, 1.4, 0], LOOK, FOV, TUNE.frame.margin, CLAMP, 4.2);
  assertClose(cl, o.dist, 1e-6, 'fly eye distance = the framed orbit distance (one framing, two rigs)');
});

test('a figure-sized subject frames inside the zoom knob range', () => {
  // a ~2-unit figure (the scale-contract human anchor): head at y≈2, feet at 0
  const figure = cloudBounds([cloud([[-0.45, 0, -0.25], [0.45, 2.0, 0.25]])])!;
  const o = frameOrbit(figure, [0, 1.05, 0], LOOK, FOV, TUNE.frame.margin, CLAMP, 4.2);
  assert(o.dist >= CLAMP.minDist && o.dist <= CLAMP.maxDist, `figure framing distance ${o.dist} stays on the knob`);
  assertClose(o.target[1], 1.0, 1e-6, 'framed at mid-figure, not the floor');
});

test('engagement (CAMBIND-0606): one full-state sequence per rig — a rebind is never partial, never just orbit', () => {
  const calls: string[] = [];
  const ctl: SculptEngageCtl = {
    setMode: (m) => calls.push(`mode:${m}`),
    setOrbit: (p) => calls.push(`orbit:${p.target.join(',')}@${p.distance}`),
    setFreeFly: (p) => calls.push(`fly:${p.position.join(',')}/${p.yaw.toFixed(0)}`),
    setSmoothing: (n) => calls.push(`smooth:${n}`),
    setMoveAxes: (f, s, l, sp) => calls.push(`axes:${f},${s},${l},${sp}`),
  };
  const orbit = { target: [0, 1.05, 0] as Vec3, yaw: 20, pitch: 12, distance: 4.2, fov: 45 };
  const fly = { position: [0, 1.5, -3.4] as Vec3, yaw: 0, pitch: -4, fov: 45 };

  // FLY: freefly mode, zero smoothing (raw look), the saved pose, axes cleared
  applySculptEngagement(ctl, 'fly', orbit, fly);
  assert(JSON.stringify(calls) === JSON.stringify([
    'mode:freefly', 'smooth:0', 'fly:0,1.5,-3.4/0', 'axes:0,0,0,0',
  ]), `fly engagement is the exact GRABFLY sequence (got ${calls.join(' | ')})`);

  // ORBIT: any flight stopped FIRST, the rig params, orbit mode
  calls.length = 0;
  applySculptEngagement(ctl, 'orbit', orbit, fly);
  assert(JSON.stringify(calls) === JSON.stringify([
    'axes:0,0,0,0', 'orbit:0,1.05,0@4.2', 'mode:orbit',
  ]), `orbit engagement stops flight then applies the rig (got ${calls.join(' | ')})`);

  // a REBIND (the lens-switch case) is the SAME sequence against a fresh
  // controller — full state, nothing carried from the dead node
  const rebindCalls: string[] = [];
  const fresh: SculptEngageCtl = {
    setMode: (m) => rebindCalls.push(`mode:${m}`),
    setOrbit: () => rebindCalls.push('orbit'),
    setFreeFly: () => rebindCalls.push('fly'),
    setSmoothing: (n) => rebindCalls.push(`smooth:${n}`),
    setMoveAxes: () => rebindCalls.push('axes'),
  };
  applySculptEngagement(fresh, 'fly', orbit, fly);
  assert(rebindCalls.includes('mode:freefly') && rebindCalls.includes('fly') && rebindCalls.includes('smooth:0'),
    'a rebound controller receives mode AND pose AND smoothing — the stale-state hole is closed');
});

finish('editors/sculptFraming');
