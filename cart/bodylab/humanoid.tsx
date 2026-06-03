// Parametric humanoid skeleton inspired by the HMSC player model.
// The same gait and limb math, but every proportion is configurable so one
// solver can emit classic male, classic female, athletic, heavyset, slender,
// stocky — or anything in between.

import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';

export type Vec3Tuple = [number, number, number];
export type GeometryDef = typeof Geometry.Box;

export type MaterialSlot =
  | 'skin'
  | 'shirt'
  | 'pants'
  | 'shoe'
  | 'hat'
  | 'hair'
  | 'eye'
  | 'belt'
  | 'nose'
  | 'marker'
  | 'accent'
  | 'metal'
  | 'trim';

export type RigPart = {
  geometry: GeometryDef;
  params: Record<string, number>;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  slot: MaterialSlot;
};

type RequiredPaletteSlot =
  | 'skin'
  | 'shirt'
  | 'pants'
  | 'shoe'
  | 'hat'
  | 'eye'
  | 'belt'
  | 'nose'
  | 'marker';

export type HumanoidPalette = Record<RequiredPaletteSlot, string> &
  Partial<Record<Exclude<MaterialSlot, RequiredPaletteSlot>, string>>;

export type HumanoidPose = {
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

export type HeadStyle =
  | 'cone'
  | 'hair'
  | 'none'
  | 'visor'
  | 'helmet'
  | 'mohawk'
  | 'braid'
  | 'goggles'
  | 'beard';

export type CharacterModelStyle =
  | 'none'
  | 'workdayDad'
  | 'officeCommuter'
  | 'bikeCourier'
  | 'studioTeacher'
  | 'marketVendor'
  | 'gradStudent';

export type BodyProportions = {
  hipHalfWidth: number;
  legHalfWidth?: number;
  hipHeight: number;
  shoulderHalfWidth: number;
  shoulderHeight: number;
  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;
  thighLength: number;
  shinLength: number;
  upperArmLength: number;
  foreArmLength: number;
  neckHeight: number;
  headCenterHeight: number;
  headRadius: number;
  hatHeight: number;
  limbRadiusMul: number;
  jointRadiusMul: number;
  footRadius: number;
  headStyle: HeadStyle;
  chestRadius: number;
  buttRadius: number;
  modelStyle?: CharacterModelStyle;
  waistWidth?: number;
  waistDepth?: number;
};

export const DEFAULT_PROPORTIONS: BodyProportions = {
  hipHalfWidth: 0.16,
  legHalfWidth: undefined,
  hipHeight: 0.98,
  shoulderHalfWidth: 0.39,
  shoulderHeight: 1.52,
  torsoWidth: 0.6,
  torsoHeight: 0.72,
  torsoDepth: 0.34,
  thighLength: 0.48,
  shinLength: 0.48,
  upperArmLength: 0.36,
  foreArmLength: 0.34,
  neckHeight: 1.64,
  headCenterHeight: 1.84,
  headRadius: 0.2,
  hatHeight: 2.12,
  limbRadiusMul: 1.0,
  jointRadiusMul: 1.0,
  footRadius: 0.155,
  headStyle: 'cone',
  chestRadius: 0,
  buttRadius: 0,
  modelStyle: 'none',
  waistWidth: 0,
  waistDepth: 0,
};

// ── math helpers ─────────────────────────────────────────────────────────────

function radians(d: number) {
  return d * Math.PI / 180;
}

function degrees(r: number) {
  return r * 180 / Math.PI;
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotateY(v: Vec3Tuple, yr: number): Vec3Tuple {
  const c = Math.cos(yr);
  const s = Math.sin(yr);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateX(v: Vec3Tuple, xr: number): Vec3Tuple {
  const c = Math.cos(xr);
  const s = Math.sin(xr);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function orient(v: Vec3Tuple, yr: number, rootPitch = 0): Vec3Tuple {
  return rotateY(rotateX(v, radians(rootPitch)), yr);
}

function point(base: Vec3Tuple, local: Vec3Tuple, yr: number, rootPitch = 0): Vec3Tuple {
  return add(base, orient(local, yr, rootPitch));
}

function downDirection(
  swingDeg: number,
  sideDeg: number,
  yr: number,
  rootPitch = 0
): Vec3Tuple {
  const sr = radians(swingDeg);
  const sider = radians(sideDeg);
  return orient(
    [Math.sin(sider), -Math.cos(sider) * Math.cos(sr), -Math.cos(sider) * Math.sin(sr)],
    yr,
    rootPitch
  );
}

type Segment = { center: Vec3Tuple; end: Vec3Tuple; rotation: Vec3Tuple };

function segmentPose(
  joint: Vec3Tuple,
  length: number,
  swingDeg: number,
  sideDeg: number,
  yr: number,
  rootPitch = 0
): Segment {
  const d = downDirection(swingDeg, sideDeg, yr, rootPitch);
  return {
    center: add(joint, [d[0] * length * 0.5, d[1] * length * 0.5, d[2] * length * 0.5]),
    end: add(joint, [d[0] * length, d[1] * length, d[2] * length]),
    rotation: [swingDeg + rootPitch, degrees(yr), sideDeg],
  };
}

function limbPart(seg: Segment, length: number, radius: number, slot: MaterialSlot): RigPart {
  return {
    geometry: Geometry.Cylinder,
    params: { radius, height: length, segments: 12 },
    position: seg.center,
    rotation: seg.rotation,
    slot,
  };
}

// ── pose driver (same gait as HMSC) ──────────────────────────────────────────

export function drivePose(
  animationSeconds: number,
  moving: boolean,
  running: boolean
): HumanoidPose {
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

// ── parametric solver ────────────────────────────────────────────────────────

export function solveHumanoid(
  base: Vec3Tuple,
  yawDegrees: number,
  pose: HumanoidPose,
  prop: BodyProportions
): { parts: RigPart[]; eye: Vec3Tuple } {
  const yawRadians = radians(yawDegrees);
  const origin = add(base, [0, pose.bodyY, 0]);
  const rootPitch = pose.rootPitch;
  const legHalfWidth = prop.legHalfWidth ?? prop.hipHalfWidth;

  const hipL = point(origin, [-legHalfWidth, prop.hipHeight, 0], yawRadians, rootPitch);
  const hipR = point(origin, [legHalfWidth, prop.hipHeight, 0], yawRadians, rootPitch);
  const shoulderL = point(
    origin,
    [-prop.shoulderHalfWidth, prop.shoulderHeight, 0],
    yawRadians,
    rootPitch
  );
  const shoulderR = point(
    origin,
    [prop.shoulderHalfWidth, prop.shoulderHeight, 0],
    yawRadians,
    rootPitch
  );

  const thighL = segmentPose(hipL, prop.thighLength, pose.leftLeg, -2, yawRadians, rootPitch);
  const thighR = segmentPose(hipR, prop.thighLength, pose.rightLeg, 2, yawRadians, rootPitch);
  const shinL = segmentPose(
    thighL.end,
    prop.shinLength,
    pose.leftLeg - pose.leftKnee,
    -1,
    yawRadians,
    rootPitch
  );
  const shinR = segmentPose(
    thighR.end,
    prop.shinLength,
    pose.rightLeg - pose.rightKnee,
    1,
    yawRadians,
    rootPitch
  );
  const upperArmL = segmentPose(
    shoulderL,
    prop.upperArmLength,
    pose.leftArm,
    -18 - pose.armLift,
    yawRadians,
    rootPitch
  );
  const upperArmR = segmentPose(
    shoulderR,
    prop.upperArmLength,
    pose.rightArm,
    18 + pose.armLift,
    yawRadians,
    rootPitch
  );
  const foreArmL = segmentPose(
    upperArmL.end,
    prop.foreArmLength,
    pose.leftArm * 0.5 + 14,
    -16 - pose.armLift,
    yawRadians,
    rootPitch
  );
  const foreArmR = segmentPose(
    upperArmR.end,
    prop.foreArmLength,
    pose.rightArm * 0.5 + 14,
    16 + pose.armLift,
    yawRadians,
    rootPitch
  );

  const footL = add(shinL.end, orient([0, -0.03, -0.09], yawRadians, rootPitch));
  const footR = add(shinR.end, orient([0, -0.03, -0.09], yawRadians, rootPitch));
  const neck = point(origin, [0, prop.neckHeight, 0], yawRadians, rootPitch);
  const head = point(origin, [0, prop.headCenterHeight, 0], yawRadians, rootPitch);

  const headRotation: Vec3Tuple = [pose.headNod + rootPitch, yawDegrees, 0];
  const uprightRotation: Vec3Tuple = [rootPitch, yawDegrees, 0];

  const lr = prop.limbRadiusMul;
  const jr = prop.jointRadiusMul;
  const torsoCenterY = (prop.hipHeight + prop.shoulderHeight) / 2;
  const waistWidth = prop.waistWidth ?? 0;
  const waistDepth = prop.waistDepth ?? prop.torsoDepth * 0.85;
  const actualHeadRadius = prop.headRadius * jr;
  const eyeX = actualHeadRadius * 0.4;
  const eyeZ = -actualHeadRadius * 0.9;
  const eyeSize = actualHeadRadius * 0.3;
  const noseZ = -actualHeadRadius;
  const noseH = actualHeadRadius * 0.65;
  const noseR = actualHeadRadius * 0.25;

  const parts: RigPart[] = [
    // legs
    limbPart(
      segmentPose(hipL, prop.thighLength, pose.leftLeg, -2, yawRadians, rootPitch),
      prop.thighLength,
      0.105 * lr,
      'pants'
    ),
    limbPart(
      segmentPose(hipR, prop.thighLength, pose.rightLeg, 2, yawRadians, rootPitch),
      prop.thighLength,
      0.105 * lr,
      'pants'
    ),
    limbPart(
      segmentPose(thighL.end, prop.shinLength, pose.leftLeg - pose.leftKnee, -1, yawRadians, rootPitch),
      prop.shinLength,
      0.095 * lr,
      'pants'
    ),
    limbPart(
      segmentPose(thighR.end, prop.shinLength, pose.rightLeg - pose.rightKnee, 1, yawRadians, rootPitch),
      prop.shinLength,
      0.095 * lr,
      'pants'
    ),
    {
      geometry: Geometry.Sphere,
      params: { radius: prop.footRadius * jr, segments: 12, rings: 8 },
      position: footL,
      slot: 'shoe',
    },
    {
      geometry: Geometry.Sphere,
      params: { radius: prop.footRadius * jr, segments: 12, rings: 8 },
      position: footR,
      slot: 'shoe',
    },

    // Rear hip volume. A single soft block reads as clothing shape without
    // creating a visible center split from the back camera angle.
    ...(prop.buttRadius > 0
      ? [
          {
            geometry: Geometry.Box,
            params: {
              width: Math.max(prop.hipHalfWidth * 1.45, prop.buttRadius * 2.0) * jr,
              height: prop.buttRadius * 1.15 * jr,
              depth: prop.buttRadius * 1.35 * jr,
            },
            position: point(
              origin,
              [0, prop.hipHeight + prop.buttRadius * 0.25, prop.torsoDepth * 0.45],
              yawRadians,
              rootPitch
            ),
            slot: 'pants' as MaterialSlot,
          },
        ]
      : []),

    // torso
    {
      geometry: Geometry.Box,
      params: { width: prop.torsoWidth, height: prop.torsoHeight, depth: prop.torsoDepth },
      position: point(origin, [0, torsoCenterY, 0], yawRadians, rootPitch),
      rotation: [pose.torsoLean + rootPitch, yawDegrees, 0],
      slot: 'shirt',
    },
    ...(waistWidth > 0
      ? [
          {
            geometry: Geometry.Box,
            params: { width: waistWidth, height: prop.torsoHeight * 0.38, depth: waistDepth },
            position: point(
              origin,
              [0, prop.hipHeight + prop.torsoHeight * 0.28, -prop.torsoDepth * 0.03],
              yawRadians,
              rootPitch
            ),
            rotation: [pose.torsoLean + rootPitch, yawDegrees, 0],
            slot: 'belt' as MaterialSlot,
          },
        ]
      : []),

    // chest — only when proportions ask for it (females)
    ...(prop.chestRadius > 0
      ? [
          {
            geometry: Geometry.Sphere,
            params: { radius: prop.chestRadius * jr, segments: 10, rings: 8 },
            position: point(
              origin,
              [-prop.shoulderHalfWidth * 0.35, prop.shoulderHeight - prop.torsoHeight * 0.22, -prop.torsoDepth * 0.38],
              yawRadians,
              rootPitch
            ),
            slot: 'shirt' as MaterialSlot,
          },
          {
            geometry: Geometry.Sphere,
            params: { radius: prop.chestRadius * jr, segments: 10, rings: 8 },
            position: point(
              origin,
              [prop.shoulderHalfWidth * 0.35, prop.shoulderHeight - prop.torsoHeight * 0.22, -prop.torsoDepth * 0.38],
              yawRadians,
              rootPitch
            ),
            slot: 'shirt' as MaterialSlot,
          },
        ]
      : []),

    // arms
    {
      geometry: Geometry.Sphere,
      params: { radius: 0.13 * jr, segments: 12, rings: 8 },
      position: shoulderL,
      slot: 'shirt',
    },
    {
      geometry: Geometry.Sphere,
      params: { radius: 0.13 * jr, segments: 12, rings: 8 },
      position: shoulderR,
      slot: 'shirt',
    },
    limbPart(upperArmL, prop.upperArmLength, 0.088 * lr, 'shirt'),
    limbPart(upperArmR, prop.upperArmLength, 0.088 * lr, 'shirt'),
    limbPart(foreArmL, prop.foreArmLength, 0.08 * lr, 'shirt'),
    limbPart(foreArmR, prop.foreArmLength, 0.08 * lr, 'shirt'),
    {
      geometry: Geometry.Sphere,
      params: { radius: 0.1 * jr, segments: 12, rings: 8 },
      position: foreArmL.end,
      slot: 'skin',
    },
    {
      geometry: Geometry.Sphere,
      params: { radius: 0.1 * jr, segments: 12, rings: 8 },
      position: foreArmR.end,
      slot: 'skin',
    },

    // head
    {
      geometry: Geometry.Cylinder,
      params: { radius: actualHeadRadius * 0.4, height: actualHeadRadius * 0.6, segments: 12 },
      position: neck,
      rotation: uprightRotation,
      slot: 'skin',
    },
    {
      geometry: Geometry.Sphere,
      params: { radius: actualHeadRadius, segments: 16, rings: 10 },
      position: head,
      rotation: headRotation,
      slot: 'skin',
    },
    {
      geometry: Geometry.Box,
      params: { width: eyeSize, height: eyeSize, depth: eyeSize * 0.7 },
      position: point(
        origin,
        [eyeX, prop.headCenterHeight + actualHeadRadius * 0.2, eyeZ],
        yawRadians,
        rootPitch
      ),
      rotation: headRotation,
      slot: 'eye',
    },
    {
      geometry: Geometry.Box,
      params: { width: eyeSize, height: eyeSize, depth: eyeSize * 0.7 },
      position: point(
        origin,
        [-eyeX, prop.headCenterHeight + actualHeadRadius * 0.2, eyeZ],
        yawRadians,
        rootPitch
      ),
      rotation: headRotation,
      slot: 'eye',
    },
    {
      geometry: Geometry.Cone,
      params: { radius: noseR, height: noseH, segments: 12 },
      position: point(
        origin,
        [0, prop.headCenterHeight - actualHeadRadius * 0.1, noseZ],
        yawRadians,
        rootPitch
      ),
      rotation: [-90 + pose.headNod + rootPitch, yawDegrees, 0],
      slot: 'nose',
    },
  ];

  // head top — simple primitive clusters that make each face readable in profile.
  if (prop.headStyle === 'cone') {
    parts.push({
      geometry: Geometry.Cone,
      params: { radius: 0.23 * jr, height: 0.34 * jr, segments: 16 },
      position: point(origin, [0, prop.hatHeight, 0], yawRadians, rootPitch),
      rotation: uprightRotation,
      slot: 'hat',
    });
  } else if (prop.headStyle === 'hair') {
    const hairRadius = prop.headRadius * 1.15 * jr;
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: hairRadius, segments: 14, rings: 10 },
      position: point(
        origin,
        [0, prop.headCenterHeight + prop.headRadius * 0.55, -prop.headRadius * 0.08],
        yawRadians,
        rootPitch
      ),
      slot: 'hair',
    });
  } else if (prop.headStyle === 'mohawk') {
    const spikeCount = 4;
    for (let i = 0; i < spikeCount; i++) {
      parts.push({
        geometry: Geometry.Cone,
        params: { radius: actualHeadRadius * 0.22, height: actualHeadRadius * 0.72, segments: 8 },
        position: point(
          origin,
          [0, prop.headCenterHeight + actualHeadRadius * (0.58 + i * 0.05), -actualHeadRadius * (0.45 - i * 0.3)],
          yawRadians,
          rootPitch
        ),
        rotation: [rootPitch, yawDegrees, 0],
        slot: 'hair',
      });
    }
  } else if (prop.headStyle === 'braid') {
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: prop.headRadius * 1.08 * jr, segments: 14, rings: 10 },
      position: point(origin, [0, prop.headCenterHeight + prop.headRadius * 0.44, 0], yawRadians, rootPitch),
      slot: 'hair',
    });
    for (let i = 0; i < 4; i++) {
      parts.push({
        geometry: Geometry.Sphere,
        params: { radius: prop.headRadius * (0.38 - i * 0.045) * jr, segments: 10, rings: 8 },
        position: point(
          origin,
          [0, prop.headCenterHeight - prop.headRadius * (0.15 + i * 0.46), prop.headRadius * 0.95],
          yawRadians,
          rootPitch
        ),
        slot: 'hair',
      });
    }
  } else if (prop.headStyle === 'goggles') {
    const hairRadius = prop.headRadius * 1.05 * jr;
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: hairRadius, segments: 14, rings: 10 },
      position: point(origin, [0, prop.headCenterHeight + prop.headRadius * 0.34, 0.02], yawRadians, rootPitch),
      slot: 'hair',
    });
    parts.push({
      geometry: Geometry.Torus,
      params: { radius: actualHeadRadius * 0.55, tube: actualHeadRadius * 0.055, segments: 20, sides: 6 },
      position: point(origin, [0, prop.headCenterHeight + actualHeadRadius * 0.2, eyeZ], yawRadians, rootPitch),
      rotation: [90 + pose.headNod + rootPitch, yawDegrees, 0],
      slot: 'metal',
    });
  } else if (prop.headStyle === 'beard') {
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: prop.headRadius * 1.05 * jr, segments: 14, rings: 10 },
      position: point(origin, [0, prop.headCenterHeight + prop.headRadius * 0.42, 0.02], yawRadians, rootPitch),
      slot: 'hair',
    });
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: prop.headRadius * 0.58 * jr, segments: 12, rings: 8 },
      position: point(origin, [0, prop.headCenterHeight - actualHeadRadius * 0.42, eyeZ * 0.8], yawRadians, rootPitch),
      slot: 'hair',
    });
  } else if (prop.headStyle === 'visor') {
    parts.push({
      geometry: Geometry.Box,
      params: {
        width: prop.headRadius * 2.0 * jr,
        height: prop.headRadius * 0.5 * jr,
        depth: prop.headRadius * 0.18 * jr,
      },
      position: point(
        origin,
        [0, prop.headCenterHeight + 0.02, -0.24],
        yawRadians,
        rootPitch
      ),
      rotation: headRotation,
      slot: 'eye',
    });
  } else if (prop.headStyle === 'helmet') {
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius: prop.headRadius * 1.32 * jr, segments: 14, rings: 10 },
      position: head,
      rotation: headRotation,
      slot: 'hat',
    });
  }

  const pushBox = (
    local: Vec3Tuple,
    size: Vec3Tuple,
    slot: MaterialSlot,
    rotation: Vec3Tuple = uprightRotation
  ) => {
    parts.push({
      geometry: Geometry.Box,
      params: { width: size[0], height: size[1], depth: size[2] },
      position: point(origin, local, yawRadians, rootPitch),
      rotation,
      slot,
    });
  };

  const pushSphere = (local: Vec3Tuple, radius: number, slot: MaterialSlot) => {
    parts.push({
      geometry: Geometry.Sphere,
      params: { radius, segments: 12, rings: 8 },
      position: point(origin, local, yawRadians, rootPitch),
      slot,
    });
  };

  const pushCylinder = (
    local: Vec3Tuple,
    radius: number,
    height: number,
    slot: MaterialSlot,
    rotation: Vec3Tuple = uprightRotation,
    segments = 12
  ) => {
    parts.push({
      geometry: Geometry.Cylinder,
      params: { radius, height, segments },
      position: point(origin, local, yawRadians, rootPitch),
      rotation,
      slot,
    });
  };

  const pushCone = (
    local: Vec3Tuple,
    radius: number,
    height: number,
    slot: MaterialSlot,
    rotation: Vec3Tuple = uprightRotation,
    segments = 12
  ) => {
    parts.push({
      geometry: Geometry.Cone,
      params: { radius, height, segments },
      position: point(origin, local, yawRadians, rootPitch),
      rotation,
      slot,
    });
  };

  const pushTorus = (
    local: Vec3Tuple,
    radius: number,
    tube: number,
    slot: MaterialSlot,
    rotation: Vec3Tuple = uprightRotation
  ) => {
    parts.push({
      geometry: Geometry.Torus,
      params: { radius, tube, segments: 24, sides: 6 },
      position: point(origin, local, yawRadians, rootPitch),
      rotation,
      slot,
    });
  };

  switch (prop.modelStyle ?? 'none') {
    case 'workdayDad':
      pushBox([0, prop.headCenterHeight + actualHeadRadius * 0.62, -actualHeadRadius * 0.24], [actualHeadRadius * 1.7, 0.055, actualHeadRadius * 1.15], 'hat', headRotation);
      pushBox([0, prop.headCenterHeight + actualHeadRadius * 0.48, -actualHeadRadius * 0.94], [actualHeadRadius * 1.15, 0.04, actualHeadRadius * 0.55], 'hat', headRotation);
      pushBox([0, torsoCenterY - 0.12, -prop.torsoDepth * 0.62], [prop.torsoWidth * 0.76, prop.torsoHeight * 0.56, 0.06], 'trim', [pose.torsoLean + rootPitch, yawDegrees, 0]);
      pushBox([-prop.hipHalfWidth * 1.3, prop.hipHeight + 0.02, -0.08], [0.16, 0.22, 0.08], 'metal', uprightRotation);
      pushCylinder([prop.shoulderHalfWidth * 1.2, 0.88, -0.18], 0.045, 0.28, 'accent', [8, yawDegrees, 12], 12);
      break;
    case 'officeCommuter':
      pushBox([-prop.shoulderHalfWidth * 0.45, torsoCenterY + 0.08, -prop.torsoDepth * 0.62], [0.08, prop.torsoHeight * 0.82, 0.055], 'trim', [pose.torsoLean + rootPitch, yawDegrees, -8]);
      pushBox([prop.shoulderHalfWidth * 0.45, torsoCenterY + 0.08, -prop.torsoDepth * 0.62], [0.08, prop.torsoHeight * 0.82, 0.055], 'trim', [pose.torsoLean + rootPitch, yawDegrees, 8]);
      pushBox([0, torsoCenterY - 0.08, prop.torsoDepth * 0.72], [prop.torsoWidth * 0.72, prop.torsoHeight * 0.58, 0.12], 'metal', uprightRotation);
      pushCylinder([0, prop.headCenterHeight + actualHeadRadius * 0.2, eyeZ - 0.01], actualHeadRadius * 0.5, 0.01, 'metal', [90 + pose.headNod + rootPitch, yawDegrees, 0], 20);
      pushBox([prop.shoulderHalfWidth * 1.2, 0.86, -0.24], [0.22, 0.32, 0.08], 'belt', uprightRotation);
      break;
    case 'bikeCourier':
      pushBox([0, torsoCenterY + 0.02, -prop.torsoDepth * 0.58], [0.065, prop.torsoHeight * 1.06, 0.055], 'accent', [pose.torsoLean + rootPitch, yawDegrees, -26]);
      pushBox([0, torsoCenterY - 0.02, prop.torsoDepth * 0.82], [prop.torsoWidth * 0.7, prop.torsoHeight * 0.62, 0.14], 'trim', uprightRotation);
      pushSphere([-prop.hipHalfWidth * 0.9, 0.56, -0.07], 0.06 * jr, 'accent');
      pushSphere([prop.hipHalfWidth * 0.9, 0.56, -0.07], 0.06 * jr, 'accent');
      pushBox([0, prop.neckHeight - 0.04, -prop.torsoDepth * 0.52], [prop.torsoWidth * 0.74, 0.07, 0.07], 'trim', headRotation);
      break;
    case 'studioTeacher':
      pushBox([-prop.shoulderHalfWidth * 0.46, torsoCenterY + 0.06, -prop.torsoDepth * 0.58], [0.07, prop.torsoHeight * 0.82, 0.055], 'trim', [pose.torsoLean + rootPitch, yawDegrees, -8]);
      pushBox([prop.shoulderHalfWidth * 0.46, torsoCenterY + 0.06, -prop.torsoDepth * 0.58], [0.07, prop.torsoHeight * 0.82, 0.055], 'trim', [pose.torsoLean + rootPitch, yawDegrees, 8]);
      pushTorus([0, prop.neckHeight - 0.08, -prop.torsoDepth * 0.48], actualHeadRadius * 0.42, 0.01, 'accent', [90, yawDegrees, 0]);
      pushBox([-prop.shoulderHalfWidth * 1.22, 0.72, -0.22], [0.24, 0.36, 0.08], 'belt', uprightRotation);
      break;
    case 'marketVendor':
      pushBox([0, torsoCenterY - 0.1, -prop.torsoDepth * 0.62], [prop.torsoWidth * 0.64, prop.torsoHeight * 0.74, 0.07], 'trim', [pose.torsoLean + rootPitch, yawDegrees, 0]);
      pushBox([0, prop.hipHeight + 0.02, -prop.torsoDepth * 0.58], [prop.torsoWidth * 0.68, 0.08, 0.07], 'belt', uprightRotation);
      pushBox([-prop.hipHalfWidth * 1.22, prop.hipHeight + 0.08, -0.14], [0.18, 0.22, 0.08], 'accent', uprightRotation);
      pushSphere([prop.shoulderHalfWidth * 1.18, 0.72, -0.04], 0.075 * jr, 'metal');
      break;
    case 'gradStudent':
      pushBox([0, torsoCenterY - 0.02, prop.torsoDepth * 0.82], [prop.torsoWidth * 0.78, prop.torsoHeight * 0.68, 0.14], 'metal', uprightRotation);
      pushBox([-prop.shoulderHalfWidth * 0.54, torsoCenterY + 0.03, -prop.torsoDepth * 0.6], [0.055, prop.torsoHeight * 0.92, 0.055], 'accent', [pose.torsoLean + rootPitch, yawDegrees, -12]);
      pushBox([prop.shoulderHalfWidth * 0.54, torsoCenterY + 0.03, -prop.torsoDepth * 0.6], [0.055, prop.torsoHeight * 0.92, 0.055], 'accent', [pose.torsoLean + rootPitch, yawDegrees, 12]);
      pushSphere([-prop.headRadius * 1.25, prop.headCenterHeight + prop.headRadius * 0.15, 0.02], prop.headRadius * 0.42 * jr, 'hair');
      pushSphere([prop.headRadius * 1.25, prop.headCenterHeight + prop.headRadius * 0.15, 0.02], prop.headRadius * 0.42 * jr, 'hair');
      pushBox([prop.shoulderHalfWidth * 1.1, 0.86, -0.2], [0.2, 0.28, 0.055], 'trim', uprightRotation);
      break;
    case 'none':
      break;
  }

  return { parts, eye: head };
}

// ── renderer ─────────────────────────────────────────────────────────────────

export function HumanoidFigure(props: {
  rig: { parts: RigPart[]; eye: Vec3Tuple };
  palette: HumanoidPalette;
  marker?: Vec3Tuple;
}) {
  const { rig, palette } = props;
  return (
    <>
      {props.marker ? (
        <>
          <Scene3D.Mesh
            geometry={Geometry.Cylinder}
            params={{ radius: 0.08, height: 0.035, segments: 16 }}
            material={palette.marker}
            position={[props.marker[0], props.marker[1] + 0.02, props.marker[2]]}
          />
          <Scene3D.Mesh
            geometry={Geometry.Torus}
            params={{ radius: 0.26, tube: 0.012, segments: 24, sides: 6 }}
            material={palette.marker}
            position={[props.marker[0], props.marker[1] + 0.04, props.marker[2]]}
          />
        </>
      ) : null}
      {rig.parts.map((part, index) => (
        <Scene3D.Mesh
          key={index}
          geometry={part.geometry}
          params={part.params}
          material={palette[part.slot] ?? palette.shirt}
          position={part.position}
          rotation={part.rotation}
        />
      ))}
    </>
  );
}
