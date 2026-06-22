// void/distortion.ts — voidDistortion(), the ONE fan-out function.
//
// SKYBOX_PLAYBOOK §2 + discipline #2: there is ONE escape_depth and ONE pure
// function that turns it into a weight per corruptible system. Every consumer
// multiplies ITS behavior by ITS weight — no consumer hardcodes a km check, and
// the named tier-bands (10/25/50/75/100/150 km) are achievement MILESTONES, NOT
// six step-functions. The curve below is continuous; the tiers are just where
// each weight has visibly crossed into play.
//
// Seam 1 wires exactly one consumer: skyDrift (the cheapest distortion — it
// rides the sceneEnv floats that already exist). Every other weight is defined
// here so later seams plug in without reshaping the struct.

// The corruption weights, each 0 (honest) → 1 (fully corrupted). Onset order
// (which crosses 0.5 first, as authored in the playbook's tier walk):
//   skyDrift      ~10km  the world starts THINNING — washed-out, drifting sky
//   roadRepeat    ~25km  roads loop, signs to nowhere
//   spawnWeird    ~25km  repeated buildings / shop names / faces
//   trafficFlip   ~50km  wrong-way traffic, cars too slow
//   npcOrientCorrupt ~50km  peds path into fields, stare, doors don't open
//   awarenessGlitch ~75km  the void corrupts the notoriety/perception system
//   instrumentLie ~75km  odometer/GPS/minimap report a lie over the truth
//   controlInvert ~100km the Truman tax — controls invert, gravity pulses
//   dialogCorrupt        rides the whole way; the passenger's coherence decays
export type VoidDistortion = {
  trafficFlip: number;
  npcOrientCorrupt: number;
  controlInvert: number;
  skyDrift: number;
  dialogCorrupt: number;
  spawnWeird: number;
  roadRepeat: number;
  awarenessGlitch: number;
  instrumentLie: number;
};

export const VOID_NULL: VoidDistortion = {
  trafficFlip: 0,
  npcOrientCorrupt: 0,
  controlInvert: 0,
  skyDrift: 0,
  dialogCorrupt: 0,
  spawnWeird: 0,
  roadRepeat: 0,
  awarenessGlitch: 0,
  instrumentLie: 0,
};

// Tier milestones (km) — for achievement toasts ONLY, never branching logic.
export const VOID_TIER_KM = [10, 25, 50, 75, 100, 150] as const;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Hermite smoothstep — a soft S from `onset` to `full`, flat 0 before and 1
// after. This is the single continuous shape every weight is cut from; only the
// (onset, full) window differs, which is what makes one weight "earlier" than
// another without any of them being a step function.
function band(depthKm: number, onsetKm: number, fullKm: number): number {
  const t = clamp01((depthKm - onsetKm) / (fullKm - onsetKm));
  return t * t * (3 - 2 * t);
}

// THE fan-out. Pure function of escape_depth (meters). Each weight is the same
// smoothstep over its own onset→full window, so the whole struct is one curve
// read at nine offsets.
export function voidDistortion(escapeDepthMeters: number): VoidDistortion {
  const km = Math.max(0, escapeDepthMeters) / 1000;
  return {
    skyDrift: band(km, 4, 45),
    roadRepeat: band(km, 22, 70),
    spawnWeird: band(km, 22, 80),
    trafficFlip: band(km, 45, 95),
    npcOrientCorrupt: band(km, 48, 100),
    awarenessGlitch: band(km, 70, 130),
    instrumentLie: band(km, 70, 130),
    controlInvert: band(km, 95, 150),
    // Dialogue corruption rides the whole descent: lucid near the city, looping
    // and unhinged the deeper you go (the Spun monologue texture, §8).
    dialogCorrupt: band(km, 8, 150),
  };
}

// Seeded, never random (discipline #3). Integer-mix hash → a reproducible
// pseudo-random in [0,1) keyed on (coords, salt). Required so the treadmill's
// "inconsistency" and the recurring-doppelganger tell are FAIR and replay on the
// same seed (V30 f(seed,t,log)). Defined here so seam 2+ consumers share ONE
// hash with the shell generator instead of re-rolling Math.random.
export function voidHash(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
