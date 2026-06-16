// game/fire.ts — GAME_FIRE: the lingering, spreading combustion model. The
// counterpart to game/explosion.ts (the instant blast). Where a blast is one
// event, fire PERSISTS: it burns over time, deals damage every step, spreads,
// and when something flammable finishes burning it can COOK OFF — which is the
// seam back to explosion.ts (a propane tank's "fire" is ~instant, then BOOM; a
// car's GTFO fire is a few seconds, then BOOM; a person on fire just burns).
//
// Two spread models, because the user split them exactly this way:
//   • COMBUSTIBLE  — a discrete object on fire (car, propane tank, figure). It
//     has a fuel budget, burns it down dealing DOT, and at the end either cooks
//     off (→ a blast) or simply goes out. A propane tank is just a combustible
//     with ~0 fuel and a cookoff: ignite it and it's a "big ass boom", not a
//     fire. A car is a combustible with a multi-second fuel budget (the GTFO
//     window) and a cookoff.
//   • FIRE FIELD   — a sparse tile grid for the "pour gasoline, light one end,
//     watch it crawl" moment. Cells with fuel ignite their fueled neighbours on
//     a delay, burn for a while, then go spent. The caller owns WHERE the fuel
//     is (a predicate); this model owns the front's propagation.
//
// THE LAW (P3 door, pure & deterministic): no host calls, no world reads, no
// wall-clock. Everything advances by an explicit dt. Spread jitter, when asked
// for, draws from a caller-supplied seeded rng (game/chance.ts seededRng) so a
// fire replays identically — never Math.random implicitly.
//
// P2: ONE registered table, FIRE_TUNING — the cross-fire shape defaults. Per
// combustible/field magnitudes (a car's fuel budget, gasoline's burn time)
// arrive per-call from the igniting code's data. [[feedback_rule_of_two_no_magic_values]]

// The ONE registered tuning table (P2). Defaults a caller overrides per fire.
export const FIRE_TUNING = {
  /** hp/second a generic fire deals to whatever it's burning, before per-fire
   *  overrides (a car fire hurts more than a campfire) */
  damagePerSecond: 8,
  /** seconds a combustible burns before its end state, when none is specified */
  fuelSeconds: 4,
  /** FIRE FIELD: seconds a burning cell waits before it lights a fuelled
   *  neighbour — this is the visible crawl speed of a gasoline trail */
  cellSpreadDelaySeconds: 0.35,
  /** FIRE FIELD: seconds a cell stays alight before going spent */
  cellBurnSeconds: 3,
  /** FIRE FIELD: include the 4 diagonal neighbours (8-way) vs orthogonal only */
  cellSpreadDiagonal: true,
  /** FIRE FIELD: 0 = every fuelled neighbour catches on schedule; up to 1 adds
   *  rng-driven hesitation per neighbour so the front looks organic, not square */
  cellSpreadJitter: 0.25,
} as const;

export type FireTuning = typeof FIRE_TUNING;

// ── COMBUSTIBLE: a discrete object on fire ───────────────────────────────────

// What a combustible does when its fuel runs out.
//   'extinguish' — the fire just dies (a figure stops burning, a bush is ash)
//   'cookoff'    — it explodes; the stepper emits a 'cookoff' event and the
//                  caller fires a game/explosion.ts blast at the object
export type EndBehavior = 'extinguish' | 'cookoff';

export type Combustible = {
  /** false until ignited; ignite() flips it. A spent combustible cannot relight. */
  burning: boolean;
  /** total seconds of fuel this object holds (a car's GTFO window; ~0 for a
   *  propane tank that should just go boom the instant it's lit) */
  fuelSeconds: number;
  /** seconds burned so far */
  elapsedSeconds: number;
  /** hp/second this fire deals to its host while burning */
  damagePerSecond: number;
  /** what happens when fuel is exhausted */
  end: EndBehavior;
  /** set once the object has finished (cooked off or extinguished); a spent
   *  object ignites no further and steps to nothing */
  spent: boolean;
};

export type NewCombustible = {
  fuelSeconds?: number;
  damagePerSecond?: number;
  end?: EndBehavior;
};

