// ifttt-repeat — fires when a payload's text closely matches an
// earlier payload on the same channel.
//
// Spec: `repeat:<channel>::<lookback>::<minSim>`
//
//   <channel>  — bus channel to watch (may contain colons)
//   <lookback> — integer; how many recent emits on the channel to
//                compare each new emit against (older entries fall
//                off). Default 10 if you want the leniency baked in
//                via wrapper, but the spec form requires it.
//   <minSim>   — float in [0, 1]. Jaccard similarity threshold on
//                normalized 4-character shingles. 1.0 = exact match;
//                ~0.6 catches paraphrased repeats; ~0.85 catches
//                rephrasings of the same sentence.
//
// Fire payload:
//   { channel, current, prior, similarity, indexInLookback }
//
// Use case: scenarios in the pathology catalog where the
// signal is "claim shape didn't change after acknowledgment":
//
//   - Acknowledgment without recalibration (multi-turn): claim N
//     → "you're right" → claim N+2 with shape ≈ N
//   - Apology-without-change: 3 successive turns contain apology +
//     same-shape next-action claim
//
// The implementation is deliberately model-free — Jaccard on
// 4-shingles handles "the fix is in" / "the bug is fixed" / "fixed it
// now" all clustering, while staying cheap enough to run on every
// emit with no model dependency. When a semantic similarity primitive
// lands, we add `repeat:semantic:<...>` as a sibling source.

import { subscribe } from '../../ffi';
import { registerIfttSource } from './registry';

const PREFIX = 'repeat:';
const SEP = '::';

// Normalize: lowercase, collapse whitespace, strip non-word-chars
// (apostrophes survive but are flattened into the surrounding word).
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function shingles(s: string, k = 4): Set<string> {
  const out = new Set<string>();
  if (s.length < k) {
    if (s.length > 0) out.add(s);
    return out;
  }
  for (let i = 0; i + k <= s.length; i++) out.add(s.slice(i, i + k));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
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
      console.warn(`[ifttt-repeat] missing '::' separator in '${spec}'`);
      return null;
    }
    const channel = rest.slice(0, sep);
    const params = rest.slice(sep + SEP.length);
    const colon = params.indexOf(':');
    if (!channel || colon < 0) {
      console.warn(`[ifttt-repeat] expected 'repeat:<channel>::<lookback>:<minSim>' in '${spec}'`);
      return null;
    }
    const lookback = parseInt(params.slice(0, colon), 10);
    const minSim = parseFloat(params.slice(colon + 1));
    if (!Number.isFinite(lookback) || lookback < 1 || !Number.isFinite(minSim) || minSim <= 0 || minSim > 1) {
      console.warn(`[ifttt-repeat] invalid params (lookback=${lookback}, minSim=${minSim}) in '${spec}'`);
      return null;
    }
    return {
      subscribe(onFire) {
        const buf: Array<{ text: string; norm: string; shingles: Set<string>; payload: any }> = [];
        return subscribe(channel, (payload: any) => {
          const text = searchableText(payload);
          if (!text) return;
          const norm = normalize(text);
          if (!norm) return;
          const cur = shingles(norm);
          let bestI = -1;
          let bestSim = 0;
          for (let i = 0; i < buf.length; i++) {
            const s = jaccard(cur, buf[i].shingles);
            if (s > bestSim) { bestSim = s; bestI = i; }
          }
          if (bestI >= 0 && bestSim >= minSim) {
            const prior = buf[bestI];
            onFire({
              channel,
              current: { text, payload },
              prior: { text: prior.text, payload: prior.payload },
              similarity: bestSim,
              indexInLookback: bestI,
            });
          }
          buf.push({ text, norm, shingles: cur, payload });
          while (buf.length > lookback) buf.shift();
        });
      },
    };
  },
});

/** Exported helper for callers that want to compute similarity
 *  without going through the IFTTT source. */
export function similarity(a: string, b: string): number {
  return jaccard(shingles(normalize(a)), shingles(normalize(b)));
}
