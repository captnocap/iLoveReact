// animation_lab - pose animation over the camera_lab humanoid.
//
// Ship: ./scripts/ship animation_lab

import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';

type Vec3 = [number, number, number];
type Action =
  | 'walk' | 'run' | 'jump' | 'sit' | 'sleep' | 'drive'
  | 'dance' | 'cry' | 'laugh' | 'fart' | 'point' | 'wave';
type CameraMode = 'third' | 'first';

const PAGE = '#070911';
const BAR = '#0f1421';
const FRAME = '#242c3d';
const INK = '#e8eef9';
const DIM = '#9aa4b8';
const ACCENT = '#ffb84d';
const SCENE_BG = '#151d2d';

const SKIN = '#caa07a';
const SHIRT = '#c23b8e';
const PANTS = '#272238';
const SHOE = '#15121f';
const HAT = '#e8c14a';
const EYE = '#0a0a12';
const BELT = '#2b2638';
const NOSE = '#b8906a';

const SCAN_SPACE = 44;
const SCAN_LSHIFT = 225;
const SCAN_RSHIFT = 229;
const JUMP_SPEED = 4.6;
const GRAVITY = 9.2;
const WARMUP_SECONDS = 25;
const WARMUP_END_HOLD_SECONDS = 5;

const ACTIONS: { id: Action; label: string; group: 'move' | 'emote' }[] = [
  { id: 'walk', label: 'walk', group: 'move' },
  { id: 'run', label: 'run', group: 'move' },
  { id: 'jump', label: 'jump', group: 'move' },
  { id: 'sit', label: 'sit', group: 'move' },
  { id: 'sleep', label: 'sleep', group: 'move' },
  { id: 'drive', label: 'drive', group: 'move' },
  { id: 'dance', label: 'dance', group: 'emote' },
  { id: 'cry', label: 'cry', group: 'emote' },
  { id: 'laugh', label: 'laugh', group: 'emote' },
  { id: 'fart', label: 'fart', group: 'emote' },
  { id: 'point', label: 'point', group: 'emote' },
  { id: 'wave', label: 'wave', group: 'emote' },
];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const rad = (deg: number) => deg * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotateY(v: Vec3, yawRad: number): Vec3 {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateX(v: Vec3, pitchRad: number): Vec3 {
  const c = Math.cos(pitchRad);
  const s = Math.sin(pitchRad);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function orient(v: Vec3, yawRad: number, rootPitchDeg = 0): Vec3 {
  return rotateY(rotateX(v, rad(rootPitchDeg)), yawRad);
}

function dirDown(swingDeg: number, sideDeg: number, yawRad: number, rootPitchDeg = 0): Vec3 {
  const sx = rad(swingDeg);
  const sz = rad(sideDeg);
  const local: Vec3 = [
    Math.sin(sz),
    -Math.cos(sz) * Math.cos(sx),
    -Math.cos(sz) * Math.sin(sx),
  ];
  return orient(local, yawRad, rootPitchDeg);
}

function point(base: Vec3, local: Vec3, yawRad: number, rootPitchDeg = 0): Vec3 {
  return add(base, orient(local, yawRad, rootPitchDeg));
}

function segmentPose(joint: Vec3, length: number, swingDeg: number, sideDeg: number, yawRad: number, rootPitchDeg = 0) {
  const d = dirDown(swingDeg, sideDeg, yawRad, rootPitchDeg);
  return {
    center: add(joint, [d[0] * length * 0.5, d[1] * length * 0.5, d[2] * length * 0.5]),
    end: add(joint, [d[0] * length, d[1] * length, d[2] * length]),
    rotation: [swingDeg + rootPitchDeg, deg(yawRad), sideDeg] as Vec3,
  };
}

function hostNumber(name: string, fallback: number, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn !== 'function') return fallback;
  const v = Number(fn(...args));
  return Number.isFinite(v) ? v : fallback;
}

function hostString(name: string, fallback: string, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn !== 'function') return fallback;
  const v = fn(...args);
  return typeof v === 'string' ? v : fallback;
}

function hostVoid(name: string, ...args: unknown[]) {
  const fn = (globalThis as any)[name];
  if (typeof fn === 'function') fn(...args);
}

