// game/story/flags.ts — the story state: flags + counters (the hmsc reference).
//
// The whole narrative memory is a flat, JSON-serializable record pair —
// `flags` (named facts: booleans, numbers, strings) and `counters` (named
// tallies). Captured from cart/hmsc/design.ts `StoryState` and the
// setStoryFlag / revive semantics in cart/hmsc/events/useHmscEventRules.ts +
// cart/hmsc/state/gameState.ts. No ruling competes ("flags" returns no
// verdict); the reference is the authority.
//
// V22's event-sourced doctrine shapes what this is allowed to be: there is NO
// backstory table here. Every flag and counter exists because something in
// the event log set it (the rules in ./events.ts) — the story system can only
// know what the world witnessed (PROTECT THE ZERO).
//
// RE-RENDER CITIZENSHIP (the hmsc precedent, same as the cutscene clock):
// every write returns the SAME reference when nothing changed, so a no-op
// flag set never invalidates React state upstream.

export type StoryValue = boolean | number | string;

export type StoryState = {
  flags: Record<string, StoryValue>;
  counters: Record<string, number>;
};

export function emptyStory(): StoryState {
  return { flags: {}, counters: {} };
}

// ── flags ────────────────────────────────────────────────────────────────────

/** Set a named fact. Same reference back when the value is already there. */
export function setFlag(state: StoryState, key: string, value: StoryValue): StoryState {
  if (state.flags[key] === value) return state;
  return { ...state, flags: { ...state.flags, [key]: value } };
}

export function getFlag(state: StoryState, key: string): StoryValue | undefined {
  return state.flags[key];
}

/** Truthiness read for conditions: unset → false, set → Boolean(value). */
export function flagIsSet(state: StoryState, key: string): boolean {
  return Boolean(state.flags[key]);
}

// ── counters ─────────────────────────────────────────────────────────────────

/** Add to a named tally (default +1). delta 0 is a no-op (same reference). */
export function bumpCounter(state: StoryState, key: string, delta: number = 1): StoryState {
  if (!Number.isFinite(delta)) throw new Error(`story: counter '${key}' delta must be finite, got ${delta}`);
  if (delta === 0) return state;
  const next = (state.counters[key] ?? 0) + delta;
  return { ...state, counters: { ...state.counters, [key]: next } };
}

export function getCounter(state: StoryState, key: string): number {
  return state.counters[key] ?? 0;
}

// ── persistence (the gameState.ts revive semantics) ──────────────────────────
//
// Story state persists as plain JSON inside the one game-state object (the
// hmsc 'game-state' localstore key; V20's snapshot is the same shape). Revive
// is a DEFENSIVE MERGE over a fresh empty story: unknown fields are dropped,
// missing fields default, non-object garbage yields the empty story — a save
// from an older schema can never crash the boot.

export function reviveStory(parsed: unknown): StoryState {
  const initial = emptyStory();
  if (!parsed || typeof parsed !== 'object') return initial;
  const raw = parsed as { flags?: unknown; counters?: unknown };

  const flags: Record<string, StoryValue> = {};
  if (raw.flags && typeof raw.flags === 'object') {
    for (const [key, value] of Object.entries(raw.flags as Record<string, unknown>)) {
      const kind = typeof value;
      if (kind === 'boolean' || kind === 'string' || (kind === 'number' && Number.isFinite(value as number))) {
        flags[key] = value as StoryValue;
      }
    }
  }

  const counters: Record<string, number> = {};
  if (raw.counters && typeof raw.counters === 'object') {
    for (const [key, value] of Object.entries(raw.counters as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) counters[key] = value;
    }
  }

  return { ...initial, flags: { ...initial.flags, ...flags }, counters: { ...initial.counters, ...counters } };
}
