import { readFile } from '../../../runtime/hooks/fs';
import { GAME_TARGET_DIR, parseGameTarget, type GameTarget } from '../data/gameTarget';

export const FART_RACER_TARGET_PATH = `${GAME_TARGET_DIR}/fart-racer.json`;

export type NumberRange = Readonly<{ minimum: number; maximum: number }>;

export const FART_RACER_DRIVING_BAND_KEYS = [
  'enginePower', 'brakePower', 'reversePower', 'topSpeed', 'reverseTopSpeed',
  'drag', 'rollResist', 'maxSteer', 'steerSpeed', 'grip', 'handbrakeGrip',
  'maxLateralG', 'corneringDrag', 'rollLeanGain', 'maxLean', 'rollEase',
  'centerOfGravityHeight', 'rolloverGravity', 'rollDamping', 'pitchGain',
] as const;

export type FartRacerTarget = Readonly<{
  gameTarget: GameTarget;
  ratingFallbacks: Readonly<{
    drive: number;
    grip: number;
    handling: number;
    topSpeed: number;
    acceleration: number;
  }>;
  drivingBands: Readonly<Record<typeof FART_RACER_DRIVING_BAND_KEYS[number], NumberRange> & {
    wheelBase: number;
    trackWidth: number;
  }>;
  vehicleFallbacks: Readonly<{
    durabilityCapacity: number;
    tankCapacityL: number;
    burnRatePerSec: number;
    fillEfficiency: number;
    leakRatePerDamage: number;
  }>;
  simulation: Readonly<{
    initialTankRatio: number;
    bowelCapacity: number;
    minimumCollisionImpulse: number;
    collisionDamagePerImpulse: number;
    maximumStepSeconds: number;
  }>;
  world: Readonly<{
    walkableSlopeDegrees: number;
    terrainColor: readonly [number, number, number];
  }>;
  /** Gameplay/audio profiles are a game roster, not a side effect of which
   * visual spawn proxies happen to remain placed in the active world. */
  vehicleRosterPackageIds: readonly string[];
  /** The package whose ten-part semantic mesh is the car you SEE. Gameplay and
   *  audio still come from the roster; this is the shell that gets driven, and
   *  naming it here keeps the answer out of placement order. */
  visualVehiclePackageId: string | null;
  agentLanes: Readonly<{
    sequence: readonly ['track', 'checkpoints', 'vehicle-stats'];
    vehicleStats: Readonly<{
      parallel: true;
      minimumVehicles: number;
      minimumTopSpeedSpan: number;
      minimumAccelerationSpan: number;
    }>;
  }>;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be finite and within [${minimum}, ${maximum}]`);
  }
  return value;
}

function range(value: unknown, label: string): NumberRange {
  const row = record(value, label);
  const minimum = finite(row.minimum, `${label}.minimum`);
  const maximum = finite(row.maximum, `${label}.maximum`);
  if (maximum < minimum) throw new Error(`${label} is inverted`);
  return { minimum, maximum };
}

export function parseFartRacerTarget(input: unknown): FartRacerTarget {
  const root = record(input, 'Fart Racer target');
  const gameTarget = parseGameTarget(root);
  if (gameTarget.id !== 'fart-racer' || gameTarget.namespace !== 'com.captnocap.fartracer') {
    throw new Error('Fart Racer target identity is not canonical');
  }
  const fallbacks = record(root.ratingFallbacks, 'ratingFallbacks');
  const ratingFallbacks = {
    drive: finite(fallbacks.drive, 'ratingFallbacks.drive', 0, 1),
    grip: finite(fallbacks.grip, 'ratingFallbacks.grip', 0, 1),
    handling: finite(fallbacks.handling, 'ratingFallbacks.handling', 0, 1),
    topSpeed: finite(fallbacks.topSpeed, 'ratingFallbacks.topSpeed', 0, 1),
    acceleration: finite(fallbacks.acceleration, 'ratingFallbacks.acceleration', 0, 1),
  };
  const bands = record(root.drivingBands, 'drivingBands');
  const drivingBands: Record<string, unknown> = {};
  for (const key of FART_RACER_DRIVING_BAND_KEYS) drivingBands[key] = range(bands[key], `drivingBands.${key}`);
  drivingBands.wheelBase = finite(bands.wheelBase, 'drivingBands.wheelBase', 0.01);
  drivingBands.trackWidth = finite(bands.trackWidth, 'drivingBands.trackWidth', 0.01);

  const vehicle = record(root.vehicleFallbacks, 'vehicleFallbacks');
  const vehicleFallbacks = {
    durabilityCapacity: finite(vehicle.durabilityCapacity, 'vehicleFallbacks.durabilityCapacity', 0),
    tankCapacityL: finite(vehicle.tankCapacityL, 'vehicleFallbacks.tankCapacityL', 0),
    burnRatePerSec: finite(vehicle.burnRatePerSec, 'vehicleFallbacks.burnRatePerSec', 0),
    fillEfficiency: finite(vehicle.fillEfficiency, 'vehicleFallbacks.fillEfficiency', 0),
    leakRatePerDamage: finite(vehicle.leakRatePerDamage, 'vehicleFallbacks.leakRatePerDamage', 0),
  };
  const simulation = record(root.simulation, 'simulation');
  const sim = {
    initialTankRatio: finite(simulation.initialTankRatio, 'simulation.initialTankRatio', 0, 1),
    bowelCapacity: finite(simulation.bowelCapacity, 'simulation.bowelCapacity', 0.001),
    minimumCollisionImpulse: finite(simulation.minimumCollisionImpulse, 'simulation.minimumCollisionImpulse', 0),
    collisionDamagePerImpulse: finite(simulation.collisionDamagePerImpulse, 'simulation.collisionDamagePerImpulse', 0),
    maximumStepSeconds: finite(simulation.maximumStepSeconds, 'simulation.maximumStepSeconds', 0.001, 0.25),
  };
  const worldRow = record(root.world, 'world');
  if (!Array.isArray(worldRow.terrainColor) || worldRow.terrainColor.length !== 3) {
    throw new Error('world.terrainColor must contain three normalized channels');
  }
  const world = {
    walkableSlopeDegrees: finite(worldRow.walkableSlopeDegrees, 'world.walkableSlopeDegrees', 0, 89),
    terrainColor: worldRow.terrainColor.map((value, index) => finite(value, `world.terrainColor[${index}]`, 0, 1)) as [number, number, number],
  };
  if (!Array.isArray(root.vehicleRosterPackageIds) || root.vehicleRosterPackageIds.length === 0 ||
      root.vehicleRosterPackageIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('vehicleRosterPackageIds must contain one or more package ids');
  }
  const vehicleRosterPackageIds = [...new Set(root.vehicleRosterPackageIds as string[])];
  const declaredVisual = root.visualVehiclePackageId;
  if (declaredVisual !== undefined && (typeof declaredVisual !== 'string' || declaredVisual.length === 0)) {
    throw new Error('visualVehiclePackageId must be a package id when present');
  }
  const visualVehiclePackageId = typeof declaredVisual === 'string' ? declaredVisual : null;
  const lanes = record(root.agentLanes, 'agentLanes');
  if (!Array.isArray(lanes.sequence) || lanes.sequence.length !== 3 ||
      lanes.sequence[0] !== 'track' || lanes.sequence[1] !== 'checkpoints' || lanes.sequence[2] !== 'vehicle-stats') {
    throw new Error('agentLanes.sequence must be track → checkpoints → vehicle-stats');
  }
  const vehicleStats = record(lanes.vehicleStats, 'agentLanes.vehicleStats');
  if (vehicleStats.parallel !== true) throw new Error('agentLanes.vehicleStats.parallel must be true');
  const minimumVehicles = finite(vehicleStats.minimumVehicles, 'agentLanes.vehicleStats.minimumVehicles', 2, 64);
  if (!Number.isInteger(minimumVehicles)) throw new Error('agentLanes.vehicleStats.minimumVehicles must be an integer');
  const agentLanes: FartRacerTarget['agentLanes'] = {
    sequence: ['track', 'checkpoints', 'vehicle-stats'],
    vehicleStats: {
      parallel: true,
      minimumVehicles,
      minimumTopSpeedSpan: finite(vehicleStats.minimumTopSpeedSpan, 'agentLanes.vehicleStats.minimumTopSpeedSpan', 0.01, 1),
      minimumAccelerationSpan: finite(vehicleStats.minimumAccelerationSpan, 'agentLanes.vehicleStats.minimumAccelerationSpan', 0.01, 1),
    },
  };
  return {
    gameTarget,
    ratingFallbacks,
    drivingBands: drivingBands as FartRacerTarget['drivingBands'],
    vehicleFallbacks,
    simulation: sim,
    world,
    vehicleRosterPackageIds,
    visualVehiclePackageId,
    agentLanes,
  };
}

export type VehicleRatingRow = Readonly<{
  id: string;
  topSpeedRating: number;
  accelerationRating: number;
}>;

export type VehicleDistributionReport = Readonly<{
  ok: boolean;
  vehicles: number;
  topSpeedSpan: number;
  accelerationSpan: number;
  reason?: string;
}>;

/** Export-time guard against the known one-batch/one-average failure mode. */
export function validateVehicleRatingDistribution(
  target: FartRacerTarget,
  vehicles: readonly VehicleRatingRow[],
): VehicleDistributionReport {
  const policy = target.agentLanes.vehicleStats;
  if (vehicles.length < policy.minimumVehicles) {
    return { ok: false, vehicles: vehicles.length, topSpeedSpan: 0, accelerationSpan: 0, reason: `needs at least ${policy.minimumVehicles} independently statted vehicles` };
  }
  const topSpeeds = vehicles.map((vehicle) => finite(vehicle.topSpeedRating, `${vehicle.id}.topSpeedRating`, 0, 1));
  const accelerations = vehicles.map((vehicle) => finite(vehicle.accelerationRating, `${vehicle.id}.accelerationRating`, 0, 1));
  const topSpeedSpan = Math.max(...topSpeeds) - Math.min(...topSpeeds);
  const accelerationSpan = Math.max(...accelerations) - Math.min(...accelerations);
  const reasons: string[] = [];
  if (topSpeedSpan < policy.minimumTopSpeedSpan) reasons.push(`top-speed span ${topSpeedSpan.toFixed(3)} < ${policy.minimumTopSpeedSpan.toFixed(3)}`);
  if (accelerationSpan < policy.minimumAccelerationSpan) reasons.push(`acceleration span ${accelerationSpan.toFixed(3)} < ${policy.minimumAccelerationSpan.toFixed(3)}`);
  return {
    ok: reasons.length === 0,
    vehicles: vehicles.length,
    topSpeedSpan,
    accelerationSpan,
    ...(reasons.length ? { reason: reasons.join('; ') } : {}),
  };
}

export function loadFartRacerTarget(): FartRacerTarget {
  const source = readFile(FART_RACER_TARGET_PATH);
  if (source === null) throw new Error(`Fart Racer target is missing: ${FART_RACER_TARGET_PATH}`);
  return parseFartRacerTarget(JSON.parse(source));
}
