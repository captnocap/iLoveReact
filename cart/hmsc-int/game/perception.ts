// game/perception.ts — GAME_PERCEPTION: the awareness ladder + consequence
// hooks (V12, the ruled detective loop).
//
// ONE LOOP, TWO ENDS, ONE LIE:
// • The PRODUCER is combat_lab's Hitman-style awareness ladder — vision is a
//   forward FoV cone gated by exposure, hearing is omnidirectional tile-noise
//   rings, a 0..1 suspicion accumulator climbs calm → spooked (freeze, face
//   it) → alert (investigate) → the kind's terminal state (fighters HOSTILE,
//   the unarmed PANIC and run to notify), stimulus vs lastKnown stay distinct
//   (a glimpse moves the stimulus; only a CONFIRMED sighting, gunshot,
//   report, or being shot sets lastKnown — break line of sight and they hunt
//   a memory, not you).
// • The CONSUMERS are scape's consequence vocabulary — WitnessMemory, the
//   Case (the world's lagging belief), the five-axis Suspicion vector and its
//   notoriety blend. Story / missions / dialog feed on the HOOKS: every rung
//   of the ladder comes back as an event from the pure step — INERT BY
//   DESIGN: returned data, dispatched by no one until those systems land.
// • The DISPLAY WARP is scape's perceivedChance — the manic UI lie. It reads
//   ground truth (a number from GAME_CHANCE) and warps what's SHOWN; it never
//   touches the dice. The ground-truth law's other half lives here, which is
//   why chance.ts physically cannot import this module — and this module
//   computes no odds of its own.
//
// EVERY CURVE IS DATA (P2): PERCEPTION_TUNING is the single knob surface.
//
// Fresh capture (V17-TRIAGE) of cart/combat_lab/index.tsx (the ladder, the
// noise model — behavior reference; its inline sim loop is not importable),
// cart/scape/design.ts (the consequence types), cart/scape/state/player.ts
// (computeNotoriety, fidelity-swept), and cart/scape/systems/perception.ts
// (perceivedChance/optimismBias, fidelity-swept). References untouched.
// Geometry producers stay outside: bone-sample exposure comes from the figure
// system through GAME_CHANCE's coverFraction contract; this module consumes
// the resulting exposure number.

import type { NpcPerceptionProfile } from './kinds';

// ── THE TUNING TABLE (P2) ─────────────────────────────────────────────────────

