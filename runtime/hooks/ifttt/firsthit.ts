// ifttt-firsthit — single-shot pattern trigger source.
//
// Spec: `firsthit:<channel>::<pattern>`
//
// Identical wire format and semantics as `match:` (regex `/source/flags`
// or literal substring; payload search via JSON.stringify; same fire
// shape) — except the subscription auto-unsubscribes after the first
// match. Useful for session-first detection like "loss narrative
// without recovery check": bind `firsthit:vm:X:event:append::work was
// destroyed` and the rule fires once per session, never repeats.
//
// Re-arming is implicit per useIFTTT subscription: a fresh subscribe
// (e.g. when a hook re-mounts, or when the binder loop runs on a new
// session) creates a fresh fired-flag.
//
// Use `match:` instead when you want every hit; `firsthit:` is for
// "I only care about the first one in this scope."

import { subscribe } from '../ffi';
import { registerIfttSource } from './ifttt-registry';

const PREFIX = 'firsthit:';
const SEP = '::';

interface Tester { test: (s: string) => RegExpMatchArray | null }

function parsePattern(spec: string): Tester | null {
  if (spec.length >= 3 && spec.startsWith('/')) {
    const last = spec.lastIndexOf('/');
    if (last > 0) {
      const pattern = spec.slice(1, last);
      const flags = spec.slice(last + 1);
      try {
        const re = new RegExp(pattern, flags);
        return { test: (s) => s.match(re) };
      } catch (e: any) {
        console.warn(`[ifttt-firsthit] invalid regex '/${pattern}/${flags}': ${e?.message || e}`);
        return null;
      }
    }
  }
  const needle = spec;
  return {
    test: (s) => {
      const i = s.indexOf(needle);
      if (i < 0) return null;
      const out: any = [needle];
      out.index = i;
      return out as RegExpMatchArray;
    },
  };
}

function searchableText(payload: any): string {
  if (typeof payload === 'string') return payload;
  if (payload == null) return '';
  if (typeof payload === 'object') {
    try { return JSON.stringify(payload); } catch { return String(payload); }
  }
  return String(payload);
}

registerIfttSource(PREFIX, {
  match(spec) {
    if (!spec.startsWith(PREFIX)) return null;
    const rest = spec.slice(PREFIX.length);
    const sep = rest.indexOf(SEP);
    if (sep < 0) {
      console.warn(`[ifttt-firsthit] missing '::' separator in '${spec}'`);
      return null;
    }
    const channel = rest.slice(0, sep);
    const patternSpec = rest.slice(sep + SEP.length);
    if (!channel || !patternSpec) return null;
    const tester = parsePattern(patternSpec);
    if (!tester) return null;
    return {
      subscribe(onFire) {
        let fired = false;
        let unsub: (() => void) | null = subscribe(channel, (payload: any) => {
          if (fired) return;
          const text = searchableText(payload);
          if (!text) return;
          const m = tester.test(text);
          if (!m) return;
          fired = true;
          onFire({
            channel,
            payload,
            text,
            match: m[0],
            index: m.index ?? 0,
            groups: m.length > 1 ? Array.from(m).slice(1) : undefined,
          });
          // Self-unsubscribe so further emits are ignored.
          if (unsub) { const u = unsub; unsub = null; u(); }
        });
        // Outer unsubscribe — safe even after self-unsub already ran.
        return () => { if (unsub) { const u = unsub; unsub = null; u(); } };
      },
    };
  },
});
