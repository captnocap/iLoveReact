// game/explosion.ts — GAME_EXPLOSION: the ONE radial-blast solver (the instant
// "big ass boom"). Distinct from game/fire.ts (the lingering, spreading
// combustion model) — an explosion is a single event at one instant in time:
// it throws things OUT (radial impulse), it HURTS things (radial damage), and
// it can SET things alight (ignition) which is where fire.ts takes over.
//
// THE LAW (P3 door, pure): this module computes a blast's effect on a list of
// targets and returns it. It does NOT mutate physics, does NOT read the world,
// does NOT raycast. The caller supplies each target's position, size, and how
// occluded it is (`cover`, 0..1 — produced by a world-side LoS check, exactly
// like game/chance.ts consumes coverFraction); the caller applies the returned
// impulse to its physics velocity and subtracts the returned damage from hp.
// Producers stay outside (world raycast = world territory); the math lives here.
//
// P2: the BLAST MAGNITUDES — radius, peak impulse, peak damage — are per-call,
// because an RPG and a firecracker differ by orders of magnitude and belong to
// the explosive's own data (the prop/item kind, a later layer). This door owns
// exactly ONE registered table, EXPLOSION_TUNING: the SHAPE knobs (falloff
// curve, upward throw, ignition threshold) that are sane across every blast and
// that a caller overrides per-call when a specific explosive wants a different
// feel. No other magic numbers live here. [[feedback_rule_of_two_no_magic_values]]

export type Vec3 = { x: number; y: number; z: number };

// How a blast's strength decays from center (s = 1) to the radius edge (s = 0).
//   linear     — even, predictable; the safe default for gameplay tuning
//   quadratic  — strong core, soft edge (s²); reads as a tighter "kill zone"
//   smooth     — smoothstep; soft core AND soft edge, the most cinematic falloff
export type FalloffKind = 'linear' | 'quadratic' | 'smooth';

const FALLOFF: Record<FalloffKind, (s: number) => number> = {
  linear: (s) => s,
  quadratic: (s) => s * s,
  smooth: (s) => s * s * (3 - 2 * s),
};

// The ONE registered shape table (P2). Magnitudes are per-call; these are the
// cross-blast defaults a specific explosive may override in BlastParams.
export const EXPLOSION_TUNING = {
  /** default decay shape from core to edge */
  falloff: 'smooth' as FalloffKind,
  /** 0 = pure radial throw; >0 adds an upward component so debris arcs up and
   *  out the way a real blast lofts things, instead of sliding along the ground */
  upwardThrow: 0.45,
  /** a target whose post-falloff intensity reaches this ignites (0..1); blasts
   *  weaker than this at a target still hurt and shove it but don't light it */
  igniteAboveIntensity: 0.35,
} as const;

export type ExplosionTuning = typeof EXPLOSION_TUNING;

export type BlastParams = {
  center: Vec3;
  /** distance (m) at which impulse and damage have decayed to zero */
  radiusMeters: number;
  /** velocity delta (m/s) applied to a unit-mass target AT THE CENTER */
  peakImpulse: number;
  /** hit points removed from a target AT THE CENTER */
  peakDamage: number;
  /** per-blast overrides of the shape table (P2 — an RPG vs a propane tank) */
  falloff?: FalloffKind;
  upwardThrow?: number;
  igniteAboveIntensity?: number;
};

// One thing the blast can act on. The caller owns what it IS (a figure, a car,
// a physics body, the player) — the solver only needs where it is, how big it
// is, how shielded it is, and how heavy it is.
export type BlastTarget = {
  position: Vec3;
  /** body radius (m); the blast measures to the target's NEAR edge, so a wide
   *  car catches more of a near miss than a point would. Default 0 (a point). */
  radiusMeters?: number;
  /** 0 = fully exposed .. 1 = fully behind cover; scales the whole effect down.
   *  Caller-produced (world LoS), same contract as game/chance.ts coverFraction. */
  cover?: number;
  /** heavier targets take less velocity from the same impulse (default 1). A
   *  truck barely rocks; a person flies. Does NOT scale damage. */
  mass?: number;
};

export type BlastHit = {
  /** index into the BlastTarget[] the caller passed — its handle back to its own object */
  index: number;
  /** distance from blast center to the target's near edge (m) */
  distanceMeters: number;
  /** 0..1 fraction of peak that reached this target after falloff and cover */
  intensity: number;
  /** velocity delta to ADD to the target's velocity — caller applies it */
  impulse: Vec3;
  /** hit points to subtract from the target's hp — caller applies it */
  damage: number;
  /** true when intensity cleared the ignition threshold: this target should
   *  catch fire — hand it to game/fire.ts */
  ignites: boolean;
};

export type BlastResult = {
  /** one entry per target WITHIN radius, nearest first; out-of-range targets omitted */
  hits: BlastHit[];
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Resolve a blast against a set of targets. Pure: returns the impulse/damage/
 * ignition each in-range target should receive; the caller applies them.
 *
 * The geometry: distance is measured to each target's NEAR edge (center
 * distance minus its body radius, floored at 0), so a target straddling the
 * blast point gets full intensity. Intensity = falloff(1 - edgeDist/radius)
 * scaled by exposure (1 - cover). Impulse points from center to target with an
 * upward bias, magnitude = peakImpulse·intensity/mass. Damage = peakDamage·intensity.
 */
export function blastAt(params: BlastParams, targets: ReadonlyArray<BlastTarget>): BlastResult {
  const radius = params.radiusMeters;
  const curve = FALLOFF[params.falloff ?? EXPLOSION_TUNING.falloff];
  const upward = params.upwardThrow ?? EXPLOSION_TUNING.upwardThrow;
  const igniteAbove = params.igniteAboveIntensity ?? EXPLOSION_TUNING.igniteAboveIntensity;

  const hits: BlastHit[] = [];
  if (radius <= 0) return { hits };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const toTarget = sub(target.position, params.center);
    const centerDist = length(toTarget);
    const edgeDist = Math.max(0, centerDist - (target.radiusMeters ?? 0));
    if (edgeDist >= radius) continue;

    const exposure = 1 - clamp01(target.cover ?? 0);
    const intensity = curve(1 - edgeDist / radius) * exposure;
    if (intensity <= 0) continue;

    // Direction from blast to target, with an upward component so things loft.
    // Degenerate (target sitting on the blast point) → straight up.
    let dir: Vec3;
    if (centerDist > 1e-6) {
      const biased = { x: toTarget.x, y: toTarget.y + centerDist * upward, z: toTarget.z };
      const biasedLen = length(biased) || 1;
      dir = { x: biased.x / biasedLen, y: biased.y / biasedLen, z: biased.z / biasedLen };
    } else {
      dir = { x: 0, y: 1, z: 0 };
    }

    const mass = target.mass && target.mass > 0 ? target.mass : 1;
    const speed = (params.peakImpulse * intensity) / mass;

    hits.push({
      index: i,
      distanceMeters: edgeDist,
      intensity,
      impulse: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      damage: params.peakDamage * intensity,
      ignites: intensity >= igniteAbove,
    });
  }

  hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { hits };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_EXPLOSION = {
  blastAt,
  tuning: EXPLOSION_TUNING,
} as const;