export const PERCEPTION_TUNING = {
  ladder: {
    // The suspicion thresholds (the ruled 0.33 / 0.66 / 1.0 ladder).
    spookedAt: 0.33,
    alertAt: 0.66,
    confirmedAt: 1.0,
    // Dwell timers — how long a rung holds before it may relax.
    spookedDwellSeconds: 1.4,
    alertDwellSeconds: 2.5,
    panicDwellSeconds: 8,
    // Relax gates: a rung returns to calm only past its dwell AND below these.
    spookedCalmBelow: 0.3,
    alertCalmBelow: 0.2,
    // Unstimulated suspicion bleeds off at this rate per second.
    decayPerSecond: 0.12,
    // Losing a hunted trail drops hostile → alert at this suspicion + dwell.
    lostTrailSuspicion: 0.6,
    lostTrailDwellSeconds: 3,
    // Suspicion fills at exposure × proximity / reactionSeconds, where
    // proximity = base − slope·(range/visionRange): point-blank in the open
    // is near-instant, a distant glimpse takes seconds.
    proximityBase: 1.15,
    proximitySlope: 0.75,
    // Below this exposure the viewer does not count as seeing the target.
    seeingExposureMin: 0.1,
  },
  hearing: {
    // Footstep carry by movement mode; the emitting tile's npc.noise scales
    // the RADIUS (sneak the mud, not the road). stepSeconds is the emit cadence.
    footsteps: {
      run: { radiusMeters: 16, salience: 0.5, stepSeconds: 0.32 },
      walk: { radiusMeters: 8, salience: 0.3, stepSeconds: 0.5 },
      crouch: { radiusMeters: 3.5, salience: 0.18, stepSeconds: 0.65 },
    },
    // A gunshot is the loudest stimulus there is — tile noise does NOT quiet
    // a muzzle blast, and salience 1 maxes suspicion outright.
    gunshot: { radiusMeters: 40, salience: 1 },
  },
  social: {
    // A thug going loud shouts to gang within this radius (consumer rule —
    // the AI layer applies it off the 'hostile' hook).
    gangShoutRadiusMeters: 14,
    // A notifying civilian delivers its report within this range of an officer.
    notifyDeliverRadiusMeters: 2.4,
  },
  // The perception→chance seam (closes the chance capture's surfaced item 3):
  // the ladder's mode IS the target-awareness input scape's surface wants.
  // calm = unaware (the Hitman bonus); engaged/investigating rungs = alert;
  // the fleeing rungs = fleeing (a runner is the hardest target).
  chanceAwareness: {
    calm: 'unaware',
    spooked: 'alert',
    alert: 'alert',
    hostile: 'alert',
    panic: 'fleeing',
    notify: 'fleeing',
  } as const,
  witness: {
    // FIRST CUT (surfaced, unruled): certainty of a witness memory from how
    // well and how close they saw it — exposure × (1 − penalty·rangeFraction).
    // scape designs "certainty from distance / fov / lighting" with no
    // reference implementation; the V12 tooling lab owns the real curve.
    certaintyRangePenalty: 0.6,
    // FIRST CUT: how a reported witness memory heats the Case's visual axis
    // (suspicion points per certainty-1.0 report; axes are 0..100).
    visualHeatPerReport: 12,
    // FIRST CUT: signature-match weights (silhouette / color / accessory).
    signatureWeights: { silhouette: 0.4, color: 0.35, accessory: 0.25 },
  },
  // Notoriety = weighted blend of the five axes, normalised 0..100 (scape
  // verbatim): visual heat hurts most (you were SEEN), funny-money traces slow.
  suspicionWeights: { visual: 1.5, fund: 0.8, pattern: 1.0, digital: 1.0, location: 1.0 },
  // The delusional display warp (scape verbatim):
  //   P_perceived = clamp(P_true·(1 − h/dampen) + δ(h) + sin(ω·t)·(h/jitter), 0, 1)
  //   δ(h) = optimismScale·((h − optimismStartsAt)/optimismSpan)² past the line
  warp: {
    flickerOmega: 16,      // rad/s — the frantic UI jitter under high
    soberBelow: 0.5,       // h at or under this returns the truth unchanged
    dampenDivisor: 150,
    jitterDivisor: 100,
    optimismStartsAt: 60,  // the tweaking line
    optimismSpan: 40,
    optimismScale: 0.5,
  },
} as const;

// ── the producer: the awareness ladder ───────────────────────────────────────

export type AwarenessMode = 'calm' | 'spooked' | 'alert' | 'hostile' | 'panic' | 'notify';

export type WorldPoint = { x: number; z: number };

export type PerceiverState = {
  mode: AwarenessMode;
  suspicion: number;              // 0..1 accumulator
  stimulus: WorldPoint | null;    // where to look/investigate (sound, glimpse, report)
  lastKnown: WorldPoint | null;   // last CONFIRMED target position — never live-tracked
  modeUntilSeconds: number;       // dwell timer (spooked pause, alert scan, panic cooldown)
};

export type NoiseStimulus = {
  position: WorldPoint;
  radiusMeters: number;           // already tile-scaled by the EMITTER (footstepNoise)
  salience: number;               // 0..1 suspicion bump for non-shot noises
  kind: 'step' | 'shot';
};

export type SightInput = {
  visible: boolean;               // in cone + in range (inVisionCone)
  exposure: number;               // 0..1 = 1 − coverFraction (the chance contract)
  rangeMeters: number;
  position: WorldPoint;           // where the target actually is
};

export type PerceptionStepInput = {
  sight?: SightInput | null;
  noises?: ReadonlyArray<NoiseStimulus>;
  report?: { position: WorldPoint } | null;  // a confirmed position handed over (the notify)
  damage?: { position: WorldPoint } | null;  // got shot: total awareness
  dtSeconds: number;
  nowSeconds: number;
};

export type PerceiverContext = {
  profile: NpcPerceptionProfile;
  canFight: boolean;              // terminal-state selector: hostile vs panic
};

