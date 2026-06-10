export const HMSC_GAMEPLAY_CAMERA = {
  yawRadiansPerPixel: 0.0032,
  pitchRadiansPerPixel: 0.0024,
  smoothingPerSecond: 24,
  maxFrameSeconds: 0.05,
  minFrameSeconds: 0.001,
  defaultPitchRadians: 0.05,
  minPitchRadians: -0.65,
  maxPitchRadians: 0.85,
  maxMouseDeltaPixels: 220,
  settledYawDegrees: 0.001,
  settledPitchRadians: 0.0001,
  distanceMeters: 5.9,
  heightMeters: 3.05,
  targetHeightMeters: 2.08,
  pitchTargetMetersPerRadian: 0.82,
  fovDegrees: 48,
  aimShoulderShiftMeters: 0.62,
  aimTargetShiftRatio: 0.35,
  aimFovDegrees: 47,
};

export function clampCameraValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function angleDeltaDegrees(fromDegrees: number, toDegrees: number): number {
  const deltaRadians = (toDegrees - fromDegrees) * Math.PI / 180;
  return Math.atan2(Math.sin(deltaRadians), Math.cos(deltaRadians)) * 180 / Math.PI;
}
