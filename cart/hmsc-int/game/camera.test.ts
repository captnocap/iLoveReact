// camera.test.ts — P4 behavior tests for GAME_CAMERA.
//
// Pure math, no fakes: solving is deterministic and side-effect-free, every
// registered rig produces a finite camera, modifiers fold in order, and the
// pick path inverts — a click on the screen center of a solved camera lands on
// the ground point the camera is looking at, whichever rig solved it.
//
// The V3 graduations are held to the fidelity bar: the Aim rig is swept
// case-by-case against a verbatim transcription of combat_lab's shoulderCamera
// (the behavior reference), and screenRay against the assist3d hand-roll it
// replaces. The meaning tests then pin WHY the rig exists: the aim ceiling is
// gone (the screen axis genuinely pitches) and the crosshair law holds (the
// center ray IS the camera axis).

import { GAME_CAMERA, type Solved, type Vec3 } from './camera';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };
const DEG = Math.PI / 180;

function finiteSolved(s: Solved): boolean {
  return [...s.pos, ...s.target, s.fov].every(Number.isFinite);
}

test('every registered rig solves its own defaults to a finite camera', () => {
  const expected = ['Orbit', 'Follow', 'TopDown', 'Isometric', 'FirstPerson', 'FreeFly', 'Cinematic', 'Aim'];
  for (const name of expected) {
    assert(name in GAME_CAMERA.rigs, `${name} must be registered (V3: seven shipped rigs + the graduated Aim)`);
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs[name]);
    assert(finiteSolved(solved), `${name} must solve to finite pos/target/fov`);
    assert(solved.fov > 0 && solved.fov < 180, `${name} fov must be a usable angle`);
  }
});

test('solving is pure: same params, same camera; defaults never mutate', () => {
  const rig = GAME_CAMERA.rigs.Orbit;
  const before = JSON.stringify(rig.defaults);
  const a = GAME_CAMERA.solve(rig, { target: [5, 0, 5], yaw: 30 });
  const b = GAME_CAMERA.solve(rig, { target: [5, 0, 5], yaw: 30 });
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'same params must give the same Solved');
  assertEqual(JSON.stringify(rig.defaults), before, 'solving must not mutate the rig defaults');
});

test('modifiers fold in order over the solved camera', () => {
  const lift = (s: Solved): Solved => ({ ...s, pos: [s.pos[0], s.pos[1] + 1, s.pos[2]] });
  const widen = (s: Solved): Solved => ({ ...s, fov: s.fov * 2 });
  const plain = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit);
  const modded = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {}, [lift, widen]);
  assertClose(modded.pos[1], plain.pos[1] + 1, 1e-9, 'the lift modifier must apply');
  assertClose(modded.fov, plain.fov * 2, 1e-9, 'the widen modifier must apply after it');
});

// ── the Aim rig (V3 graduation from cart/combat_lab) ─────────────────────────

// The behavior reference, transcribed VERBATIM from combat_lab's
// shoulderCamera aiming branch (cart/combat_lab/index.tsx:468-491) with its
// AIM_CAMERA + HMSC_GAMEPLAY_CAMERA constants. Reference pitch is RADIANS with
// + = down; the rig speaks degrees with + = up (registry convention), so the
// sweep maps pitch = -pitchRadians / DEG.
const REF_AIM = {
  pivotHeightMeters: 1.62,
  crouchPivotDropMeters: 0.42,
  distanceMeters: 2.4,
  lookAheadMeters: 12,
  minPitchRadians: -1.0, // ~57° up
  maxPitchRadians: 1.15, // ~66° down
  aimShoulderShiftMeters: 0.62,
  aimFovDegrees: 47,
};