// The consequence hooks. Every rung of the ladder comes back as one of these;
// story/missions/the Case subscribe LATER — until then they are inert returned
// data (nothing dispatches them), which is the explicit choice: a pure return
// cannot silently half-fire.
export type PerceptionEvent =
  | { type: 'spooked'; at: WorldPoint | null }
  | { type: 'alerted'; at: WorldPoint | null }
  | { type: 'hostile'; at: WorldPoint | null }
  | { type: 'panicked'; at: WorldPoint | null }
  | { type: 'sightingConfirmed'; at: WorldPoint }
  | { type: 'lostTrail'; at: WorldPoint | null }
  | { type: 'calmed' };

export function calmPerceiver(): PerceiverState {
  return { mode: 'calm', suspicion: 0, stimulus: null, lastKnown: null, modeUntilSeconds: 0 };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

// Vision is a forward FoV cone at a per-kind range — no eyes in the back of
// the head. Pure geometry; exposure (cover sampling) gates it separately.
export function inVisionCone(
  viewer: { position: WorldPoint; headingDegrees: number },
  target: WorldPoint,
  profile: NpcPerceptionProfile,
): { inCone: boolean; rangeMeters: number } {
  const dx = target.x - viewer.position.x;
  const dz = target.z - viewer.position.z;
  const rangeMeters = Math.hypot(dx, dz);
  if (rangeMeters >= profile.visionRangeMeters) return { inCone: false, rangeMeters };
  const rad = (viewer.headingDegrees * Math.PI) / 180;
  const facingX = Math.sin(rad);
  const facingZ = Math.cos(rad);
  const coneCos = Math.cos(((profile.visionFovDegrees / 2) * Math.PI) / 180);
  const towardCos = rangeMeters > 1e-4 ? (facingX * dx + facingZ * dz) / rangeMeters : 1;
  return { inCone: towardCos >= coneCos, rangeMeters };
}

// Suspicion fill per second while seeing: exposure × proximity / reactionSeconds.
// reactionSeconds is the kind's point-blank fully-exposed baseline.
export function suspicionFillPerSecond(
  exposure: number,
  rangeMeters: number,
  profile: NpcPerceptionProfile,
): number {
  const T = PERCEPTION_TUNING.ladder;
  const proximity = T.proximityBase - T.proximitySlope * (rangeMeters / profile.visionRangeMeters);
  return (clamp01(exposure) * proximity) / profile.reactionSeconds;
}

// Hearing is omnidirectional: a noise reaches this listener when its (already
// tile-scaled) carry radius × the listener's acuity covers the distance.
export function noiseAudible(
  noise: NoiseStimulus,
  listener: WorldPoint,
  hearingAcuity: number,
): boolean {
  const d = Math.hypot(noise.position.x - listener.x, noise.position.z - listener.z);
  return d <= noise.radiusMeters * hearingAcuity;
}

export type MovementMode = 'run' | 'walk' | 'crouch';

// A footstep's noise event: the movement mode sets carry + cadence, the tile
// underfoot scales the RADIUS (kinds' npc.noise — sneak the mud, not the road).
export function footstepNoise(
  mode: MovementMode,
  position: WorldPoint,
  tileNoise01: number,
): NoiseStimulus {
  const spec = PERCEPTION_TUNING.hearing.footsteps[mode];
  return {
    position,
    radiusMeters: spec.radiusMeters * clamp01(tileNoise01),
    salience: spec.salience,
    kind: 'step',
  };
}

export function footstepCadenceSeconds(mode: MovementMode): number {
  return PERCEPTION_TUNING.hearing.footsteps[mode].stepSeconds;
}

// A gunshot: fixed carry, max salience — tile noise does not quiet a muzzle blast.
export function gunshotNoise(position: WorldPoint): NoiseStimulus {
  const spec = PERCEPTION_TUNING.hearing.gunshot;
  return { position, radiusMeters: spec.radiusMeters, salience: spec.salience, kind: 'shot' };
}

// THE LADDER. One perception step: fill from sight, hear fresh noises, take
// reports and hits, decay if unstimulated, then climb the thresholds. The
// threshold cascade is deliberately sequential — one overwhelming stimulus can
// run calm → spooked → alert → hostile in a single step, exactly like the
// reference. Returns the next state plus the consequence-hook events.
export function perceptionStep(
  state: PerceiverState,
  input: PerceptionStepInput,
  ctx: PerceiverContext,
): { state: PerceiverState; events: PerceptionEvent[] } {
  const T = PERCEPTION_TUNING.ladder;
  const events: PerceptionEvent[] = [];
  const next: PerceiverState = { ...state };
  const now = input.nowSeconds;
  let stimulated = false;

  const terminal = (at: WorldPoint | null) => {
    if (ctx.canFight) {
      if (next.mode !== 'hostile') {
        next.mode = 'hostile';
        events.push({ type: 'hostile', at });
      }
    } else if (next.mode !== 'panic' && next.mode !== 'notify') {
      next.mode = 'panic';
      next.modeUntilSeconds = now + T.panicDwellSeconds;
      events.push({ type: 'panicked', at });
    }
  };

  // ── PERCEIVE: sight fills suspicion with exposure × proximity ─────────────
  const sight = input.sight ?? null;
  if (sight && sight.visible && sight.exposure > T.seeingExposureMin) {
    next.suspicion = clamp01(
      next.suspicion + suspicionFillPerSecond(sight.exposure, sight.rangeMeters, ctx.profile) * input.dtSeconds,
    );
    next.stimulus = { ...sight.position };
    stimulated = true;
    if (next.suspicion >= T.confirmedAt) {
      const wasConfirmed = next.lastKnown !== null
        && next.lastKnown.x === sight.position.x && next.lastKnown.z === sight.position.z;
      next.lastKnown = { ...sight.position };
      if (!wasConfirmed) events.push({ type: 'sightingConfirmed', at: { ...sight.position } });
    }
  }

  // ── PERCEIVE: hearing (the caller pre-filters with noiseAudible) ──────────
  for (const noise of input.noises ?? []) {
    next.stimulus = { ...noise.position };
    stimulated = true;
    if (noise.kind === 'shot') {
      next.suspicion = 1;
      if (ctx.canFight) {
        // fighters triangulate the shot and go straight to combat
        next.lastKnown = { ...noise.position };
      }
      terminal({ ...noise.position });
    } else {
      next.suspicion = clamp01(next.suspicion + noise.salience);
    }
  }

  // ── PERCEIVE: a report hands over a CONFIRMED position (the notify) ───────
  if (input.report) {
    next.suspicion = 1;
    next.lastKnown = { ...input.report.position };
    next.stimulus = { ...input.report.position };
    stimulated = true;
    terminal({ ...input.report.position });
  }

  // ── PERCEIVE: getting shot is total awareness ─────────────────────────────
  if (input.damage) {
    next.suspicion = 1;
    next.lastKnown = { ...input.damage.position };
    next.stimulus = { ...input.damage.position };
    stimulated = true;
    terminal({ ...input.damage.position });
  }

  // ── unstimulated suspicion bleeds off ─────────────────────────────────────
  if (!stimulated) {
    next.suspicion = Math.max(0, next.suspicion - T.decayPerSecond * input.dtSeconds);
  }

  // ── ESCALATE: sequential thresholds — a big spike climbs every rung now ───
  if (next.mode === 'calm' && next.suspicion >= T.spookedAt) {
    next.mode = 'spooked';
    next.modeUntilSeconds = now + T.spookedDwellSeconds;
    events.push({ type: 'spooked', at: next.stimulus ? { ...next.stimulus } : null });
  }
  if (next.mode === 'spooked') {
    if (next.suspicion >= T.alertAt) {
      next.mode = 'alert';
      next.modeUntilSeconds = now + T.alertDwellSeconds;
      events.push({ type: 'alerted', at: next.stimulus ? { ...next.stimulus } : null });
    } else if (now > next.modeUntilSeconds && next.suspicion < T.spookedCalmBelow) {
      next.mode = 'calm';
      events.push({ type: 'calmed' });
    }
  }
  if (next.mode === 'alert') {
    if (next.suspicion >= T.confirmedAt) {
      if (ctx.canFight) {
        next.mode = 'hostile';
        next.lastKnown = next.lastKnown ?? (next.stimulus ? { ...next.stimulus } : null);
        events.push({ type: 'hostile', at: next.lastKnown ? { ...next.lastKnown } : null });
      } else {
        next.mode = 'panic';
        next.modeUntilSeconds = now + T.panicDwellSeconds;
        events.push({ type: 'panicked', at: next.stimulus ? { ...next.stimulus } : null });
      }
    } else if (next.suspicion < T.alertCalmBelow && now > next.modeUntilSeconds) {
      next.mode = 'calm';
      events.push({ type: 'calmed' });
    }
  }

  return { state: next, events };
}

// A hostile that reaches its lastKnown and finds nothing loses the trail:
// drop to alert at the tuned suspicion, scan, and let the ladder decide.
export function loseTrail(
  state: PerceiverState,
  nowSeconds: number,
): { state: PerceiverState; events: PerceptionEvent[] } {
  const T = PERCEPTION_TUNING.ladder;
  const at = state.lastKnown ? { ...state.lastKnown } : null;
  return {
    state: {
      ...state,
      mode: 'alert',
      suspicion: T.lostTrailSuspicion,
      lastKnown: null,
      modeUntilSeconds: nowSeconds + T.lostTrailDwellSeconds,
    },
    events: [{ type: 'lostTrail', at }],
  };
}

// The perception→chance seam: the ladder's mode IS the target-awareness input
// the chance surface wants (closes the chance capture's surfaced item 3).
export type ChanceAwareness = 'unaware' | 'alert' | 'fleeing';

export function awarenessForChance(mode: AwarenessMode): ChanceAwareness {
  return PERCEPTION_TUNING.chanceAwareness[mode];
}

// ── the consumers: scape's consequence vocabulary ────────────────────────────
// Design-only in the reference (the hazard record says so) — the SURFACE is
// captured and tested; story/missions/dialog wire in later. Positions are
// hmsc world meters ({x,z}), adapting scape's 2D Tile space.

export type EvidenceAxis = 'visual' | 'fund' | 'pattern' | 'digital' | 'location';
export type Suspicion = Record<EvidenceAxis, number>; // each 0..100

// What a person LOOKS like — the unit of recognition. Witnesses store this;
// matching it against a presented signature drives visual heat.
export type VisualSignature = {
  silhouette: 'slim' | 'avg' | 'bulky';
  color: string;                  // dominant garment color (theme token)
  accessory: 'none' | 'hat' | 'hood' | 'mask' | 'glasses' | 'bag';
};

// A persistent thing an NPC saw — the memory slice that drives the Case.
export type WitnessMemory = {
  eventId: string;
  sawSignature: VisualSignature;
  position: WorldPoint;
  atMs: number;
  certainty: number;              // 0..1 from how well/close they saw it
  reported: boolean;              // has it reached the Case yet?
};

// The investigation — what the WORLD has assembled. Converges toward the
// player's true suspicion as witnesses report; always lags ground truth.
export type Case = {
  events: string[];
  suspicion: Suspicion;
  topSignature?: VisualSignature; // the description currently circulating
  leads: Array<{ npcId: string; axis: EvidenceAxis; weight: number }>;
};

export function emptySuspicion(): Suspicion {
  return { visual: 0, fund: 0, pattern: 0, digital: 0, location: 0 };
}

export function emptyCase(): Case {
  return { events: [], suspicion: emptySuspicion(), leads: [] };
}

// Notoriety = weighted blend of the five axes, normalised to 0..100 (scape
// verbatim). A blend (not the max) means heat spread thin is cheaper than one
// spiked axis — players hedge.
export function computeNotoriety(suspicion: Suspicion): number {
  const weights = PERCEPTION_TUNING.suspicionWeights;
  let weighted = 0;
  let total = 0;
  for (const axis of Object.keys(weights) as EvidenceAxis[]) {
    weighted += suspicion[axis] * weights[axis];
    total += weights[axis];
  }
  return clamp(weighted / total, 0, 100);
}

// FIRST CUT (surfaced, unruled): how certain a witness memory is, from the
// exposure they had and how deep into their vision range it happened.
export function witnessCertainty(
  exposure: number,
  rangeMeters: number,
  visionRangeMeters: number,
): number {
  const penalty = PERCEPTION_TUNING.witness.certaintyRangePenalty;
  const rangeFraction = visionRangeMeters > 0 ? clamp01(rangeMeters / visionRangeMeters) : 1;
  return clamp01(clamp01(exposure) * (1 - penalty * rangeFraction));
}

export function makeWitnessMemory(
  eventId: string,
  sawSignature: VisualSignature,
  position: WorldPoint,
  atMs: number,
  certainty: number,
): WitnessMemory {
  return { eventId, sawSignature, position: { ...position }, atMs, certainty: clamp01(certainty), reported: false };
}

// FIRST CUT (surfaced, unruled): 0..1 match between two visual signatures —
// the interrogation question "is the person you saw THIS person?".
export function matchSignature(a: VisualSignature, b: VisualSignature): number {
  const w = PERCEPTION_TUNING.witness.signatureWeights;
  return (
    (a.silhouette === b.silhouette ? w.silhouette : 0)
    + (a.color === b.color ? w.color : 0)
    + (a.accessory === b.accessory ? w.accessory : 0)
  ) / (w.silhouette + w.color + w.accessory);
}

// A witness report reaching the Case: the event joins the file (once), the
// visual axis heats by certainty, the strongest reported description becomes
// the one circulating, and the witness becomes a lead. Pure — returns the new
// Case and the memory marked reported; nothing else changes.
export function reportToCase(
  kase: Case,
  npcId: string,
  memory: WitnessMemory,
): { kase: Case; memory: WitnessMemory } {
  if (memory.reported) return { kase, memory };
  const heat = PERCEPTION_TUNING.witness.visualHeatPerReport * memory.certainty;
  const strongest = kase.leads.reduce((max, lead) => Math.max(max, lead.weight), 0);
  return {
    kase: {
      events: kase.events.includes(memory.eventId) ? kase.events : [...kase.events, memory.eventId],
      suspicion: { ...kase.suspicion, visual: clamp(kase.suspicion.visual + heat, 0, 100) },
      topSignature: memory.certainty >= strongest ? memory.sawSignature : kase.topSignature,
      leads: [...kase.leads, { npcId, axis: 'visual', weight: memory.certainty }],
    },
    memory: { ...memory, reported: true },
  };
}

// ── the display warp: the manic UI lie (scape verbatim) ──────────────────────
// What the high brain SHOWS, never what the dice roll. pTrue comes from
// GAME_CHANCE; h is the high intensity 0..100; tMs drives the frantic
// flicker. Sober returns the truth unchanged. At h≥90 a terrible shot
// (P_true 0.15) reads as a jittering ~0.65 — catastrophic confidence.

// Stimulant-induced delusional optimism, quadratic past the tweaking line.
export function optimismBias(h: number): number {
  const W = PERCEPTION_TUNING.warp;
  if (h < W.optimismStartsAt) return 0;
  const x = (h - W.optimismStartsAt) / W.optimismSpan;
  return W.optimismScale * x * x;
}

export function perceivedChance(
  pTrue: number,
  h: number,
  tMs: number,
  omega: number = PERCEPTION_TUNING.warp.flickerOmega,
): number {
  const W = PERCEPTION_TUNING.warp;
  if (h <= W.soberBelow) return pTrue; // sober: the UI tells the truth
  const t = tMs / 1000;
  const dampened = pTrue * (1 - h / W.dampenDivisor);
  const jitter = Math.sin(omega * t) * (h / W.jitterDivisor);
  return clamp(dampened + optimismBias(h) + jitter, 0, 1);
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_PERCEPTION = {
  // the producer (the ladder)
  calmPerceiver,
  step: perceptionStep,
  loseTrail,
  inVisionCone,
  suspicionFillPerSecond,
  noiseAudible,
  footstepNoise,
  footstepCadenceSeconds,
  gunshotNoise,
  awarenessForChance,
  // the consumers (the detective vocabulary)
  emptySuspicion,
  emptyCase,
  computeNotoriety,
  witnessCertainty,
  makeWitnessMemory,
  matchSignature,
  reportToCase,
  // the display warp (the lie, never the dice)
  perceivedChance,
  optimismBias,
  // the knob surface
  tuning: PERCEPTION_TUNING,
} as const;