type Pose = {
  rootPitch: number;
  bodyY: number;
  torsoLean: number;
  headNod: number;
  leftLeg: number;
  rightLeg: number;
  leftKnee: number;
  rightKnee: number;
  leftArm: number;
  rightArm: number;
  armLift: number;
};

function poseFor(action: Action, t: number, moving: boolean, driveJumpY: number): Pose {
  if (action === 'dance') {
    const s = Math.sin(t * 8.0);
    const c = Math.cos(t * 4.0);
    return {
      rootPitch: 0,
      bodyY: 0.05 + Math.abs(s) * 0.1,
      torsoLean: c * 14,
      headNod: Math.abs(s) * -8,
      leftLeg: s * 28,
      rightLeg: -s * 28,
      leftKnee: 18 + Math.max(0, -s) * 28,
      rightKnee: 18 + Math.max(0, s) * 28,
      leftArm: -80 + s * 34,
      rightArm: -80 - s * 34,
      armLift: 28 + Math.abs(c) * 14,
    };
  }

  if (action === 'cry') {
    const sob = Math.abs(Math.sin(t * 5.0));
    return {
      rootPitch: 0,
      bodyY: -sob * 0.025,
      torsoLean: -7 - sob * 3,
      headNod: 18 + sob * 5,
      leftLeg: -1,
      rightLeg: 1,
      leftKnee: 7,
      rightKnee: 7,
      leftArm: 78 + sob * 5,
      rightArm: 78 + sob * 5,
      armLift: 18,
    };
  }

  if (action === 'laugh') {
    const laugh = Math.abs(Math.sin(t * 7.0));
    return {
      rootPitch: 0,
      bodyY: laugh * 0.05,
      torsoLean: -18 - laugh * 8,
      headNod: -16 - laugh * 10,
      leftLeg: -4,
      rightLeg: 4,
      leftKnee: 8,
      rightKnee: 8,
      leftArm: -28 + laugh * 14,
      rightArm: -28 - laugh * 14,
      armLift: 10 + laugh * 8,
    };
  }

  if (action === 'fart') {
    const p = Math.sin(t * 6.0);
    return {
      rootPitch: 0,
      bodyY: -0.06 + Math.abs(p) * 0.025,
      torsoLean: -4,
      headNod: 18,
      leftLeg: -18,
      rightLeg: 24,
      leftKnee: 28,
      rightKnee: 42,
      leftArm: 15,
      rightArm: -12,
      armLift: 0,
    };
  }

  if (action === 'point') {
    return {
      rootPitch: 0,
      bodyY: 0,
      torsoLean: -2,
      headNod: -4,
      leftLeg: -2,
      rightLeg: 2,
      leftKnee: 8,
      rightKnee: 8,
      leftArm: 6,
      rightArm: 86,
      armLift: -12,
    };
  }

  if (action === 'wave') {
    const w = Math.sin(t * 8.0);
    return {
      rootPitch: 0,
      bodyY: 0,
      torsoLean: w * 2,
      headNod: -6,
      leftLeg: -1,
      rightLeg: 1,
      leftKnee: 8,
      rightKnee: 8,
      leftArm: 8,
      rightArm: 66 + w * 16,
      armLift: 24,
    };
  }

  if (action === 'sit') {
    const breathe = Math.sin(t * 1.4) * 1.5;
    return {
      rootPitch: 0,
      bodyY: -0.34,
      torsoLean: -8 + breathe,
      headNod: 5,
      leftLeg: 72,
      rightLeg: 72,
      leftKnee: 108,
      rightKnee: 108,
      leftArm: 24,
      rightArm: 24,
      armLift: 1,
    };
  }

  if (action === 'sleep') {
    const breathe = Math.sin(t * 1.15) * 1.8;
    return {
      rootPitch: 82,
      bodyY: 0.18 + Math.max(0, breathe) * 0.01,
      torsoLean: breathe,
      headNod: 8,
      leftLeg: 6,
      rightLeg: -8,
      leftKnee: 14,
      rightKnee: 20,
      leftArm: 36,
      rightArm: 18,
      armLift: 7,
    };
  }

  if (action === 'jump') {
    const p = (t * 0.72) % 1;
    const air = Math.sin(Math.PI * p);
    const crouch = p < 0.18 ? p / 0.18 : p > 0.82 ? (1 - p) / 0.18 : 0;
    return {
      rootPitch: 0,
      bodyY: air * 0.72 - crouch * 0.16,
      torsoLean: -6,
      headNod: -air * 7,
      leftLeg: 10 + air * 22,
      rightLeg: 10 + air * 22,
      leftKnee: 18 + air * 54,
      rightKnee: 18 + air * 54,
      leftArm: -28 - air * 62,
      rightArm: -28 - air * 62,
      armLift: 8 + air * 18,
    };
  }

  if (action === 'drive' && !moving) {
    return {
      rootPitch: 0,
      bodyY: driveJumpY,
      torsoLean: 0,
      headNod: 0,
      leftLeg: 0,
      rightLeg: 0,
      leftKnee: 5,
      rightKnee: 5,
      leftArm: 4,
      rightArm: -4,
      armLift: 0,
    };
  }

  const run = action === 'run';
  const phase = t * (run ? 8.6 : 5.0);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const legAmp = run ? 52 : 30;
  const armAmp = run ? 60 : 34;
  const bounce = run ? Math.abs(c) * 0.085 : Math.abs(c) * 0.035;
  const kneeBase = run ? 14 : 8;
  return {
    rootPitch: 0,
    bodyY: bounce + driveJumpY,
    torsoLean: run ? -9 : -3,
    headNod: -Math.abs(c) * (run ? 5 : 2),
    leftLeg: s * legAmp,
    rightLeg: -s * legAmp,
    leftKnee: kneeBase + Math.max(0, -s) * (run ? 42 : 24),
    rightKnee: kneeBase + Math.max(0, s) * (run ? 42 : 24),
    leftArm: -s * armAmp,
    rightArm: s * armAmp,
    armLift: run ? 9 : 2,
  };
}

