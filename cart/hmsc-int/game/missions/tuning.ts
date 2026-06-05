// game/missions/tuning.ts — every mission knob (P2). THE PRICING LAW (V22):
// "the LLM never touches numbers — tuning tables price the gig; the platform
// diegetically reprices the client's offer." A CaaS row arrives with ZERO
// numeric fields; everything money/time/penalty-shaped resolves from THESE
// tables at missionFromRow time. Authored mission tables carry their own
// numbers directly (a table IS P2 data); rows may not.
//
// No reference implements mission pricing anywhere in the corpus — values
// are FIRST-CUT P2 starting points for editors/tuning, flagged in CAPTURE.md.

import type { ActivityVerb } from '../activities';

export const MISSION_TUNING = Object.freeze({
  /** cash a CaaS row pays, by verb — the gig pricer (the LLM never sets pay) */
  pricing: Object.freeze({
    role: 120,
    rob: 320,
    chase: 260,
    evade: 240,
    race: 250,
    jump: 180,
    accumulate: 200,
  }) as Readonly<Record<ActivityVerb, number>>,

  /** expiry SEMANTICS a row may name → state ticks (V8 cadence; null = never).
   *  'daily' is first-cut (no ruled day length): 2700 ticks = one wall hour. */
  expiry: Object.freeze({
    daily: 2700,
    persistent: null,
  }) as Readonly<Record<string, number | null>>,

  /** collateral POLICIES a row may name (V22: civilian kills dock the rating) */
  collateral: Object.freeze({
    none: Object.freeze({ ratingDeltaPerCivilianKill: 0 }),
    standard: Object.freeze({ ratingDeltaPerCivilianKill: 1 }),
    strict: Object.freeze({ ratingDeltaPerCivilianKill: 2 }),
  }) as Readonly<Record<string, { ratingDeltaPerCivilianKill: number }>>,

  /** the CaaS rating scale — a run starts at base, collateral docks toward min */
  rating: Object.freeze({ base: 5, min: 0 }),

  /** how close "reach" is — world meters (the perception {x,z} convention) */
  reachRadiusMeters: 2,

  /** the no-doubles-for-narrative window (V22): a row whose embedding
   *  fingerprint is ≥ threshold cosine-similar to any of the last `window`
   *  rows (or shares a seed) is a duplicate */
  dedup: Object.freeze({ threshold: 0.92, window: 32 }),

  /** the briefing seam onto the V16 clock: rig must exist in CAMERA_RIGS */
  briefing: Object.freeze({ rig: 'Cinematic', lineSeconds: 3 }),
});
