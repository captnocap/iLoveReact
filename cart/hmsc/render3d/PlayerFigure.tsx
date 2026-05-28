import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Vec3 } from '../design';

type Vec3Tuple = [number, number, number];

type PlayerPose = {
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

const SKIN = '#caa07a';
const SHIRT = '#c23b8e';
const PANTS = '#272238';
const SHOE = '#15121f';
const HAT = '#e8c14a';
const EYE = '#0a0a12';
const BELT = '#2b2638';
const NOSE = '#b8906a';

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function degrees(radiansValue: number): number {
  return radiansValue * 180 / Math.PI;
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotateY(v: Vec3Tuple, yawRadians: number): Vec3Tuple {
  const c = Math.cos(yawRadians);
  const s = Math.sin(yawRadians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateX(v: Vec3Tuple, pitchRadians: number): Vec3Tuple {
  const c = Math.cos(pitchRadians);
  const s = Math.sin(pitchRadians);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function orient(v: Vec3Tuple, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  return rotateY(rotateX(v, radians(rootPitchDegrees)), yawRadians);
}

function point(base: Vec3Tuple, local: Vec3Tuple, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  return add(base, orient(local, yawRadians, rootPitchDegrees));
}

function downDirection(swingDegrees: number, sideDegrees: number, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  const swingRadians = radians(swingDegrees);
  const sideRadians = radians(sideDegrees);
  return orient([
    Math.sin(sideRadians),
    -Math.cos(sideRadians) * Math.cos(swingRadians),
    -Math.cos(sideRadians) * Math.sin(swingRadians),
  ], yawRadians, rootPitchDegrees);
}

function segmentPose(joint: Vec3Tuple, length: number, swingDegrees: number, sideDegrees: number, yawRadians: number, rootPitchDegrees = 0) {
  const d = downDirection(swingDegrees, sideDegrees, yawRadians, rootPitchDegrees);
  return {
    center: add(joint, [d[0] * length * 0.5, d[1] * length * 0.5, d[2] * length * 0.5] as Vec3Tuple),
    end: add(joint, [d[0] * length, d[1] * length, d[2] * length] as Vec3Tuple),
    rotation: [swingDegrees + rootPitchDegrees, degrees(yawRadians), sideDegrees] as Vec3Tuple,
  };
}

function drivePose(animationSeconds: number, moving: boolean, running: boolean): PlayerPose {
  if (!moving) {
    return {
      rootPitch: 0,
      bodyY: 0,
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

  const phase = animationSeconds * (running ? 8.6 : 5.0);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const legAmp = running ? 52 : 30;
  const armAmp = running ? 60 : 34;
  const kneeBase = running ? 14 : 8;
  return {
    rootPitch: 0,
    bodyY: Math.abs(c) * (running ? 0.085 : 0.035),
    torsoLean: running ? -9 : -3,
    headNod: -Math.abs(c) * (running ? 5 : 2),
    leftLeg: s * legAmp,
    rightLeg: -s * legAmp,
    leftKnee: kneeBase + Math.max(0, -s) * (running ? 42 : 24),
    rightKnee: kneeBase + Math.max(0, s) * (running ? 42 : 24),
    leftArm: -s * armAmp,
    rightArm: s * armAmp,
    armLift: running ? 9 : 2,
  };
}

function LimbSegment(props: {
  joint: Vec3Tuple;
  length: number;
  radius: number;
  material: string;
  swing: number;
  side: number;
  yawRadians: number;
  rootPitch?: number;
}) {
  const pose = segmentPose(props.joint, props.length, props.swing, props.side, props.yawRadians, props.rootPitch ?? 0);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Cylinder}
      params={{ radius: props.radius, height: props.length, segments: 12 }}
      material={props.material}
      position={pose.center}
      rotation={pose.rotation}
    />
  );
}

export function PlayerFigure(props: { position: Vec3; yawDegrees: number; animationSeconds: number; moving: boolean; running: boolean }) {
  const pose = drivePose(props.animationSeconds, props.moving, props.running);
  const base: Vec3Tuple = [props.position.x, props.position.y, props.position.z];
  const yawRadians = radians(props.yawDegrees);
  const yawDegrees = props.yawDegrees;
  const origin = add(base, [0, pose.bodyY, 0]);
  const rootPitch = pose.rootPitch;
  const hipL = point(origin, [-0.16, 0.98, 0], yawRadians, rootPitch);
  const hipR = point(origin, [0.16, 0.98, 0], yawRadians, rootPitch);
  const shoulderL = point(origin, [-0.39, 1.52, 0], yawRadians, rootPitch);
  const shoulderR = point(origin, [0.39, 1.52, 0], yawRadians, rootPitch);

  const thighL = segmentPose(hipL, 0.48, pose.leftLeg, -2, yawRadians, rootPitch);
  const thighR = segmentPose(hipR, 0.48, pose.rightLeg, 2, yawRadians, rootPitch);
  const shinL = segmentPose(thighL.end, 0.48, pose.leftLeg - pose.leftKnee, -1, yawRadians, rootPitch);
  const shinR = segmentPose(thighR.end, 0.48, pose.rightLeg - pose.rightKnee, 1, yawRadians, rootPitch);
  const upperArmL = segmentPose(shoulderL, 0.36, pose.leftArm, -18 - pose.armLift, yawRadians, rootPitch);
  const upperArmR = segmentPose(shoulderR, 0.36, pose.rightArm, 18 + pose.armLift, yawRadians, rootPitch);
  const foreArmL = segmentPose(upperArmL.end, 0.34, pose.leftArm * 0.5 + 14, -16 - pose.armLift, yawRadians, rootPitch);
  const foreArmR = segmentPose(upperArmR.end, 0.34, pose.rightArm * 0.5 + 14, 16 + pose.armLift, yawRadians, rootPitch);

  return (
    <>
      <LimbSegment joint={hipL} length={0.48} radius={0.105} material={PANTS} swing={pose.leftLeg} side={-2} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={hipR} length={0.48} radius={0.105} material={PANTS} swing={pose.rightLeg} side={2} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={thighL.end} length={0.48} radius={0.095} material={PANTS} swing={pose.leftLeg - pose.leftKnee} side={-1} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={thighR.end} length={0.48} radius={0.095} material={PANTS} swing={pose.rightLeg - pose.rightKnee} side={1} yawRadians={yawRadians} rootPitch={rootPitch} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.155, segments: 12, rings: 8 }} material={SHOE} position={add(shinL.end, orient([0, -0.03, -0.09], yawRadians, rootPitch))} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.155, segments: 12, rings: 8 }} material={SHOE} position={add(shinR.end, orient([0, -0.03, -0.09], yawRadians, rootPitch))} />

      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.6, height: 0.72, depth: 0.34 }} material={SHIRT} position={point(origin, [0, 1.23, 0], yawRadians, rootPitch)} rotation={[pose.torsoLean + rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.33, tube: 0.07, segments: 16, sides: 8 }} material={BELT} position={point(origin, [0, 0.9, 0], yawRadians, rootPitch)} rotation={[rootPitch, yawDegrees, 0]} />

      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.13, segments: 12, rings: 8 }} material={SHIRT} position={shoulderL} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.13, segments: 12, rings: 8 }} material={SHIRT} position={shoulderR} />
      <LimbSegment joint={shoulderL} length={0.36} radius={0.088} material={SHIRT} swing={pose.leftArm} side={-18 - pose.armLift} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={shoulderR} length={0.36} radius={0.088} material={SHIRT} swing={pose.rightArm} side={18 + pose.armLift} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={upperArmL.end} length={0.34} radius={0.08} material={SHIRT} swing={pose.leftArm * 0.5 + 14} side={-16 - pose.armLift} yawRadians={yawRadians} rootPitch={rootPitch} />
      <LimbSegment joint={upperArmR.end} length={0.34} radius={0.08} material={SHIRT} swing={pose.rightArm * 0.5 + 14} side={16 + pose.armLift} yawRadians={yawRadians} rootPitch={rootPitch} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.1, segments: 12, rings: 8 }} material={SKIN} position={foreArmL.end} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.1, segments: 12, rings: 8 }} material={SKIN} position={foreArmR.end} />

      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.08, height: 0.12, segments: 12 }} material={SKIN} position={point(origin, [0, 1.64, 0], yawRadians, rootPitch)} rotation={[rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.2, segments: 16, rings: 10 }} material={SKIN} position={point(origin, [0, 1.84, 0], yawRadians, rootPitch)} rotation={[pose.headNod + rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06, height: 0.06, depth: 0.04 }} material={EYE} position={point(origin, [0.08, 1.88, -0.18], yawRadians, rootPitch)} rotation={[pose.headNod + rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06, height: 0.06, depth: 0.04 }} material={EYE} position={point(origin, [-0.08, 1.88, -0.18], yawRadians, rootPitch)} rotation={[pose.headNod + rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.05, height: 0.13, segments: 12 }} material={NOSE} position={point(origin, [0, 1.82, -0.2], yawRadians, rootPitch)} rotation={[-90 + pose.headNod + rootPitch, yawDegrees, 0]} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.23, height: 0.34, segments: 16 }} material={HAT} position={point(origin, [0, 2.12, 0], yawRadians, rootPitch)} rotation={[rootPitch, yawDegrees, 0]} />
    </>
  );
}