function LimbSegment({ joint, length, radius, material, swing, side, yaw, rootPitch = 0 }: {
  joint: Vec3;
  length: number;
  radius: number;
  material: string;
  swing: number;
  side: number;
  yaw: number;
  rootPitch?: number;
}) {
  const pose = segmentPose(joint, length, swing, side, yaw, rootPitch);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Cylinder}
      params={{ radius, height: length }}
      material={material}
      position={pose.center}
      rotation={pose.rotation}
    />
  );
}

function AnimatedFigure({ base, yaw, pose, hideHead = false }: { base: Vec3; yaw: number; pose: Pose; hideHead?: boolean }) {
  const origin = add(base, [0, pose.bodyY, 0]);
  const yawDeg = deg(yaw);
  const rootPitch = pose.rootPitch;
  const hipL = point(origin, [-0.16, 0.98, 0], yaw, rootPitch);
  const hipR = point(origin, [0.16, 0.98, 0], yaw, rootPitch);
  const shoulderL = point(origin, [-0.39, 1.52, 0], yaw, rootPitch);
  const shoulderR = point(origin, [0.39, 1.52, 0], yaw, rootPitch);

  const thighL = segmentPose(hipL, 0.48, pose.leftLeg, -2, yaw, rootPitch);
  const thighR = segmentPose(hipR, 0.48, pose.rightLeg, 2, yaw, rootPitch);
  const shinL = segmentPose(thighL.end, 0.48, pose.leftLeg - pose.leftKnee, -1, yaw, rootPitch);
  const shinR = segmentPose(thighR.end, 0.48, pose.rightLeg - pose.rightKnee, 1, yaw, rootPitch);
  const leftArmSwing = pose.leftArm;
  const rightArmSwing = pose.rightArm;
  const upperArmL = segmentPose(shoulderL, 0.36, leftArmSwing, -18 - pose.armLift, yaw, rootPitch);
  const upperArmR = segmentPose(shoulderR, 0.36, rightArmSwing, 18 + pose.armLift, yaw, rootPitch);
  const foreArmL = segmentPose(upperArmL.end, 0.34, leftArmSwing * 0.5 + 14, -16 - pose.armLift, yaw, rootPitch);
  const foreArmR = segmentPose(upperArmR.end, 0.34, rightArmSwing * 0.5 + 14, 16 + pose.armLift, yaw, rootPitch);

  return (
    <>
      <LimbSegment joint={hipL} length={0.48} radius={0.105} material={PANTS} swing={pose.leftLeg} side={-2} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={hipR} length={0.48} radius={0.105} material={PANTS} swing={pose.rightLeg} side={2} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={thighL.end} length={0.48} radius={0.095} material={PANTS} swing={pose.leftLeg - pose.leftKnee} side={-1} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={thighR.end} length={0.48} radius={0.095} material={PANTS} swing={pose.rightLeg - pose.rightKnee} side={1} yaw={yaw} rootPitch={rootPitch} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.155 }} material={SHOE} position={add(shinL.end, orient([0, -0.03, -0.09], yaw, rootPitch))} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.155 }} material={SHOE} position={add(shinR.end, orient([0, -0.03, -0.09], yaw, rootPitch))} />

      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.6, height: 0.72, depth: 0.34 }} material={SHIRT} position={point(origin, [0, 1.23, 0], yaw, rootPitch)} rotation={[pose.torsoLean + rootPitch, yawDeg, 0]} />
      <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.33, tube: 0.07 }} material={BELT} position={point(origin, [0, 0.9, 0], yaw, rootPitch)} rotation={[rootPitch, yawDeg, 0]} />

      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.13 }} material={SHIRT} position={shoulderL} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.13 }} material={SHIRT} position={shoulderR} />
      <LimbSegment joint={shoulderL} length={0.36} radius={0.088} material={SHIRT} swing={leftArmSwing} side={-18 - pose.armLift} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={shoulderR} length={0.36} radius={0.088} material={SHIRT} swing={rightArmSwing} side={18 + pose.armLift} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={upperArmL.end} length={0.34} radius={0.08} material={SHIRT} swing={leftArmSwing * 0.5 + 14} side={-16 - pose.armLift} yaw={yaw} rootPitch={rootPitch} />
      <LimbSegment joint={upperArmR.end} length={0.34} radius={0.08} material={SHIRT} swing={rightArmSwing * 0.5 + 14} side={16 + pose.armLift} yaw={yaw} rootPitch={rootPitch} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.1 }} material={SKIN} position={foreArmL.end} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.1 }} material={SKIN} position={foreArmR.end} />

      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.08, height: 0.12 }} material={SKIN} position={point(origin, [0, 1.64, 0], yaw, rootPitch)} rotation={[rootPitch, yawDeg, 0]} />
      {!hideHead ? (
        <>
          <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.2 }} material={SKIN} position={point(origin, [0, 1.84, 0], yaw, rootPitch)} rotation={[pose.headNod + rootPitch, yawDeg, 0]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06, height: 0.06, depth: 0.04 }} material={EYE} position={point(origin, [0.08, 1.88, -0.18], yaw, rootPitch)} rotation={[pose.headNod + rootPitch, yawDeg, 0]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06, height: 0.06, depth: 0.04 }} material={EYE} position={point(origin, [-0.08, 1.88, -0.18], yaw, rootPitch)} rotation={[pose.headNod + rootPitch, yawDeg, 0]} />
          <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.05, height: 0.13 }} material={NOSE} position={point(origin, [0, 1.82, -0.2], yaw, rootPitch)} rotation={[-90 + pose.headNod + rootPitch, yawDeg, 0]} />
          <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.23, height: 0.34 }} material={HAT} position={point(origin, [0, 2.12, 0], yaw, rootPitch)} rotation={[rootPitch, yawDeg, 0]} />
        </>
      ) : null}
    </>
  );
}