function referenceAimCamera(px: number, pz: number, yawDegrees: number, pitchRadians: number, crouch01: number) {
  const yawRadians = yawDegrees * DEG;
  const right: Vec3 = [-Math.cos(yawRadians), 0, Math.sin(yawRadians)];
  const cp = Math.cos(pitchRadians);
  const fwd: Vec3 = [Math.sin(yawRadians) * cp, -Math.sin(pitchRadians), Math.cos(yawRadians) * cp];
  const shift = REF_AIM.aimShoulderShiftMeters;
  const pivot: Vec3 = [
    px + right[0] * shift,
    REF_AIM.pivotHeightMeters - crouch01 * REF_AIM.crouchPivotDropMeters,
    pz + right[2] * shift,
  ];
  const position: Vec3 = [
    pivot[0] - fwd[0] * REF_AIM.distanceMeters,
    pivot[1] - fwd[1] * REF_AIM.distanceMeters,
    pivot[2] - fwd[2] * REF_AIM.distanceMeters,
  ];
  const target: Vec3 = [
    pivot[0] + fwd[0] * REF_AIM.lookAheadMeters,
    pivot[1] + fwd[1] * REF_AIM.lookAheadMeters,
    pivot[2] + fwd[2] * REF_AIM.lookAheadMeters,
  ];
  return { position, target, fov: REF_AIM.aimFovDegrees, pivot };
}

test('FIDELITY: Aim reproduces combat_lab shoulderCamera across the input space (1,728 cases)', () => {
  const yaws: number[] = [];
  for (let y = 0; y < 360; y += 15) yaws.push(y);
  const pitchesRad = [-1.0, -0.7, -0.35, 0, 0.05, 0.4, 0.8, 1.15]; // reference clamp range, + = down
  const crouches = [0, 0.25, 1];
  const positions: Array<[number, number]> = [[0, 13], [-7.5, 3.2], [120.5, -44]];
  let cases = 0;
  for (const [px, pz] of positions) {
    for (const yaw of yaws) {
      for (const pitchRad of pitchesRad) {
        for (const crouch of crouches) {
          const ref = referenceAimCamera(px, pz, yaw, pitchRad, crouch);
          const got = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, {
            target: [px, 0, pz], yaw, pitch: -pitchRad / DEG, crouch,
          });
          const tag = `yaw ${yaw} pitchRad ${pitchRad} crouch ${crouch} @ (${px},${pz})`;
          for (let i = 0; i < 3; i++) {
            assertClose(got.pos[i], ref.position[i], 1e-9, `${tag}: pos[${i}]`);
            assertClose(got.target[i], ref.target[i], 1e-9, `${tag}: target[${i}]`);
          }
          assertEqual(got.fov, ref.fov, `${tag}: fov`);
          cases += 1;
        }
      }
    }
  }
  assertEqual(cases, 1728, 'the sweep must cover the full grid');
});

test('the aim ceiling is gone: the screen axis elevation IS the pitch param', () => {
  for (const pitch of [-50, -10, 0, 25, 57]) {
    const s = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch });
    const axis = [s.target[0] - s.pos[0], s.target[1] - s.pos[1], s.target[2] - s.pos[2]];
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    const elevation = Math.asin(axis[1] / len) / DEG;
    assertClose(elevation, pitch, 1e-9, `at pitch ${pitch}° the axis must genuinely point ${pitch}°`);
  }
  // Follow (the camera the aim rig replaced for combat) cannot do this: its
  // axis at default geometry points DOWN at the subject. That contrast is the
  // V3 ruling's whole reason.
  const f = GAME_CAMERA.solve(GAME_CAMERA.rigs.Follow);
  assert(f.target[1] - f.pos[1] < 0, 'Follow looks down at its subject — it has no sky authority');
});

test('pitch clamps hold: aiming gets the sky (~57° up) but never a backflip', () => {
  const atMax = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch: 90 });
  const atClamp = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch: 1.0 / DEG });
  assertEqual(JSON.stringify(atMax), JSON.stringify(atClamp), 'pitch 90 must clamp to the up limit');
  const atMin = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch: -90 });
  const atFloor = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch: -1.15 / DEG });
  assertEqual(JSON.stringify(atMin), JSON.stringify(atFloor), 'pitch -90 must clamp to the down limit');
  const up = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { pitch: 1.0 / DEG });
  const axisY = up.target[1] - up.pos[1];
  assert(axisY > 0, 'at the up clamp the axis must rise above the horizon');
});

