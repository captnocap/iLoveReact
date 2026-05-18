// ifttt-count — windowed-counter trigger source.
//
// Spec: `count:<channel>::<n>:<windowMs>`
//
//   <channel> is the underlying bus channel to count emits on. May
//   contain colons; the parser splits on the first '::' to keep
//   namespaces intact (`vm:abc:event:append` works).
//
//   <n> is the threshold count.
//   <windowMs> is the trailing time window in milliseconds.
//
// Fires when the channel has accumulated >= N events inside the
// trailing window. **Edge-triggered**: fires once on the transition
// from <N to ≥N and won't re-fire until the count drops back below N
// (and climbs again). For periodic re-fires while the count stays
// elevated, wrap with the composable `{ trigger, cooldown: <ms> }`.
//
// The fire payload is:
//
//   { channel, count, n, windowMs, payload, at }
//
//   `payload`  — the most recent underlying emit payload (the one
//                that pushed the counter over the threshold)
//   `at`       — fire timestamp (ms since epoch)
//
// Examples:
//
//   useIFTTT('count:event:append::6:30000', 'flag-pathology:pat_X')
//     // 6 events on event:append in 30s
//
//   useIFTTT('count:vm:abc:event:append::3:5000',
//            (e) => console.log('3 guest events in 5s', e))
//
//   useIFTTT(
//     { trigger: 'count:proc:stdout:1234::100:1000', cooldown: 10_000 },
//     'notify-user:agent is spamming stdout',
//   );

import { subscribe } from '../ffi';
import { registerIfttSource } from './ifttt-registry';

const PREFIX = 'count:';
const SEP = '::';

registerIfttSource(PREFIX, {
  match(spec) {
    if (!spec.startsWith(PREFIX)) return null;
    const rest = spec.slice(PREFIX.length);
    const sep = rest.indexOf(SEP);
    if (sep < 0) {
      console.warn(`[ifttt-count] missing '::' separator in '${spec}'`);
      return null;
    }
    const channel = rest.slice(0, sep);
    const params = rest.slice(sep + SEP.length);
    const colon = params.indexOf(':');
    if (!channel || colon < 0) {
      console.warn(`[ifttt-count] expected 'count:<channel>::<n>:<windowMs>' in '${spec}'`);
      return null;
    }
    const n = Number(params.slice(0, colon));
    const windowMs = Number(params.slice(colon + 1));
    if (!Number.isFinite(n) || n < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
      console.warn(`[ifttt-count] invalid numeric params in '${spec}' (n=${n}, windowMs=${windowMs})`);
      return null;
    }
    return {
      subscribe(onFire) {
        const stamps: number[] = [];
        let above = false;
        return subscribe(channel, (payload: any) => {
          const now = Date.now();
          stamps.push(now);
          const cutoff = now - windowMs;
          // Trim from the front. Stamps are pushed in monotonic order
          // so a single shift loop is enough.
          while (stamps.length > 0 && stamps[0] < cutoff) stamps.shift();
          const count = stamps.length;
          if (count >= n && !above) {
            above = true;
            onFire({ channel, count, n, windowMs, payload, at: now });
          } else if (count < n && above) {
            above = false;
          }
        });
      },
    };
  },
});
