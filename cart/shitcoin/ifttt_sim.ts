// ifttt_sim — bridge between the sim's emit channels and the global
// IFTTT registry. Side-effect import: pulling this module registers
// every sim:* trigger source + every trade:*/stake:*/ach:*/notify:*
// action verb against runtime/hooks/ifttt/registry.ts. Scripts +
// achievements then drop down to one-liner `useIFTTT(spec, action)`
// declarations.
//
// SHAPE PASS scope: register the sources that can derive from
// already-emitted Zig channels (sim:trade, sim:wallet, sim:tape, etc.)
// + a handful of action verbs against the existing sim.* surface.
// Threshold triggers that need Zig-side emit (sim:price:<id>:above:<N>,
// sim:pattern:<id>:to:pump, sim:rug:any) are stubbed with TODO comments
// — they land when the Zig emit-at-write-site hook lands in the next
// pass.

import { subscribe } from '../../runtime/ffi';
import {
  registerIfttSource,
  registerIfttAction,
  type IfttSubscription,
} from '../../runtime/hooks/ifttt/registry';
import { sim } from './sim';

// ── Trigger sources ───────────────────────────────────────────────────

function parseFilter(rest: string): number | null {
  if (!rest.startsWith(':')) return null;
  const n = parseInt(rest.slice(1), 10);
  return Number.isFinite(n) ? n : null;
}

