// ifttt-match — generic text-pattern trigger source for useIFTTT.
//
// Spec: `match:<channel>::<pattern>`
//
//   <channel> is the bus channel to listen on. May contain colons —
//   the parser splits on the FIRST '::' to keep arbitrary channel
//   namespaces intact (e.g. 'vm:abc:event:append').
//
//   <pattern> is either:
//     - A regex of the form `/source/flags`
//         match:event:append::/rm\s+-rf/i
//     - Otherwise, a literal case-sensitive substring
//         match:event:append::pkill -f
//
// Payload search:
//   - String payloads search verbatim.
//   - Object payloads are JSON.stringify'd and the result is searched.
//     This means a needle 'rm -rf' fires whether the agent line was
//     emitted as `{ line: 'rm -rf /' }`, `{ payload: { text: 'rm -rf /' } }`,
//     or any other nested shape. Tradeoff: a needle that collides with
//     a JSON key (e.g. `"rm -rf"`) can produce false positives —
//     usually fine for keyword detection, use regex bounds when it
//     matters.
//
// On match the fire payload is:
//   { channel, payload, text, match, index, groups? }
//
//   `match` — the matched substring (group 0 for regex)
//   `groups` — capture groups when using a regex with parens
//   `text` — the searchable string actually tested
//
// Examples:
//   useIFTTT('match:event:append::pkill -f',
//            'flag-pathology:pat_session_kill_pattern')
//   useIFTTT('match:vm:abc:event:append::/git\\s+add\\s+(-A|\\.|\\*)/',
//            'halt-run:reason=indiscriminate-stage')
//   useIFTTT('match:proc:stdout:1234::ERROR',
//            'notify-user:agent crashed')
//
// This is the load-bearing primitive behind features like the
// pathology dictionary: a Pathology row's detectionSignals can be
// bound by emitting `match:<surface-channel>::<spec>` once per row.
// Adding a new banned phrase becomes a data write.

import { subscribe } from '../ffi';
import { registerIfttSource } from './ifttt-registry';

const PREFIX = 'match:';
const SEPARATOR = '::';

interface Tester { test: (s: string) => RegExpMatchArray | null }

function parsePattern(spec: string): Tester | null {
  // Regex form: /pat/flags. Require both leading '/' and a closing '/'
  // somewhere after position 0, so a single '/' at start of a literal
  // doesn't trigger regex parsing.
  if (spec.length >= 3 && spec.startsWith('/')) {
    const lastSlash = spec.lastIndexOf('/');
    if (lastSlash > 0) {
      const pattern = spec.slice(1, lastSlash);
      const flags = spec.slice(lastSlash + 1);
      try {
        const re = new RegExp(pattern, flags);
        return { test: (s) => s.match(re) };
      } catch (e: any) {
        console.warn(`[ifttt-match] invalid regex '/${pattern}/${flags}': ${e?.message || e}`);
        return null;
      }
    }
  }
  // Substring form. Build a synthetic match-array shape so callers see
  // a uniform fire payload regardless of whether they used regex or
  // literal.
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
    try { return JSON.stringify(payload); }
    catch { return String(payload); }
  }
  return String(payload);
}

registerIfttSource(PREFIX, {
  match(spec) {
    if (!spec.startsWith(PREFIX)) return null;
    const rest = spec.slice(PREFIX.length);
    const sep = rest.indexOf(SEPARATOR);
    if (sep < 0) {
      console.warn(`[ifttt-match] missing '::' separator in '${spec}'`);
      return null;
    }
    const channel = rest.slice(0, sep);
    const patternSpec = rest.slice(sep + SEPARATOR.length);
    if (!channel || !patternSpec) return null;
    const tester = parsePattern(patternSpec);
    if (!tester) return null;
    return {
      subscribe(onFire) {
        return subscribe(channel, (payload: any) => {
          const text = searchableText(payload);
          if (!text) return;
          const m = tester.test(text);
          if (!m) return;
          onFire({
            channel,
            payload,
            text,
            match: m[0],
            index: m.index ?? 0,
            groups: m.length > 1 ? Array.from(m).slice(1) : undefined,
          });
        });
      },
    };
  },
});

/** Helper: construct a `match:` spec without manual string concatenation.
 *  Useful for binders that compose specs from data rows. */
export function matchSpec(channel: string, pattern: string): string {
  return `${PREFIX}${channel}${SEPARATOR}${pattern}`;
}