function Marker({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.08, height: 0.035 }} material={color} position={[x, 0.02, z]} />
      <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.26, tube: 0.012 }} material={color} position={[x, 0.04, z]} />
    </>
  );
}

function EmoteFx({ action, base, yaw, t }: { action: Action; base: Vec3; yaw: number; t: number }) {
  if (action === 'cry') {
    const drop = 0.05 + (t * 0.7) % 0.35;
    return (
      <>
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.035 }} material="#5dc8ff" position={point(base, [-0.09, 1.78 - drop, -0.23], yaw)} />
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.03 }} material="#5dc8ff" position={point(base, [0.09, 1.7 - ((drop + 0.13) % 0.35), -0.23], yaw)} />
      </>
    );
  }

  if (action === 'laugh') {
    const bob = Math.abs(Math.sin(t * 7.0));
    return (
      <>
        <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.22 + bob * 0.04, tube: 0.012 }} material="#ffe56d" position={point(base, [0, 2.18 + bob * 0.04, -0.05], yaw)} rotation={[90, deg(yaw), 0]} />
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.035 }} material="#ffe56d" position={point(base, [-0.32, 2.04, -0.08], yaw)} />
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.035 }} material="#ffe56d" position={point(base, [0.32, 2.04, -0.08], yaw)} />
      </>
    );
  }

  if (action === 'fart') {
    const puff = Math.max(0.04, (Math.sin(t * 5.0) + 1) * 0.08);
    return (
      <>
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: puff }} material="#7fd35b" position={point(base, [0.0, 0.82, 0.42], yaw)} />
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: puff * 0.72 }} material="#a2d75f" position={point(base, [0.2, 0.9, 0.58], yaw)} />
        <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: puff * 0.58 }} material="#5fab4d" position={point(base, [-0.22, 0.76, 0.62], yaw)} />
      </>
    );
  }

  if (action === 'point') {
    return <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.08, height: 0.32 }} material={ACCENT} position={point(base, [0.45, 1.15, -0.72], yaw)} rotation={[-90, deg(yaw), 0]} />;
  }

  return null;
}

