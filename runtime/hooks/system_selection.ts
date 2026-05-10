/**
 * system_selection — IFTTT trigger sources for system-wide text highlights.
 *
 * Backed by framework/selection_watch.zig (PRIMARY-selection poll). Fires
 * after the user finishes a mouse-drag highlight; debounced so rapid
 * intermediate updates while dragging coalesce into a single fire.
 *
 *   useIFTTT('select:any',          (e) => …)   // every fire, including ''
 *   useIFTTT('select:nonempty',     (e) => …)   // text.length > 0
 *   useIFTTT('select:long:32',      (e) => …)   // text.length >= 32
 *   useIFTTT('select:cleared',      (e) => …)   // selection went empty
 *
 * Event payload (for non-cleared sources):
 *   { text, textLen, downX, downY, upX, upY, screenW, screenH, at }
 *
 * The (downX, downY) and (upX, upY) pair gives a coarse drag rectangle —
 * enough to place a UI bubble outside the highlighted region. See
 * resolveBubbleXY() in cart/selection_test.tsx for the position math.
 */

import { subscribe } from '../ffi';
import { registerIfttSource } from './ifttt-registry';

registerIfttSource('select:cleared', {
  match(spec) {
    if (spec !== 'select:cleared') return null;
    return { subscribe(onFire) { return subscribe('system:selection:cleared', onFire); } };
  },
});

registerIfttSource('select:any', {
  match(spec) {
    if (spec !== 'select:any') return null;
    return { subscribe(onFire) { return subscribe('system:selection', onFire); } };
  },
});

registerIfttSource('select:nonempty', {
  match(spec) {
    if (spec !== 'select:nonempty') return null;
    return {
      subscribe(onFire) {
        return subscribe('system:selection', (ev: any) => {
          if (ev?.text && ev.text.length > 0) onFire(ev);
        });
      },
    };
  },
});

registerIfttSource('select:long:', {
  match(spec) {
    if (!spec.startsWith('select:long:')) return null;
    const min = Math.max(1, Number(spec.slice('select:long:'.length)) || 1);
    return {
      subscribe(onFire) {
        return subscribe('system:selection', (ev: any) => {
          if (ev?.text && ev.text.length >= min) onFire(ev);
        });
      },
    };
  },
});

// Re-fired form for parity with select:* — same underlying clipboard channel.
registerIfttSource('clipboard:copy', {
  match(spec) {
    if (spec !== 'clipboard:copy') return null;
    return {
      subscribe(onFire) {
        return subscribe('system:clipboard', (text: any) => {
          if (typeof text === 'string' && text.length > 0) onFire({ text, at: Date.now() });
        });
      },
    };
  },
});
