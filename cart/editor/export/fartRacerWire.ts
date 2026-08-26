import { textBytes } from '../../../runtime/workspace/lumps';
import type { BlueprintTable, ItemAttachment, VehicleAttachment } from '../model/blueprintTable';
import { FART_RACER_DRIVING_BAND_KEYS, type FartRacerTarget } from './fartRacerTarget';
import { RACE_MARKER_TAGS, type WorldMarker } from '../world/worldMarkers';

export const FART_RACER_WIRE_MAGIC = 0x31524746; // FGR1
export const FART_RACER_WIRE_VERSION = 1;

export type BakedBlueprint = Readonly<{
  packageId: string;
  modelId: string;
  blueprint: BlueprintTable;
}>;

export type DriveThruValidation = Readonly<{ ok: boolean; reason: string; driveThrus: number }>;

/** Export-side twin of the native catalog boundary: every drive-thru must
 * resolve one concrete package with a complete non-negative food tuple. */
export function validateDriveThruBlueprints(
  blueprints: readonly BakedBlueprint[],
  markers: readonly WorldMarker[],
): DriveThruValidation {
  const driveThrus = markers.filter((marker) => marker.trigger.event.tag === RACE_MARKER_TAGS.driveThru);
  for (const marker of driveThrus) {
    const sourceId = marker.trigger.event.sourceId;
    const source = blueprints.find((entry) => entry.packageId === sourceId);
    const extension = source?.blueprint.extensions['com.captnocap.fartracer'];
    const food = extension && typeof extension === 'object' && !Array.isArray(extension)
      ? extension as Record<string, unknown>
      : null;
    const fields = food ? [food.gasYieldL, food.digestSeconds, food.bowelLoad] : [];
    if (!source || !food || fields.length !== 3 || fields.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      return { ok: false, reason: `${marker.id} does not resolve a complete food blueprint from ${sourceId ?? 'no package'}`, driveThrus: driveThrus.length };
    }
  }
  return { ok: true, reason: `${driveThrus.length} package-authored drive-thru${driveThrus.length === 1 ? '' : 's'}`, driveThrus: driveThrus.length };
}

function documentAttachment<T>(blueprint: BlueprintTable | null, profile: string): T | null {
  return (blueprint?.stats.find((attachment) =>
    attachment.profile.id === profile && attachment.scope.kind === 'document') as T | undefined) ?? null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Fixed numeric prefix consumed by compiled Zig, followed by a bounded JSON
 * catalog retained as declarative data for reports, foods, and future adapters. */
export function encodeFartRacerLogic(
  target: FartRacerTarget,
  blueprints: readonly BakedBlueprint[],
  markers: readonly unknown[],
  visualVehiclePackageId?: string | null,
): Uint8Array {
  const vehicleEntry = blueprints.find((entry) =>
    entry.blueprint.stats.some((attachment) => attachment.profile.id === 'rj.profile.vehicle')) ?? null;
  const vehicleBlueprint = vehicleEntry?.blueprint ?? null;
  const vehicle = documentAttachment<VehicleAttachment>(vehicleBlueprint, 'rj.profile.vehicle');
  const item = documentAttachment<ItemAttachment>(vehicleBlueprint, 'rj.core.item');
  const extension = vehicleBlueprint?.extensions['com.captnocap.fartracer'];
  const vendor = extension && typeof extension === 'object' && !Array.isArray(extension)
    ? extension as Record<string, unknown>
    : {};
  const authored = [
    optionalNumber(vehicle?.driveRating),
    optionalNumber(vehicle?.gripRating),
    optionalNumber(vehicle?.handlingRating),
    optionalNumber(vehicle?.topSpeedRating),
    optionalNumber(vehicle?.accelerationRating),
    optionalNumber(item?.durabilityCapacity),
    optionalNumber(vendor.tankCapacityL),
    optionalNumber(vendor.burnRatePerSec),
    optionalNumber(vendor.fillEfficiency),
    optionalNumber(vendor.leakRatePerDamage),
  ];
  const numbers: number[] = [
    target.ratingFallbacks.drive,
    target.ratingFallbacks.grip,
    target.ratingFallbacks.handling,
    target.ratingFallbacks.topSpeed,
    target.ratingFallbacks.acceleration,
  ];
  for (const key of FART_RACER_DRIVING_BAND_KEYS) {
    const band = target.drivingBands[key];
    numbers.push(band.minimum, band.maximum);
  }
  numbers.push(target.drivingBands.wheelBase, target.drivingBands.trackWidth);
  numbers.push(
    target.simulation.initialTankRatio,
    target.simulation.bowelCapacity,
    target.simulation.minimumCollisionImpulse,
    target.simulation.collisionDamagePerImpulse,
    target.simulation.maximumStepSeconds,
    target.vehicleFallbacks.durabilityCapacity,
    target.vehicleFallbacks.tankCapacityL,
    target.vehicleFallbacks.burnRatePerSec,
    target.vehicleFallbacks.fillEfficiency,
    target.vehicleFallbacks.leakRatePerDamage,
  );
  for (const value of authored) numbers.push(value === null ? 0 : 1, value ?? 0);
  // APPENDED, never inserted. Every slot in this tape is addressed by position;
  // adding a number anywhere but the end silently reinterprets every number
  // after it on a reader that has not been rebuilt (the profile versioning law,
  // req_4760, applied to the wire it produces).
  numbers.push(target.simulation.boostBurnMultiplier);

  const catalog = textBytes(JSON.stringify({
    version: 1,
    vehiclePackageId: vehicleEntry?.packageId ?? null,
    vehicleVisualPackageId: visualVehiclePackageId ?? vehicleEntry?.packageId ?? null,
    target: target.gameTarget,
    blueprints,
    markers,
  }));
  const numericBytes = numbers.length * 4;
  const out = new Uint8Array(16 + numericBytes + catalog.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, FART_RACER_WIRE_MAGIC, true);
  view.setUint32(4, FART_RACER_WIRE_VERSION, true);
  view.setUint32(8, numbers.length, true);
  view.setUint32(12, catalog.byteLength, true);
  numbers.forEach((value, index) => view.setFloat32(16 + index * 4, value, true));
  out.set(catalog, 16 + numericBytes);
  return out;
}
