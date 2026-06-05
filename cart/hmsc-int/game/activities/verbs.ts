// game/activities/verbs — the V22 verb space as DATA (P2). "Game modes are
// distribution presets. SAMP/VCMP's 15 years A/B-tested the verb space: role,
// rob, chase, evade, race, jump, accumulate. Each is a conditioning preset of
// the V21 machine, not a new system."
//
// THE FENCE: the V21 population machine (archetype distributions, token
// dictionaries, the heat/wanted conditioning column) is ANOTHER lane's
// capture. These records only NAME what a mode dials — the field vocabulary
// is drawn from V21's own ruling text ("cops up, civilians to zero,
// convergence bias, promotion budget; temperature per archetype/district/hour
// is a P2 knob") and the V21 machine OWNS interpretation when it lands.
// Nothing here simulates anything.
//
// No reference implements these presets anywhere in the corpus — the values
// are P2 starting points for editors/tuning, flagged as such in CAPTURE.md.

export type ActivityVerb =
  | 'role'
  | 'rob'
  | 'chase'
  | 'evade'
  | 'race'
  | 'jump'
  | 'accumulate';

/**
 * What a mode dials on the V21 machine. Multipliers sit at 1 for neutral;
 * biases sit at 0. The machine applies them to its own knobs — a preset is a
 * REQUEST in V21's ruled vocabulary, never a second simulation.
 */
export type DistributionPreset = {
  /** multiplier on the cop archetype's distribution weight ("cops up") */
  copWeight: number;
  /** multiplier on the civilian archetype's weight ("civilians to zero") */
  civilianWeight: number;
  /** multiplier on ambient vehicle/traffic token weight */
  trafficWeight: number;
  /** added to V21's per-archetype/district/hour temperature knob */
  temperatureBias: number;
  /** bias toward token choices that converge on the player ("convergence bias") */
  convergenceBias: number;
  /** multiplier on the identity-promotion budget */
  promotionBudgetWeight: number;
};

export type ActivityVerbDefinition = {
  verb: ActivityVerb;
  label: string;
  /** what the verb IS — one line, the SAMP/VCMP-tested meaning */
  summary: string;
  preset: DistributionPreset;
};

const NEUTRAL_PRESET: DistributionPreset = {
  copWeight: 1,
  civilianWeight: 1,
  trafficWeight: 1,
  temperatureBias: 0,
  convergenceBias: 0,
  promotionBudgetWeight: 1,
};

/** The ruled verb space, in V22's own order. THE TABLE IS THE DATA (P2). */
export const ACTIVITY_VERB_DEFINITIONS: Record<ActivityVerb, ActivityVerbDefinition> = {
  // Free-form roleplay — the baseline world, nothing dialed.
  role: {
    verb: 'role',
    label: 'Role',
    summary: 'Inhabit a position in the world as it is — the neutral preset.',
    preset: { ...NEUTRAL_PRESET },
  },
  // Robbery wants marks on the street and consequences nearby.
  rob: {
    verb: 'rob',
    label: 'Rob',
    summary: 'Take from the world; the world is allowed to notice.',
    preset: { ...NEUTRAL_PRESET, copWeight: 1.25, civilianWeight: 1.2, promotionBudgetWeight: 1.25 },
  },
  // The player hunts a target — the world thickens toward the chase line.
  chase: {
    verb: 'chase',
    label: 'Chase',
    summary: 'Pursue a fleeing target through live traffic.',
    preset: { ...NEUTRAL_PRESET, trafficWeight: 1.2, convergenceBias: 0.3, temperatureBias: 0.15 },
  },
  // The world hunts the player — cops up, civilians thin out, everything converges.
  evade: {
    verb: 'evade',
    label: 'Evade',
    summary: 'Shake pursuit; survive the heat you earned.',
    preset: { ...NEUTRAL_PRESET, copWeight: 2.0, civilianWeight: 0.4, convergenceBias: 0.6, promotionBudgetWeight: 1.5 },
  },
  // Clear-ish roads, checkpoint discipline.
  race: {
    verb: 'race',
    label: 'Race',
    summary: 'Checkpoints against the clock.',
    preset: { ...NEUTRAL_PRESET, trafficWeight: 0.6, copWeight: 1.1 },
  },
  // Stunt verbs want empty air and ramps, not congestion.
  jump: {
    verb: 'jump',
    label: 'Jump',
    summary: 'The stunt — air off geometry, the apex verb of the cold open.',
    preset: { ...NEUTRAL_PRESET, trafficWeight: 0.5 },
  },
  // The earn loop — customers exist, the world stays calm enough to work.
  accumulate: {
    verb: 'accumulate',
    label: 'Accumulate',
    summary: 'The repeatable earn — grind a loop, bank the payout.',
    preset: { ...NEUTRAL_PRESET, civilianWeight: 1.3, temperatureBias: -0.1 },
  },
};

/** The seven ruled verbs, V22's order. */
export const ACTIVITY_VERBS: readonly ActivityVerb[] = Object.freeze([
  'role', 'rob', 'chase', 'evade', 'race', 'jump', 'accumulate',
]) as readonly ActivityVerb[];

for (const verb of ACTIVITY_VERBS) {
  Object.freeze(ACTIVITY_VERB_DEFINITIONS[verb].preset);
  Object.freeze(ACTIVITY_VERB_DEFINITIONS[verb]);
}
Object.freeze(ACTIVITY_VERB_DEFINITIONS);

export function isActivityVerb(value: unknown): value is ActivityVerb {
  return typeof value === 'string' && (ACTIVITY_VERBS as readonly string[]).includes(value);
}
