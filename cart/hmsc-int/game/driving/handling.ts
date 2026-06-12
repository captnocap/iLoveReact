// game/driving/handling.ts — VEHICLE_HANDLING: per-style driving feel (req_0694).
//
// One car model, nine bodies, nine FEELS. The CarTuning knobs the handling lab
// exposes are the vocabulary; this table is the authored sentence per body
// style, so a fire truck never drives like a sports car. `tuningForStyle()` is
// the door: stock tuning for a style = the GTA-4 baseline (defaultTuning) +
// that style's overrides, with wheelbase/track lifted from the body dims
// (VEHICLE_STYLES — the same table that builds the meshes, so the feel always
// matches the body on screen).
//
// Tippability is a DESIGNED axis, not an accident: a style tips in steady
// cornering iff maxLatG > (trackWidth/2)/cgHeight. The sports car sits below
// that line (never trips itself), the van/ambulance/fire truck sit above it
// (lean hard, then go over) — see handling.test.ts which asserts the split.

import { VEHICLE_STYLES, type VehicleStyleId } from '../vehicle';
import { defaultTuning, type CarTuning } from './index';

/** wheelbase ≈ 58% of overall body length — feeds the bicycle model's turn
 *  radius. Promoted from the lab's private copy (rule of two). */
export const WHEELBASE_FRACTION = 0.58;

export const wheelBaseOf = (style: VehicleStyleId): number =>
  VEHICLE_STYLES[style].length * WHEELBASE_FRACTION;

/** What makes each body ITSELF, on top of the GTA-4 sedan baseline. Only the
 *  knobs that differ are written; everything else inherits defaultTuning. */
export const VEHICLE_HANDLING = Object.freeze({
  // The baseline register — heavy, a little lazy, honest.
  sedan: {},
  // Two-door: lighter and livelier, sits lower, keener to turn in.
  coupe: { enginePower: 11, brakePower: 15, topSpeed: 40, maxSteer: 0.52, steerSpeed: 4, grip: 5.2, maxLatG: 1.15, corneringDrag: 0.45, cgHeight: 0.82, rollLeanGain: 0.14 },
  // The long family hauler: a sedan with luggage — softer, a touch slower.
  wagon: { enginePower: 8.5, brakePower: 13.5, topSpeed: 33, steerSpeed: 2.9, grip: 4.3, maxLatG: 1, corneringDrag: 0.55, cgHeight: 1, rollLeanGain: 0.18 },
  // A box on wheels: slow, understeery, leans hard and WILL go over.
  van: { enginePower: 7.5, brakePower: 12, reversePower: 4, topSpeed: 28, reverseTopSpeed: 7, maxSteer: 0.46, steerSpeed: 2.4, grip: 3.8, handbrakeGrip: 0.7, maxLatG: 0.85, corneringDrag: 0.7, cgHeight: 1.35, rollLeanGain: 0.22 },
  // Torquey work truck with a light, loose tail — happiest sliding.
  pickup: { enginePower: 10, brakePower: 13, topSpeed: 33, maxSteer: 0.48, steerSpeed: 2.8, grip: 3.9, handbrakeGrip: 0.65, maxLatG: 0.95, corneringDrag: 0.6, cgHeight: 1.18, rollLeanGain: 0.2 },
  // Low, fast, darty; grips past the tip line so it spins before it rolls.
  sports: { enginePower: 15, brakePower: 19, reversePower: 6, topSpeed: 52, reverseTopSpeed: 9, maxSteer: 0.55, steerSpeed: 5.5, grip: 6.8, handbrakeGrip: 0.9, maxLatG: 1.4, corneringDrag: 0.32, cgHeight: 0.58, rollLeanGain: 0.1 },
  // The pursuit sedan: quick, planted, handbrake loose enough to swing it.
  police_car: { enginePower: 12, brakePower: 16, topSpeed: 44, maxSteer: 0.52, steerSpeed: 4.2, grip: 5.4, handbrakeGrip: 0.7, maxLatG: 1.2, corneringDrag: 0.45, cgHeight: 0.9, rollLeanGain: 0.14 },
  // A heavy box with a patient nose — dives and squats, tips if rushed.
  ambulance: { enginePower: 8, brakePower: 12.5, reversePower: 4, topSpeed: 30, reverseTopSpeed: 6, maxSteer: 0.42, steerSpeed: 2.1, grip: 4, maxLatG: 0.8, corneringDrag: 0.8, cgHeight: 1.45, rollLeanGain: 0.24, pitchGain: 0.07 },
  // The heaviest thing on the road: slow everywhere, wide everywhere, tall.
  fire_truck: { enginePower: 6.5, brakePower: 11, reversePower: 3.5, topSpeed: 25, reverseTopSpeed: 5, maxSteer: 0.38, steerSpeed: 1.8, grip: 3.6, handbrakeGrip: 0.6, maxLatG: 0.72, corneringDrag: 0.9, cgHeight: 1.7, rollLeanGain: 0.26, pitchGain: 0.07 },
} satisfies Record<VehicleStyleId, Readonly<Partial<CarTuning>>>);

/** The stock CarTuning for a body style — baseline + the style's overrides,
 *  wheelbase/track from the body dims. The lab loads this on body pick; the
 *  game spawns traffic with it. */
export function tuningForStyle(style: VehicleStyleId): CarTuning {
  return {
    ...defaultTuning(wheelBaseOf(style), VEHICLE_STYLES[style].width),
    ...VEHICLE_HANDLING[style],
  };
}
