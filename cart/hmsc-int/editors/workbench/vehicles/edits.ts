// editors/workbench/vehicles/edits.ts — the pure document-edit steps behind
// the vehicle Workbench source. Every control is one of these functions: doc
// in, doc out, no React, no host, so the authoring behavior is headless-testable
// and the stream's 'authored' events always carry a doc these steps produced.
// Behavior reference: cart/vehicle_lab/index.tsx (setStyle/setRole/moveGas/
// randomColor/setPartDamage/randomDamage) — read, never imported.
//
// P2: every editor-owned number lives in VEHICLE_EDITOR_TUNING. The two gasZ
// clamp ranges differ on purpose — the reference clamps tighter when a style
// switch re-fits the port than when the knob nudges it (see CAPTURE.md).

import {
  GAME_VEHICLE,
  type DamageLevel,
  type VehicleDoc,
  type VehiclePartId,
  type VehicleRoleId,
  type VehicleStyleId,
} from '@game';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export const VEHICLE_EDITOR_TUNING = Object.freeze({
  gasZ: {
    /** knob step, meters (the reference Knob's ±0.16) */
    step: 0.16,
    /** clamp when the KNOB moves the port: −0.22L .. 0.45L */
    nudge: { minLengthScale: -0.22, maxLengthScale: 0.45 },
    /** clamp when a STYLE/ROLE switch re-fits the port: −0.16L .. 0.42L */
    refit: { minLengthScale: -0.16, maxLengthScale: 0.42 },
  },
  damage: { min: 0 as DamageLevel, max: 3 as DamageLevel },
  /** the reference wreck spread: roll > .58 damages; > .74 dents; > .9 breaks */
  wreck: { damageAbove: 0.58, dentAbove: 0.74, breakAbove: 0.9 },
  /** seed mixers the reference used to de-correlate derived rolls */
  seedMix: { wreck: 0xd00d },
} as const);

// The same seeded generator the game tables were captured with — the editor's
// derived rolls (repaint, wreck) stay deterministic per seed for P4.
function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
}

function refitGasZ(gasZ: number, style: VehicleStyleId): number {
  const length = GAME_VEHICLE.tables.styles[style].length;
  const range = VEHICLE_EDITOR_TUNING.gasZ.refit;
  return clamp(gasZ, length * range.minLengthScale, length * range.maxLengthScale);
}

/** Capability 4 — generate: a fresh deterministic doc from a seed. */
export function generateVehicle(seed: number): VehicleDoc {
  return GAME_VEHICLE.make(seed);
}

/** Capability 1 — style switch keeps the doc but re-fits the gas port. */
export function editStyle(doc: VehicleDoc, style: VehicleStyleId): VehicleDoc {
  return { ...doc, style, gasZ: refitGasZ(doc.gasZ, style) };
}

/** Capability 2 — role switch coerces style into the role's pool; service
 *  roles repaint to their livery, civilians keep their colors. */
export function editRole(doc: VehicleDoc, role: VehicleRoleId): VehicleDoc {
  const preset = GAME_VEHICLE.tables.roles[role];
  const style = preset.styles.includes(doc.style) ? doc.style : preset.styles[0];
  const civilian = role === 'civilian';
  return {
    ...doc,
    role,
    style,
    color: civilian ? doc.color : preset.color,
    trim: civilian ? doc.trim : preset.trim,
    gasZ: refitGasZ(doc.gasZ, style),
  };
}

/** Capability 6 — gas side. */
export function editGasSide(doc: VehicleDoc, gasSide: -1 | 1): VehicleDoc {
  return { ...doc, gasSide };
}

/** Capability 6 — set the gas-Z directly, clamped to the wider nudge range.
 *  The UI knob (GAME_CHROME.Knob) owns stepping/rounding via its KnobSpec
 *  built from VEHICLE_EDITOR_TUNING.gasZ; this step owns the clamp law. */
export function setGasZ(doc: VehicleDoc, gasZ: number): VehicleDoc {
  const length = GAME_VEHICLE.tables.styles[doc.style].length;
  const range = VEHICLE_EDITOR_TUNING.gasZ.nudge;
  return {
    ...doc,
    gasZ: clamp(gasZ, length * range.minLengthScale, length * range.maxLengthScale),
  };
}

/** Capability 6 — the knob spec for the active style (min/max follow length). */
export function gasZKnobSpec(style: VehicleStyleId): { min: number; max: number; step: number; precision: number } {
  const length = GAME_VEHICLE.tables.styles[style].length;
  const range = VEHICLE_EDITOR_TUNING.gasZ.nudge;
  return {
    min: length * range.minLengthScale,
    max: length * range.maxLengthScale,
    step: VEHICLE_EDITOR_TUNING.gasZ.step,
    precision: 2,
  };
}

/** Capability 5 — seeded repaint from the captured color/trim tables. */
export function repaint(doc: VehicleDoc, seed: number): VehicleDoc {
  const rand = seededRandom(seed >>> 0);
  const random = GAME_VEHICLE.tables.random;
  return { ...doc, color: pick(rand, random.colors), trim: pick(rand, random.trims) };
}

/** Capability 8 — set one part's damage; level 0 clears the sparse entry. */
export function setPartDamage(doc: VehicleDoc, part: VehiclePartId, level: DamageLevel): VehicleDoc {
  const damage = { ...doc.damage };
  if (level <= VEHICLE_EDITOR_TUNING.damage.min) delete damage[part];
  else damage[part] = level;
  return { ...doc, damage };
}

/** Capability 8 — nudge one part's damage by ±1 within 0..3. */
export function nudgeDamage(doc: VehicleDoc, part: VehiclePartId, delta: number): VehicleDoc {
  const current = doc.damage[part] ?? 0;
  const next = clamp(current + delta, VEHICLE_EDITOR_TUNING.damage.min, VEHICLE_EDITOR_TUNING.damage.max) as DamageLevel;
  return setPartDamage(doc, part, next);
}

/** Capability 8 — wreck: one seeded roll per part, the reference spread. */
export function wreck(doc: VehicleDoc, seed: number): VehicleDoc {
  const rand = seededRandom((seed ^ VEHICLE_EDITOR_TUNING.seedMix.wreck) >>> 0);
  const spread = VEHICLE_EDITOR_TUNING.wreck;
  const damage: Partial<Record<VehiclePartId, DamageLevel>> = {};
  for (const part of GAME_VEHICLE.tables.parts) {
    const roll = rand();
    if (roll > spread.damageAbove) {
      damage[part] = (roll > spread.breakAbove ? 3 : roll > spread.dentAbove ? 2 : 1) as DamageLevel;
    }
  }
  return { ...doc, damage };
}

/** Capability 8 — repair everything. */
export function repairAll(doc: VehicleDoc): VehicleDoc {
  return { ...doc, damage: {} };
}
