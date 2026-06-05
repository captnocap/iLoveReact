// game/chance.ts — GAME_CHANCE: the ONE odds engine (V9, the ruled hybrid).
//
// scape's ChanceBreakdown legibility (WHY is it 33%? — every factor is a named
// multiplier on base, `final` is their clamped product) married to hmsc /
// combat_lab's CONTINUOUS coverFraction input (0..1 occlusion of the target's
// own body samples, not a binary "behind a prop" flag).
//
// THE GROUND-TRUTH LAW (ruled, twice): this module computes REAL odds and
// physically cannot see the perception layer. Any display warp (the "perceived"
// % a high player reads) lives in game/perception.ts and reads FROM here —
// never recompute odds anywhere else, never import perception here.
//
// THE ASYMMETRIC-COMBAT THESIS (recurring pattern): player shots are skill
// (aim, a geometric ray — not this module); INCOMING and NPC↔NPC shots are
// odds (exposure management, dice — this module). rollZone exists only for
// shots resolved by chance; the player's ray picks its zone geometrically.
//
// EVERY CURVE IS DATA (P2): CHANCE_TUNING is the single tuning table. V9's own
// caveat applies — the numbers need a dedicated lab before they're trusted;
// the table is where that lab turns its knobs.
//
// Fresh capture (V17-TRIAGE) of cart/scape/systems/chance.ts (the surface),
// cart/hmsc/npc/systems/chance.ts (the cover input + dice), and the pure half
// of combat_lab's coverFractionOf (the sample-fold + bone-sample spec).
// Behavior references only — read, never imported. Producers stay outside:
// tile-grid LoS classification is world territory, bone-sample raycasting is
// figure/world territory; this engine consumes their outputs.

// ── inputs ───────────────────────────────────────────────────────────────────

// Line-of-sight quality, as classified by a world-side producer:
//   clear   — nothing between
//   glass   — exactly one facade wall (a window shot, penalised)
//   partial — a tile-level obstruction (prop) the producer could not express
//             as a coverFraction; the engine folds it into the cover channel
//   none    — solid wall / closed door: no shot
export type LosQuality = 'clear' | 'glass' | 'partial' | 'none';

// A weapon's ballistic profile — lives on the weapon item, drives the range
// and glass factors. Null = bare attack (the no-profile defaults apply).
export type RangeProfile = {
  baseAccuracy: number;   // 0..1 at optimal range, clear LoS
  optimalRange: number;   // meters (1 tile = 1 meter)
  falloffPerMeter: number;// accuracy lost per meter away from optimal
  maxRange: number;       // beyond this the attack is unavailable (final 0)
  glassPenalty: number;   // 0..1 multiplier when firing through a window
};

export type ShooterAwareness = 'unaware' | 'alert' | 'fleeing';

export type AttackInput = {
  profile: RangeProfile | null;
  ranged: boolean;
  distanceMeters: number;
  los: LosQuality;
  // THE hmsc input: 0 fully exposed .. 1 fully occluded, from a sample-based
  // producer (coverFractionFromSamples over bone samples). Cover cuts odds by
  // up to CHANCE_TUNING.cover.maxCut.
  coverFraction: number;
  targetCrouched?: boolean;
  shooter: {
    skill01: number;     // 0..1 combat skill
    health01: number;    // 0..1 — low HP = shaky aim
    hour: number;        // 0..23 — night penalises ranged sight
    awareness: ShooterAwareness; // the TARGET's awareness of the shooter
  };
};

// The legible breakdown behind one % — the scape surface, plus the `stance`
// factor the hmsc reference contributes. Each field is a multiplier on `base`;
// `final` is their clamped product. GROUND TRUTH — what a menu DISPLAYS may be
// warped by the perception layer; these numbers never are.
export type ChanceBreakdown = {
  base: number;       // weapon base accuracy (or the bare-attack default)
  range: number;      // × distance law (profile triangle / default bleed / melee reach)
  los: number;        // × clear / glass / none (partial routes via cover)
  cover: number;      // × 1 - coverFraction·maxCut — the hmsc continuous law
  stance: number;     // × crouched target
  awareness: number;  // × unaware (bonus) vs alert/fleeing (penalty)
  health: number;     // × shooter's condition
  time: number;       // × night penalises ranged
  skill: number;      // × shooter skill
  final: number;      // clamped product, 0..1 (a true 0 stays 0)
};