// sim:trade:executed:buy[:<token_id>]
registerIfttSource('sim:trade:executed:buy', {
  match(spec): IfttSubscription {
    const rest = spec.slice('sim:trade:executed:buy'.length);
    const filterId = parseFilter(rest);
    return {
      subscribe(onFire) {
        return subscribe('sim:trade', (raw: any) => {
          let t: any;
          try { t = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (t?.kind !== 'buy') return;
          if (filterId != null && t.id !== filterId) return;
          onFire(t);
        });
      },
    };
  },
});

// sim:trade:executed:sell[:<token_id>]
registerIfttSource('sim:trade:executed:sell', {
  match(spec): IfttSubscription {
    const rest = spec.slice('sim:trade:executed:sell'.length);
    const filterId = parseFilter(rest);
    return {
      subscribe(onFire) {
        return subscribe('sim:trade', (raw: any) => {
          let t: any;
          try { t = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (t?.kind !== 'sell') return;
          if (filterId != null && t.id !== filterId) return;
          onFire(t);
        });
      },
    };
  },
});

// sim:trade:executed (any direction, any token)
registerIfttSource('sim:trade:executed', {
  match(): IfttSubscription {
    return {
      subscribe(onFire) {
        return subscribe('sim:trade', (raw: any) => {
          let t: any;
          try { t = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (!t) return;
          onFire(t);
        });
      },
    };
  },
});

// sim:trade:reset — full run boundary
registerIfttSource('sim:trade:reset', {
  match(): IfttSubscription {
    return {
      subscribe(onFire) {
        return subscribe('sim:trade:reset', (raw: any) => onFire(raw));
      },
    };
  },
});

// sim:wallet:milestone:<usd> — fires on false→true edge when wallet
// totalUsd crosses the threshold UP. Implemented via the same
// snapshot poll the cart already runs.
const _milestoneEdgeState = new Map<number, boolean>();
registerIfttSource('sim:wallet:milestone:', {
  match(spec): IfttSubscription | null {
    const usd = parseFloat(spec.slice('sim:wallet:milestone:'.length));
    if (!Number.isFinite(usd)) return null;
    return {
      subscribe(onFire) {
        // Bus emits sim:wallet on the snapshot cadence. We track the
        // crossing edge per threshold so each milestone fires at most
        // once per crossing.
        return subscribe('sim:wallet', (raw: any) => {
          let w: any;
          try { w = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (!w) return;
          const above = (w.totalUsd ?? 0) >= usd;
          const prev = _milestoneEdgeState.get(usd) ?? false;
          _milestoneEdgeState.set(usd, above);
          if (above && !prev) onFire({ totalUsd: w.totalUsd, threshold: usd });
        });
      },
    };
  },
});

// sim:wallet:bankrupted — fires when totalUsd drops below $10
let _bankruptEdge = false;
registerIfttSource('sim:wallet:bankrupted', {
  match(): IfttSubscription {
    return {
      subscribe(onFire) {
        return subscribe('sim:wallet', (raw: any) => {
          let w: any;
          try { w = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (!w) return;
          const bankrupt = (w.totalUsd ?? 0) <= 10;
          if (bankrupt && !_bankruptEdge) onFire({ totalUsd: w.totalUsd });
          _bankruptEdge = bankrupt;
        });
      },
    };
  },
});

// sim:staking:harvested — derives from sim.harvest() being called.
// The Zig side doesn't currently emit a dedicated event, so the
// `ach:emit` action verb is the bridge: script apps that call
// sim.harvest can also emit('ach:emit:staking:harvested').
// SHAPE PASS placeholder — wire to a real Zig emit in next pass.

// === Achievement synthetic event channel ===
// `ach:emit:<id>` actions push onto this channel; useIFTTT bindings
// subscribe via `ach:<id>`. Lets achievements + scripts emit custom
// events that aren't tied to a sim subsystem.
const _achEventListeners = new Map<string, Set<(p: any) => void>>();

registerIfttSource('ach:', {
  match(spec): IfttSubscription {
    const id = spec.slice('ach:'.length);
    return {
      subscribe(onFire) {
        let set = _achEventListeners.get(id);
        if (!set) { set = new Set(); _achEventListeners.set(id, set); }
        set.add(onFire);
        return () => { set?.delete(onFire); };
      },
    };
  },
});

// ── Action verbs ──────────────────────────────────────────────────────

// trade:buy:<id>:<usd>[:max-impact:<f>]
registerIfttAction('trade:buy:', (rest) => {
  const parts = rest.split(':');
  const id = parseInt(parts[0], 10);
  const usd = parseFloat(parts[1]);
  if (!Number.isFinite(id) || !Number.isFinite(usd)) return;
  // max-impact filter handled by the cart's pre-flight; the sim itself
  // executes whatever quote it computes. For shape pass we ignore it.
  sim.buy(id, usd);
});

// trade:sell:<id>:<amount>
registerIfttAction('trade:sell:', (rest) => {
  const parts = rest.split(':');
  const id = parseInt(parts[0], 10);
  const amt = parseFloat(parts[1]);
  if (!Number.isFinite(id) || !Number.isFinite(amt)) return;
  sim.sell(id, amt);
});

// stake:harvest:<poolId>
registerIfttAction('stake:harvest:', (rest) => {
  if (rest === 'all') {
    // SHAPE PASS: stub. The harvest-all batched action lands when the
    // staking module exposes a pool iterator on the cart side.
    return;
  }
  const id = parseInt(rest, 10);
  if (!Number.isFinite(id)) return;
  sim.harvest(id);
});

// stake:stake:<poolId>:<amount>
registerIfttAction('stake:stake:', (rest) => {
  const parts = rest.split(':');
  const id = parseInt(parts[0], 10);
  const amt = parseFloat(parts[1]);
  if (!Number.isFinite(id) || !Number.isFinite(amt)) return;
  sim.stake(id, amt);
});

// stake:unstake:<poolId>:<amount>
registerIfttAction('stake:unstake:', (rest) => {
  const parts = rest.split(':');
  const id = parseInt(parts[0], 10);
  const amt = parseFloat(parts[1]);
  if (!Number.isFinite(id) || !Number.isFinite(amt)) return;
  sim.unstake(id, amt);
});

// ach:emit:<id> — fires an `ach:<id>` event on the bus, so achievements
// (or other listeners) can react to synthetic gameplay events that
// don't correspond to a sim emit.
registerIfttAction('ach:emit:', (rest, payload) => {
  const set = _achEventListeners.get(rest);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(payload); } catch {}
  }
});

// notify:<text> — toast notification. Cart side hooks the renderer.
const _notifyListeners = new Set<(text: string) => void>();
export function onNotify(fn: (text: string) => void): () => void {
  _notifyListeners.add(fn);
  return () => { _notifyListeners.delete(fn); };
}
registerIfttAction('notify:', (rest) => {
  for (const fn of Array.from(_notifyListeners)) {
    try { fn(rest); } catch {}
  }
});

// ── Module bootstrap ─────────────────────────────────────────────────
// Side-effect imports above register every source + action. Calling
// init() does nothing — but ensures the import isn't tree-shaken away.
export function initIftttSim(): void {
  // Intentional no-op. Exporting a function gives callers a stable
  // reference to import (cart/shitcoin/index.tsx calls initIftttSim()
  // so esbuild keeps the side effects).
}