export default function AnimationLab() {
  const [action, setAction] = useState<Action>('walk');
  const [cameraMode, setCameraMode] = useState<CameraMode>('third');
  const [frame, setFrame] = useState(0);

  const actionRef = useRef<Action>('walk');
  const sim = useRef({
    x: 0, z: 0,
    yaw: 0, visualYaw: Math.PI, pitch: 0.05, t: 0,
    jumpY: 0, jumpV: 0,
    moving: false, speed: 0, zigUs: 0,
  });
  const drag = useRef<{ x: number; y: number } | null>(null);

  actionRef.current = action;

  useEffect(() => {
    hostVoid('__input_bench_reset', 0, 0);
    hostVoid('__input_bench_set_enabled', true);

    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    let last = g.performance?.now?.() ?? Date.now();

    const tick = () => {
      const now = g.performance?.now?.() ?? Date.now();
      const dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000));
      last = now;

      const s = sim.current;
      s.t += dt;

      const drive = actionRef.current === 'drive';
      const shift = hostNumber('isKeyDown', 0, SCAN_LSHIFT) > 0 || hostNumber('isKeyDown', 0, SCAN_RSHIFT) > 0;
      const wantJump = hostNumber('isKeyDown', 0, SCAN_SPACE) > 0;

      if (drive) {
        hostVoid('__input_bench_set_yaw', s.yaw);
        hostVoid('__input_bench_set_speed', shift ? 6.4 : 2.8);
        const parts = hostString('__input_bench_pos', '0,0,0,0,0').split(',').map(Number);
        const [x, z, dx, dz, us] = parts;
        if (Number.isFinite(x)) s.x = x;
        if (Number.isFinite(z)) s.z = z;
        const ndx = Number(dx) || 0;
        const ndz = Number(dz) || 0;
        s.speed = Math.hypot(ndx, ndz) / dt;
        s.moving = s.speed > 0.05;
        if (s.moving) {
          const targetYaw = Math.atan2(-ndx, -ndz);
          s.visualYaw += angleDelta(s.visualYaw, targetYaw) * Math.min(1, dt * 14);
        }
        s.zigUs = Number.isFinite(us) ? us : 0;
        if (wantJump && s.jumpY <= 0.001) s.jumpV = JUMP_SPEED;
      } else {
        const active = actionRef.current;
        const autoSpeed = active === 'run' ? 2.2 : active === 'walk' ? 0.9 : 0;
        if (active === 'walk' || active === 'run' || active === 'jump') {
          s.x = Math.sin(s.t * 0.22) * 1.25;
          s.z = Math.cos(s.t * 0.22) * 0.5;
        }
        s.speed = autoSpeed;
        s.moving = active === 'walk' || active === 'run';
        if (active === 'walk' || active === 'run' || active === 'jump') s.visualYaw = s.yaw + Math.PI;
        s.zigUs = 0;
      }

      if (s.jumpV !== 0 || s.jumpY > 0) {
        s.jumpV -= GRAVITY * dt;
        s.jumpY += s.jumpV * dt;
        if (s.jumpY <= 0) {
          s.jumpY = 0;
          s.jumpV = 0;
        }
      }

      setFrame((n) => (n + 1) & 0xffffff);
      handle = sched(tick);
    };

    handle = sched(tick);
    return () => {
      cancel(handle);
      hostVoid('__input_bench_set_enabled', false);
    };
  }, []);

  const s = sim.current;
  const warmupElapsed = Math.min(WARMUP_SECONDS, s.t);
  const warmupRemaining = Math.max(0, WARMUP_SECONDS - s.t);
  const showWarmup = s.t <= WARMUP_SECONDS + WARMUP_END_HOLD_SECONDS;
  const warmupActive = s.t < WARMUP_SECONDS;
  const poseAction: Action = action === 'drive' && s.moving ? (s.speed > 4 ? 'run' : 'walk') : action;
  const activePose = poseFor(poseAction, s.t, s.moving, action === 'drive' ? s.jumpY : 0);
  const playerYaw = action === 'drive' ? s.visualYaw : s.yaw + Math.PI;
  const firstPerson = cameraMode === 'first';
  const camPos: Vec3 = firstPerson
    ? point([s.x, 0, s.z], [0, 1.76 + s.jumpY, 0.05], s.yaw)
    : [s.x - Math.sin(s.yaw) * 4.9, 3.05 + s.jumpY * 0.35, s.z - Math.cos(s.yaw) * 5.9];
  const camTarget: Vec3 = firstPerson
    ? [s.x + Math.sin(s.yaw) * 4, 1.58 + Math.sin(s.pitch) * 2.0 + s.jumpY, s.z + Math.cos(s.yaw) * 4]
    : [s.x, 1.18 + s.jumpY * 0.45, s.z];

  const onDown = (e: any) => { drag.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = drag.current;
    if (!d) return;
    const x = Number(e?.x ?? d.x);
    const y = Number(e?.y ?? d.y);
    sim.current.yaw -= (x - d.x) * 0.008;
    sim.current.pitch = clamp(sim.current.pitch + (y - d.y) * 0.006, -0.65, 0.85);
    d.x = x;
    d.y = y;
  };
  const onUp = () => { drag.current = null; };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PAGE, flexDirection: 'column' }}>
      <Col style={{ backgroundColor: BAR, borderBottomWidth: 1, borderBottomColor: FRAME, padding: 12, gap: 8 }}>
        <Row style={{ gap: 10, alignItems: 'baseline' }}>
          <Text style={{ fontSize: 15, color: INK, fontWeight: 'bold' }}>ANIMATION LAB</Text>
          <Text style={{ fontSize: 11, color: DIM }}>camera_lab humanoid - mesh-part pose cycles - Zig WASD drive mode</Text>
        </Row>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {ACTIONS.map((entry) => {
            const name = entry.id;
            const on = action === name;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  setAction(name);
                  if (name === 'drive') {
                    sim.current.jumpY = 0;
                    sim.current.jumpV = 0;
                    hostVoid('__input_bench_reset', sim.current.x, sim.current.z);
                  }
                }}
                style={{
                  paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
                  borderRadius: 6, borderWidth: 1,
                  borderColor: on ? ACCENT : FRAME,
                  backgroundColor: on ? '#2c2112' : entry.group === 'emote' ? '#151f24' : '#151b29',
                }}
              >
                <Text style={{ fontSize: 12, color: on ? ACCENT : INK, fontWeight: on ? 'bold' : 'normal' }}>{entry.label}</Text>
              </Pressable>
            );
          })}
          <Box style={{ width: 12 }} />
          <Pressable
            onPress={() => setCameraMode((m) => (m === 'third' ? 'first' : 'third'))}
            style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12, borderRadius: 6, borderWidth: 1, borderColor: '#3fc4c0', backgroundColor: '#102322' }}
          >
            <Text style={{ fontSize: 12, color: '#59d8d2' }}>{cameraMode === 'third' ? 'third person' : 'first person'}</Text>
          </Pressable>
          <Text style={{ fontSize: 11, color: DIM }}>
            {action === 'drive' ? `WASD via Zig - Shift run - Space jump - drag aim - Zig ${s.zigUs.toFixed(2)}us` : `preview ${action} - drag to turn the camera`}
          </Text>
        </Row>
      </Col>

      <Pressable
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={SCENE_BG} showGrid={false} showAxes={false}>
          <Scene3D.Camera position={camPos} target={camTarget} fov={firstPerson ? 76 : 54} />
          <Scene3D.AmbientLight color="#66708f" intensity={0.7} />
          <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.42]} color="#ffe2b4" intensity={0.9} />
          <Scene3D.PointLight position={[5, 5, 5]} color="#ff5fae" intensity={0.45} />
          <Scene3D.PointLight position={[-6, 4, -4]} color="#4ddaff" intensity={0.35} />

          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 32, height: 0.16, depth: 32 }} material="#222a40" position={[0, -0.08, 0]} />
          {[-6, -3, 0, 3, 6].map((x) => <Scene3D.Mesh key={`gx-${x}`} geometry={Geometry.Box} params={{ width: 0.035, height: 0.018, depth: 14 }} material="#303a54" position={[x, 0.012, 0]} />)}
          {[-6, -3, 0, 3, 6].map((z) => <Scene3D.Mesh key={`gz-${z}`} geometry={Geometry.Box} params={{ width: 14, height: 0.018, depth: 0.035 }} material="#303a54" position={[0, 0.014, z]} />)}
          <Marker x={s.x} z={s.z} color={ACCENT} />

          <AnimatedFigure base={[s.x, 0, s.z]} yaw={playerYaw} pose={activePose} hideHead={firstPerson && action === 'drive'} />
          <EmoteFx action={action} base={[s.x, action === 'drive' ? s.jumpY : 0, s.z]} yaw={playerYaw} t={s.t} />

          <AnimatedFigure base={[-4.5, 0, -3.8]} yaw={0.2} pose={poseFor('walk', s.t, true, 0)} />
          <AnimatedFigure base={[-2.8, 0, -3.8]} yaw={0.2} pose={poseFor('run', s.t, true, 0)} />
          <AnimatedFigure base={[-1.1, 0, -3.8]} yaw={0.2} pose={poseFor('jump', s.t, false, 0)} />
          <AnimatedFigure base={[0.8, 0, -3.8]} yaw={0.2} pose={poseFor('sit', s.t, false, 0)} />
          <AnimatedFigure base={[2.8, 0, -3.8]} yaw={0.2} pose={poseFor('sleep', s.t, false, 0)} />
        </Scene3D>

        <Row style={{ position: 'absolute', left: 18, bottom: 16, gap: 14 }}>
          <Text style={{ fontSize: 11, color: '#b3bdd2' }}>preview lane: walk</Text>
          <Text style={{ fontSize: 11, color: '#b3bdd2' }}>run</Text>
          <Text style={{ fontSize: 11, color: '#b3bdd2' }}>jump</Text>
          <Text style={{ fontSize: 11, color: '#b3bdd2' }}>sit</Text>
          <Text style={{ fontSize: 11, color: '#b3bdd2' }}>sleep</Text>
          <Text style={{ fontSize: 11, color: '#7fceb5' }}>emotes retained for wheel</Text>
          <Text style={{ fontSize: 11, color: '#6f7b93' }}>frame {frame}</Text>
        </Row>

        {showWarmup ? (
          <Col style={{
            position: 'absolute',
            right: 18,
            bottom: 16,
            gap: 4,
            paddingTop: 10,
            paddingBottom: 10,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: warmupActive ? ACCENT : '#3fc4c0',
            backgroundColor: warmupActive ? '#241a0d' : '#0e2422',
          }}>
            <Text style={{ fontSize: 12, color: warmupActive ? ACCENT : '#59d8d2', fontWeight: 'bold' }}>
              {warmupActive ? 'WARM UP ACTIVE' : 'WARM UP ENDED'}
            </Text>
            <Text style={{ fontSize: 11, color: '#c3cad8' }}>
              {warmupActive
                ? `${warmupElapsed.toFixed(1)}s elapsed - ${warmupRemaining.toFixed(1)}s left`
                : `ended at ${WARMUP_SECONDS.toFixed(1)}s`}
            </Text>
          </Col>
        ) : null}
      </Pressable>
    </Box>
  );
}
