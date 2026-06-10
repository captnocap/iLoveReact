import type { DamageZone } from '../../render3d/humanoid';

// The probabilistic hit path. Every shot that is NOT the player's aim ray —
// NPC -> player, NPC -> NPC — resolves here, never by raycasting a body. Given
// the shot's factors (range, the target's cover and stance, the shooter's skill)
// this returns a 0..1 ground-truth chance; rollHit turns that into a yes/no, and
// rollZone picks where a landed shot strikes. This is the ground truth — any
// display warp (a "perceived" odds readout) is a separate layer and must read
// from here, never recompute odds of its own.

export type ShotFactors = {
  rangeMeters: number;
  // 0 fully exposed .. 1 fully behind cover (LoS occlusion against the target).
  coverFraction: number;
  targetCrouched: boolean;
  // 0 hopeless .. 1 marksman. Comes from the shooter's kind/skill later.
  shooterSkill: number;
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Ground-truth probability the shot connects. Skill sets the ceiling; range bleeds
// it off past point-blank; cover and a crouched target cut it further. Tuning
// constants are deliberately gentle — combat balance is a later pass.
export function hitChance(factors: ShotFactors): number {
  const base = 0.35 + 0.6 * clamp01(factors.shooterSkill); // 0.35 .. 0.95
  const rangeFactor = clamp01(1 - Math.max(0, factors.rangeMeters - 4) / 36); // full <4m, ~0 by 40m
  let chance = base * rangeFactor;
  chance *= 1 - clamp01(factors.coverFraction) * 0.8;
  if (factors.targetCrouched) chance *= 0.7;
  return clamp01(chance);
}

export function rollHit(chance: number, rng: () => number = Math.random): boolean {
  return rng() < chance;
}

// Where a landed probabilistic shot strikes. Center mass is overwhelmingly likely
// (the AI aims for the torso); heads are rare, limbs occasional. The player's aim
// ray does NOT use this — that picks a zone geometrically. This is only for shots
// resolved by chance.
const ZONE_WEIGHTS: Array<{ zone: DamageZone; weight: number }> = [
  { zone: 'torso', weight: 0.5 },
  { zone: 'legL', weight: 0.12 },
  { zone: 'legR', weight: 0.12 },
  { zone: 'armL', weight: 0.09 },
  { zone: 'armR', weight: 0.09 },
  { zone: 'head', weight: 0.08 },
];

export function rollZone(rng: () => number = Math.random): DamageZone {
  const total = ZONE_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = rng() * total;
  for (const entry of ZONE_WEIGHTS) {
    pick -= entry.weight;
    if (pick <= 0) return entry.zone;
  }
  return 'torso';
}
