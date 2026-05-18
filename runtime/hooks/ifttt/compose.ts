/**
 * ifttt-compose — compositional triggers for useIFTTT.
 *
 * Lets a single useIFTTT call express multi-condition fire policy:
 *
 *   useIFTTT(
 *     { on: 'key:ctrl+s', when: () => isDirty },
 *     'send:save',
 *   );
 *
 *   useIFTTT(
 *     { all: [`proc:ram:${pid}:>:0.85`, () => uptime() > 60_000], cooldown: 60_000 },
 *     'proc:kill:$id',
 *   );
 *
 *   useIFTTT(
 *     { seq: ['key:up','key:up','key:down','key:down'], within: 2000 },
 *     'send:cheat',
 *   );
 *
 * Internal model: every compose node exposes `value()` (current boolean
 * level) and `subscribe(onChange)` (level transitions). String leaves
 * latch true momentarily then auto-clear next microtask — events behave
 * as edges, not levels, so they combine cleanly with sustained
 * conditions. Function leaves are polled (default 50ms) so they don't
 * depend on React render cadence.
 *
 * The root node is exposed as a registry-shape Subscription that fires
 * once per detected edge — useIFTTT plugs it in identically to a normal
 * trigger source.
 */

import { resolveTrigger, type IfttSubscription } from './ifttt-registry';

// ── Public shape ──────────────────────────────────────────────────

export type IFTTTLeaf = string | (() => boolean);

export type IFTTTComposable =
  | IFTTTLeaf
  | { on: IFTTTComposable | IFTTTComposable[]; when?: () => boolean }
  | { all: IFTTTComposable[] }
  | { any: IFTTTComposable[] }
  | { seq: IFTTTComposable[]; within: number }
  | {
      trigger: IFTTTComposable;
      debounce?: number;
      throttle?: number;
      once?: boolean;
      cooldown?: number;
    };

/** Returns true if the value is a compositional shape (not a plain string
 *  or function). useIFTTT uses this to decide whether to route through
 *  the composer or take the legacy fast-paths. */
export function isComposable(value: any): boolean {
  if (value == null) return false;
  if (typeof value === 'string' || typeof value === 'function') return false;
  if (typeof value !== 'object') return false;
  return 'on' in value || 'all' in value || 'any' in value
    || 'seq' in value || 'trigger' in value;
}

// ── Internal node interface ───────────────────────────────────────

type LevelListener = (level: boolean, payload?: any) => void;

type Node = {
  /** Subscribe to level transitions. The first call may not deliver an
   *  initial value — listeners are notified on change only. */
  subscribe(fn: LevelListener): () => void;
  /** Best-effort current level. Useful for AND/OR recompute when one
   *  child fires and we need to read siblings. */
  value(): boolean;
};

const POLL_MS = 50;

// ── Leaves ────────────────────────────────────────────────────────

function compileLeafString(spec: string): Node {
  let level = false;
  const subs = new Set<LevelListener>();
  let unsub: (() => void) | null = null;

  const ensureSubscribed = () => {
    if (unsub != null) return;
    const resolved = resolveTrigger(spec);
    if (!resolved) {
      console.warn(`[ifttt-compose] no source for leaf '${spec}'`);
      return;
    }
    unsub = resolved.subscribe((payload?: any) => {
      level = true;
      for (const fn of Array.from(subs)) fn(true, payload);
      // Auto-clear next microtask — string triggers are edges, not levels.
      queueMicrotask(() => {
        if (!level) return;
        level = false;
        for (const fn of Array.from(subs)) fn(false, payload);
      });
    });
  };

  return {
    value: () => level,
    subscribe(fn) {
      subs.add(fn);
      ensureSubscribed();
      return () => {
        subs.delete(fn);
        if (subs.size === 0 && unsub) { unsub(); unsub = null; }
      };
    },
  };
}