/** A combustible at rest — flammable but not yet alight. */
export function makeCombustible(spec: NewCombustible = {}): Combustible {
  return {
    burning: false,
    fuelSeconds: spec.fuelSeconds ?? FIRE_TUNING.fuelSeconds,
    elapsedSeconds: 0,
    damagePerSecond: spec.damagePerSecond ?? FIRE_TUNING.damagePerSecond,
    end: spec.end ?? 'extinguish',
    spent: false,
  };
}

/** Light it. A spent object stays spent; an already-burning one is unchanged. */
export function ignite(c: Combustible): Combustible {
  if (c.spent || c.burning) return c;
  return { ...c, burning: true };
}

// What a single combustible step produced.
export type CombustibleStep = {
  state: Combustible;
  /** hp to remove from the host this step (0 when not burning) */
  damage: number;
  /** 'none' while still burning; 'cookoff' or 'extinguished' on the step it
   *  finishes — 'cookoff' is the caller's cue to fire a blast at this object */
  event: 'none' | 'cookoff' | 'extinguished';
};

/**
 * Advance one combustible by dt. Accrues burn time, returns the DOT for this
 * step, and on the step its fuel is exhausted transitions to spent — emitting
 * 'cookoff' (→ caller triggers an explosion) or 'extinguished' per its end.
 *
 * A propane tank (fuelSeconds 0, end 'cookoff') ignited this frame cooks off on
 * its very next step: that's the "big ass boom, not a fire" the user wanted.
 */
export function stepCombustible(c: Combustible, dtSeconds: number): CombustibleStep {
  if (!c.burning || c.spent) return { state: c, damage: 0, event: 'none' };

  const elapsed = c.elapsedSeconds + dtSeconds;
  if (elapsed >= c.fuelSeconds) {
    // Damage only for the slice of dt actually spent burning.
    const burnDt = Math.max(0, c.fuelSeconds - c.elapsedSeconds);
    const state: Combustible = { ...c, elapsedSeconds: c.fuelSeconds, burning: false, spent: true };
    return {
      state,
      damage: c.damagePerSecond * burnDt,
      event: c.end === 'cookoff' ? 'cookoff' : 'extinguished',
    };
  }
  return {
    state: { ...c, elapsedSeconds: elapsed },
    damage: c.damagePerSecond * dtSeconds,
    event: 'none',
  };
}

// ── FIRE FIELD: tile-grid spread (gasoline trails, grass fires) ───────────────

// A cell's life: a fuelled cell is 'dry' until lit, 'burning' while alight,
// then 'spent'. Only burning cells are tracked; dryness lives in the caller's
// fuel predicate (the world knows where gasoline was poured).
export type CellState = 'burning' | 'spent';

type BurningCell = {
  /** seconds this cell has been alight */
  elapsed: number;
  /** state once it stops (spent) — burning cells live in the map directly */
  state: CellState;
};

// Integer tile coordinates. 1 cell = 1 tile = 1 metre (the world contract).
export type Cell = { x: number; z: number };

// Whether a tile holds fuel right now. The world owns this — a gasoline trail
// is a Set of poured cells; grass tiles answer true over a region; etc.
export type FuelPredicate = (x: number, z: number) => boolean;

export type FireField = {
  /** keyed "x,z" → the cell's burn progress. Both burning and spent cells stay
   *  here so a spent cell is never relit. */
  cells: Map<string, BurningCell>;
};

export type FireFieldTuning = {
  spreadDelaySeconds?: number;
  burnSeconds?: number;
  diagonal?: boolean;
  jitter?: number;
  /** seeded rng for spread jitter; required only when jitter > 0 */
  rng?: () => number;
};

const cellKey = (x: number, z: number): string => `${x},${z}`;

export function makeFireField(): FireField {
  return { cells: new Map() };
}

/** Light a tile. No-op if it already has a (burning or spent) record, or if the
 *  caller's fuel predicate says there's nothing to burn there. */
export function igniteCell(field: FireField, x: number, z: number, hasFuel: FuelPredicate): FireField {
  const key = cellKey(x, z);
  if (field.cells.has(key) || !hasFuel(x, z)) return field;
  const cells = new Map(field.cells);
  cells.set(key, { elapsed: 0, state: 'burning' });
  return { cells };
}

