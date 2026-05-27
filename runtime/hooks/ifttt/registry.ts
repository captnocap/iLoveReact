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

export type IfttActionRunner = (rest: string, payload: any) => void | Promise<void>;

/** Resolved dispatch — runner output (possibly a Promise) + whether the
 *  registry actually found a handler. useIFTTT consumes this to drive the
 *  `.action` in-flight tracker and `.completed` edge on each result. */
export type IfttDispatchResult = {
  handled: boolean;
  /** Whatever the runner returned. `undefined` for unhandled or sync-void. */
  ret: void | Promise<void>;
};

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
 *  claims it AND no fallback is set.
 *
 *  Longest-prefix wins, by string length — NOT registration order. So
 *  registering `'state:set:'` after `'state:'` is fine, and registering it
 *  before is fine; either way `'state:set:foo'` routes to the longer
 *  prefix. The `if (p.length > bestPrefix.length)` check is what enforces
 *  this; do not switch to a Map iteration that bails on first match. */
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

/** Dispatch a string action through the registry. Returns `{ handled, ret }`
 *  — `ret` is whatever the runner returned (possibly a Promise) so useIFTTT
 *  can await action settlement for its `.completed` edge. The runner gets
 *  the remainder of the action string (after the matched prefix) plus the
 *  trigger payload. */
export function dispatchAction(action: string, payload: any): IfttDispatchResult {
  let bestPrefix = '';
  let bestRunner: IfttActionRunner | null = null;
  for (const [p, r] of _actions) {
    if (!prefixMatches(action, p)) continue;
    if (p.length > bestPrefix.length) { bestPrefix = p; bestRunner = r; }
  }
  if (!bestRunner) return { handled: false, ret: undefined };
  const ret = bestRunner(action.slice(bestPrefix.length), payload);
  return { handled: true, ret };
}

// ── Introspection (debugging) ─────────────────────────────────────

export function listIfttSources(): string[] {
  return Array.from(_sources.keys()).sort();
}

export function listIfttActions(): string[] {
  return Array.from(_actions.keys()).sort();
}
