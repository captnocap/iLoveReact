/**
 * IFTTT registry — pluggable trigger sources and action verbs.
 *
 * Each owning hook (process, voice, fs, host, …) calls register* once at
 * import time to declare what it exposes through the IFTTT DSL. useIFTTT
 * walks the registry on subscription instead of growing more if/else
 * parser branches.
 *
 *   registerIfttSource('voice:', { match(spec) { ... } });
 *   registerIfttAction('voice:start', () => mic.start());
 *
 * Prefix-match rules:
 *   - Exact match always wins.
 *   - Prefix match requires the prefix to end with ':' (DSL boundary).
 *   - Longest matching prefix wins, so 'state:set:' beats 'state:'.
 *
 * Re-registering the same prefix replaces the previous source — keeps
 * hot-reload behavior sane when a hook module re-imports.
 */

export type IfttSubscription = {
  /** Subscribe to fires from this source. Return an unsubscribe fn. */
  subscribe(onFire: (payload?: any) => void): () => void;
};

export type IfttSource = {
  /** Return a Subscription factory if this source claims the spec, else
   *  null. The full DSL string is passed (including the prefix that
   *  registered the source) so the source can re-parse the remainder. */
  match(spec: string): IfttSubscription | null;
};

export type IfttActionRunner = (rest: string, payload: any) => void;

const _sources = new Map<string, IfttSource>();
const _actions = new Map<string, IfttActionRunner>();
let _fallback: IfttSource | null = null;

function prefixMatches(spec: string, prefix: string): boolean {
  if (spec === prefix) return true;
  if (prefix.endsWith(':') && spec.startsWith(prefix)) return true;
  return false;
}

// ── Trigger sources ───────────────────────────────────────────────

export function registerIfttSource(prefix: string, src: IfttSource): void {
  _sources.set(prefix, src);
}

/** Source used when no registered prefix matches the spec. The original
 *  useIFTTT fallthrough was "treat as raw bus event"; useIFTTT installs
 *  that path here. */
export function setIfttFallback(src: IfttSource): void {
  _fallback = src;
}

/** Resolve a trigger spec to its Subscription. Returns null if no source
 *  claims it AND no fallback is set. */
export function resolveTrigger(spec: string): IfttSubscription | null {
  let bestPrefix = '';
  let bestSrc: IfttSource | null = null;
  for (const [p, s] of _sources) {
    if (!prefixMatches(spec, p)) continue;
    if (p.length > bestPrefix.length) { bestPrefix = p; bestSrc = s; }
  }
  if (bestSrc) {
    const sub = bestSrc.match(spec);
    if (sub) return sub;
  }
  return _fallback ? _fallback.match(spec) : null;
}

// ── Action verbs ──────────────────────────────────────────────────

export function registerIfttAction(prefix: string, run: IfttActionRunner): void {
  _actions.set(prefix, run);
}

/** Dispatch a string action through the registry. Returns true if a
 *  registered prefix handled it. The runner receives the remainder of the
 *  action string (after the matched prefix) plus the trigger payload. */
export function dispatchAction(action: string, payload: any): boolean {
  let bestPrefix = '';
  let bestRunner: IfttActionRunner | null = null;
  for (const [p, r] of _actions) {
    if (!prefixMatches(action, p)) continue;
    if (p.length > bestPrefix.length) { bestPrefix = p; bestRunner = r; }
  }
  if (!bestRunner) return false;
  bestRunner(action.slice(bestPrefix.length), payload);
  return true;
}

// ── Introspection (debugging) ─────────────────────────────────────

export function listIfttSources(): string[] {
  return Array.from(_sources.keys()).sort();
}

export function listIfttActions(): string[] {
  return Array.from(_actions.keys()).sort();
}