test('the eye frames over the shoulder, perpendicular to the aim, and crouch pulls it down', () => {
  for (const yaw of [0, 45, 120, 300]) {
    const pivot = GAME_CAMERA.aimPivot({ target: [10, 0, -4], yaw });
    const offset = [pivot[0] - 10, pivot[2] - -4];
    assertClose(Math.hypot(offset[0], offset[1]), 0.62, 1e-9, `yaw ${yaw}: lateral shoulder offset`);
    const fwd = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
    assertClose(offset[0] * fwd[0] + offset[1] * fwd[1], 0, 1e-9, `yaw ${yaw}: the shift is perpendicular to the aim`);
  }
  const standing = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { crouch: 0 });
  const crouched = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { crouch: 1 });
  assertClose(standing.pos[1] - crouched.pos[1], 0.42, 1e-9, 'full crouch drops the eye by crouchDrop');
  assertClose(standing.target[1] - crouched.target[1], 0.42, 1e-9, 'and the look target with it');
});

test('ADS framing: the eye sits exactly `distance` behind the pivot along the aim axis', () => {
  for (const pitch of [-40, 0, 50]) {
    const params = { target: [3, 0, 7] as Vec3, yaw: 70, pitch, crouch: 0.5 };
    const pivot = GAME_CAMERA.aimPivot(params);
    const s = GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, params);
    const back = Math.hypot(s.pos[0] - pivot[0], s.pos[1] - pivot[1], s.pos[2] - pivot[2]);
    assertClose(back, 2.4, 1e-9, `pitch ${pitch}: ADS eye distance`);
  }
});

// ── screenRay (R7 graduation — the canonical pixel→world ray) ────────────────

// The behavior reference, transcribed VERBATIM from the hand-rolled duplicate
// family (cart/hmsc-int/assist3d/picking.ts screenRay — same math as
// voxel_stack_demo's and the old inline unprojectGround basis).
function referenceScreenRay(sx: number, sy: number, rect: typeof VIEWPORT, cam: Solved): { o: Vec3; d: Vec3 } {
  const { pos, target, fov } = cam;
  let fx = pos[0] - target[0], fy = pos[1] - target[1], fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sxv = fz, syv = 0, szv = -fx;
  const sl = Math.hypot(sxv, syv, szv) || 1; sxv /= sl; syv /= sl; szv /= sl;
  const ux = fy * szv - fz * syv;
  const uy = fz * sxv - fx * szv;
  const uz = fx * syv - fy * sxv;
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const tanHalf = Math.tan((fov * Math.PI) / 180 / 2);
  const ndcX = (sx / w) * 2 - 1, ndcY = 1 - (sy / h) * 2;
  const vx = ndcX * tanHalf * (w / h), vy = ndcY * tanHalf, vz = -1;
  let dx = vx * sxv + vy * ux + vz * fx;
  let dy = vx * syv + vy * uy + vz * fy;
  let dz = vx * szv + vy * uz + vz * fz;
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  return { o: pos, d: [dx, dy, dz] };
}

function sweepCameras(): Solved[] {
  return [
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [12, 0, 8], yaw: 30, pitch: 40 }),
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [-5, 2, 90], yaw: 200, pitch: 70, dist: 40 }),
    GAME_CAMERA.solve(GAME_CAMERA.rigs.TopDown, { target: [0, 0, 0] }),
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Isometric, { target: [33, 0, -21] }),
    GAME_CAMERA.solve(GAME_CAMERA.rigs.FirstPerson, { position: [4, 0, 4], facing: 135, pitch: -10 }),
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Aim, { target: [7, 0, -2], yaw: 250, pitch: 30 }),
  ];
}