// Where a landed probabilistic shot strikes (chance-resolved shots only).
export type DamageZone = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

// ── THE TUNING TABLE (P2: the data, the lab's knob surface) ──────────────────

export const CHANCE_TUNING = {
  // Bare-attack base accuracy when no weapon profile applies (scape default).
  defaultBaseAccuracy: 0.6,
  // Melee connects only at adjacency (scape's 1.8 tile-meters).
  meleeReachMeters: 1.8,
  // LoS multipliers. glass is the no-profile default — a weapon's own
  // glassPenalty wins when a profile is present. partial is 1 here because a
  // partial LoS contributes through the COVER channel (see partialLosCoverFraction).
  losMult: { clear: 1, glass: 0.5, partial: 1, none: 0 },
  // The legacy-equivalence constant: scape's binary "partial → ×0.65 cover"
  // expressed in the hmsc cover law (1 − f·maxCut = 0.65 → f = 0.4375). A
  // tile-only producer that can't sample bones still prices its props right.
  partialLosCoverFraction: 0.4375,
  // The hmsc cover law: full cover cuts odds by this much (never more).
  cover: { maxCut: 0.8 },
  // A crouched target is harder to hit (hmsc).
  stance: { crouchedTargetMult: 0.7 },
  // The TARGET's awareness of the shooter (scape): an unaware mark is a bonus.
  awarenessMult: { unaware: 1.15, alert: 0.7, fleeing: 0.5 },
  // Shooter condition: low HP = shaky aim (scape: 0.7 + 0.3·health01).
  health: { floor: 0.7, spread: 0.3 },
  // Night penalises RANGED sight only; melee doesn't care about the dark.
  night: { rangedMult: 0.82, startHour: 20, endHour: 6 },
  // Shooter skill multiplier (scape: 0.6 + 0.8·skill01).
  skill: { floor: 0.6, spread: 0.8 },
  // Profile-driven range law (scape): a triangle around optimalRange that
  // never drops below this floor inside maxRange.
  profileRangeFloor: 0.2,
  // No-profile ranged falloff (the hmsc curve): full effect inside
  // fullEffectMeters, bleeding linearly to zero at zeroAtMeters (4 + 36 = 40m).
  defaultRangedFalloff: { fullEffectMeters: 4, zeroAtMeters: 40 },
  // Never quite certain, never quite hopeless — but a true 0 stays 0 (scape).
  finalClamp: { min: 0.02, max: 0.98 },
  // Zone pick for chance-resolved shots: the AI aims center mass (hmsc).
  zoneWeights: [
    { zone: 'torso' as DamageZone, weight: 0.5 },
    { zone: 'legL' as DamageZone, weight: 0.12 },
    { zone: 'legR' as DamageZone, weight: 0.12 },
    { zone: 'armL' as DamageZone, weight: 0.09 },
    { zone: 'armR' as DamageZone, weight: 0.09 },
    { zone: 'head' as DamageZone, weight: 0.08 },
  ],
} as const;

// The cover producer's sample spec (combat_lab): points riding the TARGET'S
// OWN bones — head double-weighted (it's the part that peeks over cover),
// then shoulders, torso, pelvis, thighs, a shin. Riding bones (not fixed
// heights) is the whole trick: a crouched skeleton's samples come down with
// it. The figure system casts the rays; this table is the contract.
export const COVER_SAMPLE_SPEC = [
  { bone: 'head', liftMeters: 0.12 },
  { bone: 'head', liftMeters: 0 },
  { bone: 'lShoulder', liftMeters: 0 },
  { bone: 'rShoulder', liftMeters: 0 },
  { bone: 'torso', liftMeters: 0 },
  { bone: 'pelvis', liftMeters: 0 },
  { bone: 'lThigh', liftMeters: 0 },
  { bone: 'rThigh', liftMeters: 0 },
  { bone: 'lShin', liftMeters: 0 },
] as const;

// ── the engine ───────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

// Fold a producer's sample results into the coverFraction the engine wants:
// blocked / total (empty → 0, fully exposed). The pure half of combat_lab's
// coverFractionOf — the geometric caster stays with the figure/world systems.
export function coverFractionFromSamples(samples: ReadonlyArray<{ clear: boolean }>): number {
  if (samples.length === 0) return 0;
  const blocked = samples.reduce((count, s) => count + (s.clear ? 0 : 1), 0);
  return blocked / samples.length;
}