function compileLeafFn(fn: () => boolean): Node {
  let level = false;
  const subs = new Set<LevelListener>();
  let timer: any = null;

  const evalNow = () => {
    let cur = false;
    try { cur = !!fn(); } catch { cur = false; }
    if (cur === level) return;
    level = cur;
    for (const s of Array.from(subs)) s(level, undefined);
  };

  return {
    value: () => level,
    subscribe(s) {
      subs.add(s);
      if (timer == null) {
        evalNow();
        timer = setInterval(evalNow, POLL_MS);
      }
      return () => {
        subs.delete(s);
        if (subs.size === 0 && timer != null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

// ── Composers ─────────────────────────────────────────────────────

function compileAll(children: IFTTTComposable[]): Node {
  const compiled = children.map(compile);
  let level = false;
  let lastPayload: any;
  const subs = new Set<LevelListener>();

  const recompute = (payload: any) => {
    const next = compiled.every((c) => c.value());
    if (next === level) return;
    level = next;
    if (level) lastPayload = payload;
    for (const s of Array.from(subs)) s(level, lastPayload);
  };

  return {
    value: () => level,
    subscribe(s) {
      subs.add(s);
      const unsubs = compiled.map((c) =>
        c.subscribe((_lvl, p) => recompute(p)),
      );
      return () => {
        subs.delete(s);
        for (const u of unsubs) u();
      };
    },
  };
}

function compileAny(children: IFTTTComposable[]): Node {
  const compiled = children.map(compile);
  let level = false;
  let lastPayload: any;
  const subs = new Set<LevelListener>();

  const recompute = (payload: any) => {
    const next = compiled.some((c) => c.value());
    if (next === level) return;
    level = next;
    if (level) lastPayload = payload;
    for (const s of Array.from(subs)) s(level, lastPayload);
  };

  return {
    value: () => level,
    subscribe(s) {
      subs.add(s);
      const unsubs = compiled.map((c) =>
        c.subscribe((_lvl, p) => recompute(p)),
      );
      return () => {
        subs.delete(s);
        for (const u of unsubs) u();
      };
    },
  };
}

function compileSeq(children: IFTTTComposable[], within: number): Node {
  const compiled = children.map(compile);
  const subs = new Set<LevelListener>();

  return {
    value: () => false, // edge-only
    subscribe(s) {
      subs.add(s);
      let idx = 0;
      let firstAt = 0;
      const unsubs = compiled.map((c, i) =>
        c.subscribe((level, payload) => {
          if (!level) return;
          const now = Date.now();
          if (i === 0 && idx === 0) {
            idx = 1;
            firstAt = now;
            return;
          }
          if (i === idx && now - firstAt <= within) {
            idx += 1;
            if (idx === compiled.length) {
              for (const f of Array.from(subs)) f(true, payload);
              queueMicrotask(() => {
                for (const f of Array.from(subs)) f(false, payload);
              });
              idx = 0;
              firstAt = 0;
            }
            return;
          }
          // Out of order or window expired — restart from the first step.
          idx = i === 0 ? 1 : 0;
          firstAt = i === 0 ? now : 0;
        }),
      );
      return () => {
        subs.delete(s);
        for (const u of unsubs) u();
      };
    },
  };
}

function compileOn(
  on: IFTTTComposable | IFTTTComposable[],
  when?: () => boolean,
): Node {
  const onNodes = (Array.isArray(on) ? on : [on]).map(compile);
  const subs = new Set<LevelListener>();

  return {
    value: () => false, // edge-only
    subscribe(s) {
      subs.add(s);
      const unsubs = onNodes.map((n) =>
        n.subscribe((level, payload) => {
          if (!level) return;
          if (when) {
            let pass = false;
            try { pass = !!when(); } catch { pass = false; }
            if (!pass) return;
          }
          for (const f of Array.from(subs)) f(true, payload);
          queueMicrotask(() => {
            for (const f of Array.from(subs)) f(false, payload);
          });
        }),
      );
      return () => {
        subs.delete(s);
        for (const u of unsubs) u();
      };
    },
  };
}

function compileModifier(spec: {
  trigger: IFTTTComposable;
  debounce?: number;
  throttle?: number;
  once?: boolean;
  cooldown?: number;
}): Node {
  const inner = compile(spec.trigger);
  const subs = new Set<LevelListener>();
  let lastFireAt = 0;
  let fired = false;
  let debounceTimer: any = null;

  const emit = (payload: any) => {
    lastFireAt = Date.now();
    fired = true;
    for (const f of Array.from(subs)) f(true, payload);
    queueMicrotask(() => {
      for (const f of Array.from(subs)) f(false, payload);
    });
  };

  const tryFire = (payload: any) => {
    const now = Date.now();
    if (spec.once && fired) return;
    if (spec.cooldown != null && lastFireAt > 0 && now - lastFireAt < spec.cooldown) return;
    if (spec.throttle != null && lastFireAt > 0 && now - lastFireAt < spec.throttle) return;
    if (spec.debounce != null) {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        emit(payload);
      }, spec.debounce);
      return;
    }
    emit(payload);
  };

  return {
    value: () => false,
    subscribe(s) {
      subs.add(s);
      const unsub = inner.subscribe((level, payload) => {
        if (level) tryFire(payload);
      });
      return () => {
        subs.delete(s);
        unsub();
      };
    },
  };
}

// ── Dispatch ──────────────────────────────────────────────────────

function compile(node: IFTTTComposable): Node {
  if (typeof node === 'string') return compileLeafString(node);
  if (typeof node === 'function') return compileLeafFn(node);
  if ('all' in node) return compileAll(node.all);
  if ('any' in node) return compileAny(node.any);
  if ('seq' in node) return compileSeq(node.seq, node.within);
  if ('on' in node) return compileOn(node.on, node.when);
  if ('trigger' in node) return compileModifier(node);
  throw new Error('[ifttt-compose] unrecognised node shape');
}

/** Compile a composable trigger to the registry's Subscription shape so
 *  useIFTTT plugs it in identically to any other trigger source. */
export function compileTrigger(node: IFTTTComposable): IfttSubscription {
  const root = compile(node);
  return {
    subscribe(onFire) {
      return root.subscribe((level, payload) => {
        if (level) onFire(payload);
      });
    },
  };
}

// ── Action substitution ───────────────────────────────────────────

/** Substitute `$id`, `$pid`, `$payload`, and `$payload.path.to.field`
 *  references in an action template against the trigger payload. */
export function substituteAction(template: string, payload: any): string {
  if (!template || template.indexOf('$') < 0) return template;
  return template
    .replace(/\$payload(?:\.([\w.]+))?/g, (_m, path) => {
      if (!path) {
        try { return JSON.stringify(payload); } catch { return ''; }
      }
      const parts = path.split('.');
      let v: any = payload;
      for (const p of parts) {
        if (v == null) return '';
        v = v[p];
      }
      return v == null ? '' : String(v);
    })
    .replace(/\$id\b/g, String(payload?.id ?? payload?.pid ?? ''))
    .replace(/\$pid\b/g, String(payload?.pid ?? payload?.id ?? ''));
}