const ORTHOGONAL: Cell[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];
const DIAGONAL: Cell[] = [
  { x: 1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: 1 },
  { x: -1, z: -1 },
];

export type FireFieldStep = {
  field: FireField;
  /** cells that caught this step (for VFX spawn / combustible-overlap checks) */
  ignited: Cell[];
  /** cells that finished burning this step */
  burnedOut: Cell[];
};

/**
 * Advance the whole fire field by dt. A cell that has burned past the spread
 * delay lights its fuelled, untouched neighbours (orthogonal, plus diagonal if
 * tuned, with optional rng hesitation); a cell past its burn time goes spent.
 *
 * Deterministic: spread order is fixed and jitter draws only from tuning.rng,
 * so the same field + dt + rng replays identically.
 */
export function stepFireField(
  field: FireField,
  dtSeconds: number,
  hasFuel: FuelPredicate,
  tuning: FireFieldTuning = {},
): FireFieldStep {
  const spreadDelay = tuning.spreadDelaySeconds ?? FIRE_TUNING.cellSpreadDelaySeconds;
  const burnSeconds = tuning.burnSeconds ?? FIRE_TUNING.cellBurnSeconds;
  const diagonal = tuning.diagonal ?? FIRE_TUNING.cellSpreadDiagonal;
  const jitter = tuning.jitter ?? FIRE_TUNING.cellSpreadJitter;
  const rng = tuning.rng;

  const cells = new Map(field.cells);
  const ignited: Cell[] = [];
  const burnedOut: Cell[] = [];
  const neighbours = diagonal ? [...ORTHOGONAL, ...DIAGONAL] : ORTHOGONAL;

  // Snapshot the cells that were burning at the START of the step, so spread
  // this step can't cascade through cells lit this same step (one ring per step).
  const wereBurning: Array<{ x: number; z: number; elapsed: number }> = [];
  for (const [key, cell] of field.cells) {
    if (cell.state !== 'burning') continue;
    const [x, z] = key.split(',').map(Number);
    wereBurning.push({ x, z, elapsed: cell.elapsed });
  }

  for (const src of wereBurning) {
    const elapsed = src.elapsed + dtSeconds;

    // Spread once this cell is established enough to throw fire.
    if (elapsed >= spreadDelay) {
      for (const d of neighbours) {
        const nx = src.x + d.x;
        const nz = src.z + d.z;
        const nkey = cellKey(nx, nz);
        if (cells.has(nkey) || !hasFuel(nx, nz)) continue;
        if (jitter > 0 && rng && rng() < jitter) continue; // hesitates this step, retries next
        cells.set(nkey, { elapsed: 0, state: 'burning' });
        ignited.push({ x: nx, z: nz });
      }
    }

    // Age the source cell; retire it past its burn window.
    if (elapsed >= burnSeconds) {
      cells.set(cellKey(src.x, src.z), { elapsed, state: 'spent' });
      burnedOut.push({ x: src.x, z: src.z });
    } else {
      cells.set(cellKey(src.x, src.z), { elapsed, state: 'burning' });
    }
  }

  return { field: { cells }, ignited, burnedOut };
}

/** The currently-alight cells — for spawning flame VFX and for asking "is this
 *  figure/combustible standing in fire?" (caller checks its tile against these). */
export function burningCells(field: FireField): Cell[] {
  const out: Cell[] = [];
  for (const [key, cell] of field.cells) {
    if (cell.state !== 'burning') continue;
    const [x, z] = key.split(',').map(Number);
    out.push({ x, z });
  }
  return out;
}

/** True if the given tile is alight right now (the in-fire DOT/ignition query). */
export function isCellBurning(field: FireField, x: number, z: number): boolean {
  return field.cells.get(cellKey(x, z))?.state === 'burning';
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_FIRE = {
  // combustibles
  makeCombustible,
  ignite,
  stepCombustible,
  // fire field (tile spread)
  makeFireField,
  igniteCell,
  stepFireField,
  burningCells,
  isCellBurning,
  tuning: FIRE_TUNING,
} as const;