function rangeFactor(input: AttackInput): { factor: number; unavailable: boolean } {
  const T = CHANCE_TUNING;
  if (!input.ranged) {
    // Melee: adjacency is the whole range law.
    return { factor: input.distanceMeters <= T.meleeReachMeters ? 1 : 0, unavailable: false };
  }
  if (input.profile) {
    // The weapon's triangle around its optimal range (scape).
    if (input.distanceMeters > input.profile.maxRange) return { factor: 0, unavailable: true };
    const falloff = Math.abs(input.distanceMeters - input.profile.optimalRange) * input.profile.falloffPerMeter;
    return { factor: clamp(1 - falloff, T.profileRangeFloor, 1), unavailable: false };
  }
  // Bare ranged attack: the hmsc bleed — full inside the plateau, ~0 at the end.
  const { fullEffectMeters, zeroAtMeters } = T.defaultRangedFalloff;
  const factor = clamp01(1 - Math.max(0, input.distanceMeters - fullEffectMeters) / (zeroAtMeters - fullEffectMeters));
  return { factor, unavailable: false };
}

function nightTime(hour: number): boolean {
  const { startHour, endHour } = CHANCE_TUNING.night;
  return hour >= startHour || hour < endHour;
}

// THE engine. Ground-truth probability an attack connects, with the legible
// breakdown that explains it. A shot with no line of sight, out of max range,
// or out of melee reach resolves to a TRUE 0 (a menu greys it); anything
// possible is clamped into [finalClamp.min, finalClamp.max].
export function attackChance(input: AttackInput): ChanceBreakdown {
  const T = CHANCE_TUNING;

  const base = input.profile ? input.profile.baseAccuracy : T.defaultBaseAccuracy;
  const { factor: range, unavailable } = rangeFactor(input);

  // LoS factor: melee ignores sight; glass uses the weapon's own penalty when
  // it has one; partial contributes through cover, not here.
  const los = !input.ranged
    ? 1
    : input.los === 'glass' && input.profile
      ? input.profile.glassPenalty
      : T.losMult[input.los];

  // The hmsc cover law over the CONTINUOUS fraction. A tile-level 'partial'
  // LoS guarantees at least the legacy prop-cover pricing — max(), never
  // double-counted against a real sampled fraction.
  const effectiveCover = Math.max(
    clamp01(input.coverFraction),
    input.los === 'partial' ? T.partialLosCoverFraction : 0,
  );
  const cover = 1 - effectiveCover * T.cover.maxCut;

  const stance = input.targetCrouched ? T.stance.crouchedTargetMult : 1;
  const awareness = T.awarenessMult[input.shooter.awareness];
  const health = T.health.floor + T.health.spread * clamp01(input.shooter.health01);
  const time = input.ranged && nightTime(input.shooter.hour) ? T.night.rangedMult : 1;
  const skill = T.skill.floor + T.skill.spread * clamp01(input.shooter.skill01);

  let final = base * range * los * cover * stance * awareness * health * time * skill;
  if (unavailable || (input.ranged && input.los === 'none')) final = 0;
  final = final <= 0 ? 0 : clamp(final, T.finalClamp.min, T.finalClamp.max);

  return { base, range, los, cover, stance, awareness, health, time, skill, final };
}

// ── dice (rng is INJECTED so outcomes are deterministic under a seed) ────────

export function rollHit(chance: number, rng: () => number = Math.random): boolean {
  return rng() < chance;
}

// Zone pick for a landed chance-resolved shot (center mass overwhelmingly
// likely). The player's aim ray never calls this — it picks geometrically.
export function rollZone(rng: () => number = Math.random): DamageZone {
  const weights = CHANCE_TUNING.zoneWeights;
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = rng() * total;
  for (const entry of weights) {
    pick -= entry.weight;
    if (pick <= 0) return entry.zone;
  }
  return 'torso';
}

// A tiny deterministic rng (mulberry32) for tests, replays, and the tuning
// lab — same seed, same fight.
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_CHANCE = {
  attackChance,
  rollHit,
  rollZone,
  coverFractionFromSamples,
  seededRng,
  tuning: CHANCE_TUNING,
  coverSampleSpec: COVER_SAMPLE_SPEC,
} as const;