test('FIDELITY: screenRay matches the hand-rolled duplicate family (150 cases)', () => {
  const cams = sweepCameras();
  let cases = 0;
  for (let c = 0; c < cams.length; c++) {
    for (let ix = 0; ix < 5; ix++) {
      for (let iy = 0; iy < 5; iy++) {
        const sx = (ix / 4) * VIEWPORT.width;
        const sy = (iy / 4) * VIEWPORT.height;
        const ref = referenceScreenRay(sx, sy, VIEWPORT, cams[c]);
        const got = GAME_CAMERA.screenRay(sx, sy, VIEWPORT, cams[c]);
        const tag = `cam ${c} px (${sx},${sy})`;
        for (let i = 0; i < 3; i++) {
          assertClose(got.origin[i], ref.o[i], 1e-12, `${tag}: origin[${i}]`);
          assertClose(got.dir[i], ref.d[i], 1e-12, `${tag}: dir[${i}]`);
        }
        cases += 1;
      }
    }
  }
  assertEqual(cases, 150, 'the sweep must cover the full grid');
});

test('the crosshair law: the screen-center ray IS the camera axis, every rig', () => {
  for (const cam of sweepCameras()) {
    const { origin, dir } = GAME_CAMERA.screenRay(VIEWPORT.width / 2, VIEWPORT.height / 2, VIEWPORT, cam);
    const ax = cam.target[0] - cam.pos[0];
    const ay = cam.target[1] - cam.pos[1];
    const az = cam.target[2] - cam.pos[2];
    const al = Math.hypot(ax, ay, az) || 1;
    assertClose(dir[0], ax / al, 1e-9, 'center dir x must be the camera axis');
    assertClose(dir[1], ay / al, 1e-9, 'center dir y must be the camera axis');
    assertClose(dir[2], az / al, 1e-9, 'center dir z must be the camera axis');
    for (let i = 0; i < 3; i++) assertEqual(origin[i], cam.pos[i], 'the ray starts at the eye');
    assertClose(Math.hypot(dir[0], dir[1], dir[2]), 1, 1e-12, 'dir is unit length');
  }
});

test('unprojectGround is a screenRay consumer: the ground hit lies on the pixel ray at y=0', () => {
  const cam = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [12, 0, 8], yaw: 25, pitch: 50 });
  for (const [sx, sy] of [[400, 300], [120, 450], [700, 90]] as const) {
    const { origin, dir } = GAME_CAMERA.screenRay(sx, sy, VIEWPORT, cam);
    assert(dir[1] < 0, 'this pixel must look down for the analytic check');
    const t = -origin[1] / dir[1];
    const g = GAME_CAMERA.unprojectGround(sx, sy, VIEWPORT, cam);
    assertClose(g.x, origin[0] + t * dir[0], 1e-4, `px (${sx},${sy}): ground x on the ray`);
    assertClose(g.y, origin[2] + t * dir[2], 1e-4, `px (${sx},${sy}): ground z on the ray`);
  }
});

test('a screen-center pick lands on the ground point the camera looks at', () => {
  for (const name of ['Orbit', 'TopDown', 'Isometric'] as const) {
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs[name], { target: [12, 0, 8] });
    const pick = GAME_CAMERA.unprojectGround(VIEWPORT.width / 2, VIEWPORT.height / 2, VIEWPORT, solved);
    assertClose(pick.x, 12, 0.05, `${name}: center pick x must hit the look point`);
    assertClose(pick.y, 8, 0.05, `${name}: center pick z must hit the look point`);
  }
});

test('picking respects the height field (a raised ground catches the ray sooner)', () => {
  const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 0, 0], pitch: 45 });
  const flat = GAME_CAMERA.unprojectGround(500, 300, VIEWPORT, solved);
  const raised = GAME_CAMERA.unprojectGround(500, 300, VIEWPORT, solved, () => 2);
  const flatDist = Math.hypot(flat.x - solved.pos[0], flat.y - solved.pos[2]);
  const raisedDist = Math.hypot(raised.x - solved.pos[0], raised.y - solved.pos[2]);
  assert(raisedDist < flatDist, 'a raised surface must catch the ray closer to the eye');
});

finish('game/camera');
