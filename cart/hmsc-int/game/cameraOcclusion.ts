import type { CameraOcclusionResult } from './physics';

export type CameraOcclusionResponseTuning = {
  minDistanceMeters: number;
  skinOffsetMeters: number;
  residualOpacity: number;
};

export type CameraOcclusionResponse = {
  distanceMeters: number;
  residualOwnerIds: string[];
};

export function cameraOcclusionResponse(
  result: CameraOcclusionResult | null,
  ownerIds: readonly string[],
  baseDistanceMeters: number,
  tuning: CameraOcclusionResponseTuning,
): CameraOcclusionResponse {
  if (!result || result.nearestTargetDistanceMeters <= 0) {
    return { distanceMeters: baseDistanceMeters, residualOwnerIds: [] };
  }
  const minDistance = Math.max(0.1, tuning.minDistanceMeters);
  const distanceMeters = Math.max(
    minDistance,
    Math.min(baseDistanceMeters, result.nearestTargetDistanceMeters - Math.max(0, tuning.skinOffsetMeters)),
  );
  const residualOwner = result.nearestOwnerIndex > 0 && distanceMeters <= minDistance + 0.01
    ? ownerIds[result.nearestOwnerIndex - 1]
    : null;
  return { distanceMeters, residualOwnerIds: residualOwner ? [residualOwner] : [] };
}
