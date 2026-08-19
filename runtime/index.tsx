// Entry for reactjit-QuickJS host. The host (qjs_app.zig) registers
// globalThis.__hostFlush(json) before evaling this bundle. It also calls
// globalThis.__dispatchEvent(id, type) when the user presses a Node.

// ── Host-fn no-op stubs ────────────────────────────────────────────────
// The engine fires `__ifttt_on*` globals at ~1Hz from telemetry/system
// signals (system_signals.zig). useIFTTT.ts (required below) installs the
// real handlers, but if anything in the require chain throws or runs late
// the host eval string `__ifttt_onSystemRam(N,M)` floods stderr with
// ReferenceErrors before the real shim is ever defined. Pre-defining
// no-ops here turns the worst-case from "log spam every second forever"
// into "silently ignored until useIFTTT loads." The real shims
// overwrite these unconditionally on assignment.
{
  const __g: any = globalThis as any;
  const __noop = () => {};
  for (const k of [
    '__ifttt_onKeyDown', '__ifttt_onKeyUp', '__ifttt_onClipboardChange',
    '__ifttt_onSystemFocus', '__ifttt_onSystemDrop', '__ifttt_onSystemCursor',
    '__ifttt_onSystemSlowFrame', '__ifttt_onSystemHang',
    '__ifttt_onSystemRam', '__ifttt_onSystemVram', '__ifttt_onSystemResize',
  ]) {
    if (typeof __g[k] !== 'function') __g[k] = __noop;
  }
}

// require() (not import) because __hostModules below hands the React module
// object to guest carts; ES namespaces are immutable / not the real module.
const React: any = require('react');

// Patch React.useEffect / useLayoutEffect to record per-component timing
// and dep-flip data. The patching happens at effect_tracker's module
// init (see comment at the bottom of effect_tracker.ts) so React is
// patched BEFORE @cart-entry's named imports destructure useEffect.
// Read stats via globalThis.__getTopEffects(N).
import './effect_tracker';

// Side-effect import: useIFTTT installs the real top-level set of host-fn
// shims, replacing the no-ops above with real emit-bus dispatchers.
require('./hooks/useIFTTT');

// ── system:error pump ────────────────────────────────────────────────
// Surface runtime errors on the IFTTT bus so carts can subscribe with
// useIFTTT('system:error', ...) — used by the dev shell's Doctor pane
// and by per-cart error overlays. We can't install a V8-level uncaught
// handler from JS (no setUnhandledPromise hook is exposed here), so we
// tap the most-reliable JS-side signal: console.error. Real exceptions
// caught by V8 still log through Zig's logException — the cart-side
// overlay catches the in-bundle errors that React/effects throw.
{
  const ffi = require('./ffi');
  const _origConsoleError = console.error?.bind(console);
  console.error = (...args: any[]) => {
    try {
      // Build a stable shape: first arg as message, rest stringified.
      const msg = typeof args[0] === 'string'
        ? args[0]
        : (args[0]?.message ?? String(args[0] ?? 'error'));
      const stack = (args[0] && typeof args[0] === 'object' && (args[0] as any).stack) || null;
      ffi.emit('system:error', { message: msg, stack, args, at: Date.now() });
    } catch { /* never let the pump itself crash */ }
    if (_origConsoleError) _origConsoleError(...args);
  };
}

// ── Browser API shims ────────────────────────────────────────────────
// Copy-pasted React code routinely reaches for window/document/addEventListener.
// Without these, any useEffect that wires keyboard/resize/visibility listeners
// throws synchronously — and since React uses setTimeout-scheduled commits, that
// throw kills the scheduler's pulse and freezes all subsequent re-renders.
// These shims are no-op collectors today; future work wires them to framework
// input/window events so the handlers actually fire.

type Listener = (ev: any) => void;
const _globalListeners: Record<string, Listener[]> = {};

function addEventListenerShim(type: string, fn: Listener): void {
  (_globalListeners[type] ||= []).push(fn);
}
function removeEventListenerShim(type: string, fn: Listener): void {
  const list = _globalListeners[type];
  if (!list) return;
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
}

// Don't self-assign globalThis — some engines throw on it.
(globalThis as any).window = globalThis;
(globalThis as any).self = globalThis;
(globalThis as any).addEventListener = addEventListenerShim;
(globalThis as any).removeEventListener = removeEventListenerShim;

// Minimal document shim — enough to not throw on document.* access.
(globalThis as any).document = {
  addEventListener: addEventListenerShim,
  removeEventListener: removeEventListenerShim,
  createElement: (_tag: string) => ({ style: {}, addEventListener: addEventListenerShim, removeEventListener: removeEventListenerShim }),
  querySelector: (_sel: string) => null,
  querySelectorAll: (_sel: string) => [],
  getElementById: (_id: string) => null,
  body: null,
  documentElement: null,
  hidden: false,
  visibilityState: 'visible',
};

// Expose a way for the runtime (or future bridges) to fire DOM-style events.
(globalThis as any).__fireDomEvent = (type: string, payload: any): void => {
  const list = _globalListeners[type];
  if (!list || list.length === 0) return;
  for (const fn of list.slice()) {
    try { fn(payload); } catch (e: any) {
      console.error(`[dom-event] ${type} listener error:`, e?.message || e, e?.stack || '');
    }
  }
};

// ── console polyfill ─────────────────────────────────────────────────
// Routes console.log/warn/error/info to the Zig host's __hostLog global
// (registered in framework/qjs_runtime.zig). Without this, React's error
// reporting swallows the actual exception message and only prints the
// component-stack wrapper — which turns any render crash into "The above
// error occurred in <Foo>" with no cause visible.

(function installConsole() {
  const host: any = globalThis as any;
  const log: any = typeof host.__hostLog === 'function' ? host.__hostLog : null;

  function stringifyOne(a: any): string {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'string') return a;
    if (typeof a === 'number' || typeof a === 'boolean' || typeof a === 'bigint') return String(a);
    if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
    try {
      const json = JSON.stringify(a);
      if (typeof json === 'string') return json;
    } catch {}
    try { return String(a); } catch {}
    return '[unprintable]';
  }

  function stringify(args: any[]): string {
    const parts: string[] = [];
    for (const a of args) parts.push(stringifyOne(a));
    return parts.join(' ');
  }

  // __hostLog (framework/v8_bindings_core.zig:190) takes (severity:i32, msg:string)
  // where 0=log/info, 1=warn, 2=error. The Zig binding does argToI32 — sending a
  // string here silently degrades every console.error/.warn to severity=0, so the
  // bus tags everything `js.log` @ imp 0.30 and emitJsLog's stderr fallthrough
  // (gated on severity>=1) never fires. Map level → number here.
  const SEV: Record<string, number> = { trace: 0, debug: 0, log: 0, info: 0, warn: 1, error: 2 };

  const emit = (level: string, args: any[]) => {
    const msg = stringify(args);
    if (log) { try { log(SEV[level] ?? 0, msg); } catch {} }
  };

  (globalThis as any).console = {
    log:   (...a: any[]) => emit('log',   a),
    info:  (...a: any[]) => emit('info',  a),
    warn:  (...a: any[]) => emit('warn',  a),
    error: (...a: any[]) => emit('error', a),
    debug: (...a: any[]) => emit('debug', a),
    trace: (...a: any[]) => emit('trace', a),
  };

  // React 18 concurrent mode reports the original render-time exception via
  // globalThis.reportError(err) and only console.error()s the "Above error
  // occurred in <X>" component-stack wrapper. With no reportError defined,
  // the actual TypeError/etc. vanishes — only the wrapper makes it to logs.
  if (typeof (globalThis as any).reportError !== 'function') {
    (globalThis as any).reportError = (e: any) => emit('error', [e]);
  }
})();

// ── Timer subsystem ──────────────────────────────────────────────────
// QuickJS has no event loop of its own. The Zig host calls globalThis.__jsTick(now)
// every frame (from qjs_app.zig:appTick). __jsTick walks this array and fires
// any timers whose due time has arrived. Intervals re-enqueue themselves.
if (!(globalThis as any).__zigOS_tick) {
  type TimerRecord = {
    id: number;
    due: number;       // absolute ms (performance.now() units)
    fn: () => void;
    interval: number;  // 0 = one-shot, >0 = setInterval period
    cleared: boolean;
  };

  const _timers: TimerRecord[] = [];
  let _timerSeq = 1;
  let _nowMs = 0;

  (globalThis as any).performance = (globalThis as any).performance || { now: () => _nowMs };

  // FREEZE TRIPWIRE FILE (req_4687, TEMP): events.db retains only ~90s at the
  // current render-log flood rate, so avalanche evidence must land in a file.
  // Rolling buffer, rewritten wholesale per hit — tripwire hits are rare.
  const _tripLines: string[] = [];
  (globalThis as any).__freezeTripwire = (line: string): void => {
    try {
      const clicks = ((globalThis as any).__dispatchRing || []).join(' | ');
      _tripLines.push(`${new Date().toISOString()} ${line}${clicks ? `\n  recent-clicks: ${clicks}` : ''}`);
      if (_tripLines.length > 400) _tripLines.splice(0, _tripLines.length - 400);
      const home = (globalThis as any).__env_get?.('HOME') || '/tmp';
      (globalThis as any).__fs_write?.(`${home}/.cache/reactjit/freeze-tripwire.log`, _tripLines.join('\n') + '\n');
    } catch {}
  };

  // TIMER CENSUS (req_4687, TEMP): the modeling↔painting freeze was a timer
  // avalanche — pending timers grew 10 → 215 → 8437, each firing a full-subtree
  // remount commit. When the pending count crosses a threshold (then every
  // doubling), name the leaking callbacks by source text so the loop that
  // multiplies is identified, not just counted.
  let _timerCensusNext = 128;
  const _timerCensus = (): void => {
    if (_timers.length < _timerCensusNext) return;
    _timerCensusNext *= 2;
    const bySrc = new Map<string, number>();
    for (const t of _timers) {
      if (t.cleared) continue;
      let src = '(anon)';
      try { src = String(t.fn).replace(/\s+/g, ' ').slice(0, 140); } catch {}
      bySrc.set(src, (bySrc.get(src) ?? 0) + 1);
    }
    const top = [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const report = `[timer-census] pending=${_timers.length} (next report at ${_timerCensusNext}) top sources:\n` + top.map(([s, n]) => `  x${n}: ${s}`).join('\n');
    console.warn(report);
    (globalThis as any).__freezeTripwire?.(report);
  };

  (globalThis as any).setTimeout = (fn: () => void, ms?: number): number => {
    if (typeof fn !== 'function') {
      console.error('[timer] setTimeout got non-function:', typeof fn, fn);
    }
    const id = _timerSeq++;
    _timers.push({ id, due: _nowMs + (ms ?? 0), fn, interval: 0, cleared: false });
    _timerCensus();
    return id;
  };

  (globalThis as any).setInterval = (fn: () => void, ms?: number): number => {
    if (typeof fn !== 'function') {
      console.error('[timer] setInterval got non-function:', typeof fn, fn);
    }
    const id = _timerSeq++;
    const period = Math.max(1, ms ?? 0);
    _timers.push({ id, due: _nowMs + period, fn, interval: period, cleared: false });
    _timerCensus();
    return id;
  };

  (globalThis as any).clearTimeout = (id: number): void => {
    for (const t of _timers) if (t.id === id) { t.cleared = true; return; }
  };
  (globalThis as any).clearInterval = (globalThis as any).clearTimeout;

  // Called each frame by the Zig host. `now` is in ms (engine tick time).
  let _tickCount = 0;
  let _lastDbgPrint = 0;
  // Default to once-every-10s so an idle dev terminal isn't flooded. Host
  // can set ZIGOS_VERBOSE_TICK=1 in its env to crank it back to once/sec.
  const _tickDbgIntervalMs = ((): number => {
    try {
      const envGet: any = (globalThis as any).__env_get;
      if (typeof envGet === 'function' && envGet('ZIGOS_VERBOSE_TICK')) return 1000;
    } catch {}
    return 10000;
  })();
  (globalThis as any).__jsTick = (now: number): void => {
    _nowMs = now;
    _tickCount++;
    // Print diag every _tickDbgIntervalMs: tick count, pending timers, next due.
    if (now - _lastDbgPrint > _tickDbgIntervalMs) {
      _lastDbgPrint = now;
      const nextDue = _timers.length > 0
        ? Math.min(...(_timers.filter((t) => !t.cleared).map((t) => t.due - now)))
        : -1;
      console.log(`[tick] count=${_tickCount} now=${now} timers=${_timers.length} nextDue=${nextDue}ms`);
    }
    // Two-phase: collect due timers, fire them, then cull/requeue.
    // Prevents infinite loops when interval callbacks schedule new timers.
    const due: TimerRecord[] = [];
    for (const t of _timers) {
      if (!t.cleared && t.due <= now) due.push(t);
    }
    for (const t of due) {
      if (t.cleared) continue;
      if (typeof t.fn !== 'function') {
        console.error('[timer] firing non-function callback:', t.id, typeof t.fn, t.fn);
      }
      // TICKPROBE (req_1977, TEMP): the frame partition fingered `appTick` as the
      // ~264ms cost; appTick = __jsTick, which fires setTimeout/setInterval AND
      // React's scheduler flush (it falls back to our setTimeout). Time each
      // callback and name any that blows past the threshold — this discriminates
      // "React flush (scheduler.flushWork)" from a specific gameShell/data timer.
      const _t0 = (globalThis as any).performance?.now?.() ?? now;
      try { t.fn(); } catch (e: any) {
        // Try every reasonable way to get a message out of the thrown value.
        let desc = '(no details)';
        try {
          if (e == null) desc = `threw ${e === null ? 'null' : 'undefined'}`;
          else if (typeof e === 'string') desc = e;
          else if (e.stack) desc = String(e.stack);
          else if (e.message) desc = String(e.message);
          else { try { desc = JSON.stringify(e); } catch { desc = String(e); } }
        } catch {}
        console.error(`[timer] error id=${t.id} interval=${t.interval}ms: ${desc}`);
      }
      // TICKPROBE (req_1977, TEMP): name any callback that ate the frame.
      const _dur = ((globalThis as any).performance?.now?.() ?? now) - _t0;
      if (_dur > 25) {
        let _src = '(anon)';
        try { _src = String(t.fn).replace(/\s+/g, ' ').slice(0, 120); } catch {}
        console.warn(`[tickprobe] callback id=${t.id} interval=${t.interval}ms took ${_dur.toFixed(1)}ms | fn: ${_src}`);
      }
      if (t.interval > 0 && !t.cleared) {
        t.due = now + t.interval;
      } else {
        t.cleared = true;
      }
    }
    // Compact: drop cleared/fired one-shots.
    for (let i = _timers.length - 1; i >= 0; i--) {
      if (_timers[i].cleared) _timers.splice(i, 1);
    }
  };
}

// CJS default interop (QuickJS CJS wrappers from esbuild behave like Node's).
const Reconciler: any = require('react-reconciler');

// ── Host-shared modules for <Cartridge> guests ───────────────────────
// Cartridge bundles are built with `react`, `react-reconciler`, `scheduler`
// aliased to stubs that read from this map. That way a guest cart's hooks
// run on the SAME React (and therefore the same dispatcher / handler
// registry) as the host. Anything the host already loaded; if a future
// guest needs more modules wire them in here.
(globalThis as any).__hostModules = {
  react: React,
  'react-reconciler': Reconciler,
  scheduler: (() => { try { return require('scheduler'); } catch { return null; } })(),
};

// ── Auto hot-state: wrap React.useState so every cart's useState survives a
// hot reload without opt-in. Works because esbuild preserves live bindings
// for `import { useState } from 'react'` — user code reads `_react.useState`
// at call time, so replacing the property affects every call site (ambient
// injected or explicit import) across every cart.
//
// Keying: React.useId() is a hook, but it produces a stable string per call
// site within a component's fiber. Adding it in front of useState shifts
// hook indices by 1, which is fine — React's only requirement is that hook
// order be stable across renders, which it is.
//
// Graceful fallback: when __hot_get isn't registered (ship mode, older host,
// etc.) the wrapper falls straight through to plain useState behavior.
// Auto hot-state was disabled 2026-05-03: it silently snapshotted every
// useState into the hotstate atom store and replayed it on the next reload.
// When a cart's state schema drifted between edits (eg. composer's `query`
// useState briefly held a non-string), the stale snapshot crash-looped the
// new bundle on every hot reload. Carts that genuinely need cross-reload
// persistence should call useHotState explicitly.
//
// (Original implementation kept in git history; restore from there if a
// schema-versioned variant ever lands.)

import { hostConfig, setTransportFlush, handlerRegistry } from '../renderer/hostConfig';
import { prepareContext, releaseContext } from './effectContext';
import { decodeSdlModifiers } from './input/sdlModifiers';
// @ts-ignore — bundle-time alias, resolved by esbuild-config.mjs (old path) or
// scripts/cart-bundle.js via --alias:@cart-entry=<abs path> (v8cli path).
import App from '@cart-entry';

// WebSocket shim is opt-in: carts that need globalThis.WebSocket call
// installBrowserShims() / installWebSocketShim() themselves. Importing it
// unconditionally pulled runtime/hooks/websocket.ts into every bundle,
// which forced the __ws_* bindings into every binary even for carts that
// don't touch WebSockets — breaking the source-gated rule.

// Flush path: host's __hostFlush receives the JSON string.
setTransportFlush((cmds: any) => {
  const payload = typeof cmds === 'string' ? cmds : JSON.stringify(cmds);
  const host: any = globalThis as any;
  const hf: any = host.__hostFlush;
  if (typeof hf === 'function') {
    hf(payload);
    return;
  }

  // Hermes CLI fallback: emit the same line protocol the Zig hosts parse.
  const printer: any = host.print;
  if (typeof printer === 'function') {
    printer(`CMD ${payload}`);
  }
});

function getInputTextForNode(id: number): string {
  const host: any = globalThis as any;
  const getter: any = host.__getInputTextForNode;
  if (typeof getter !== 'function') return '';
  const value = getter(id);
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function getPreparedRightClickPayload() {
  const host: any = globalThis as any;
  const getter: any = host.__getPreparedRightClick;
  if (typeof getter !== 'function') return {};
  const payload = getter();
  return payload && typeof payload === 'object' ? payload : {};
}

function getPreparedScrollPayload() {
  const host: any = globalThis as any;
  const getter: any = host.__getPreparedScroll;
  if (typeof getter !== 'function') return {};
  const payload = getter();
  return payload && typeof payload === 'object' ? payload : {};
}

function getPointerPayload(id: number, type: string) {
  const host: any = globalThis as any;
  const read = (name: string, fallback = 0): number => {
    const fn = host[name];
    if (typeof fn !== 'function') return fallback;
    const n = Number(fn());
    return Number.isFinite(n) ? n : fallback;
  };
  const down = read('getMouseDown', 0) > 0;
  const modifiers = decodeSdlModifiers(read('getMouseMods', 0));
  // Device-aware pointer (req_3089): the host tracks which physical device last
  // drove the cursor (getPointerDevice: 0 mouse, 1 pen) and the pen's live
  // pressure axis. A pen event carries real Wacom pressure; a mouse keeps the
  // old binary button-state pressure, matching the web PointerEvent contract.
  const pen = read('getPointerDevice', 0) > 0;
  return {
    targetId: id,
    type,
    x: read('getMouseX', 0),
    y: read('getMouseY', 0),
    button: 1,
    pointerType: pen ? 'pen' : 'mouse',
    pressure: pen ? read('getPenPressure', 0) : (down ? 1 : 0),
    buttons: down ? 1 : 0,
    ...modifiers,
    preventDefault() { this.defaultPrevented = true; },
    defaultPrevented: false,
  };
}

function dispatchAliases(id: number, aliases: string[], ...args: any[]) {
  const h = handlerRegistry.get(id);
  if (!h) return;
  const host: any = globalThis as any;
  const stampHandler = host.__clickLatencyStampHandler;
  for (const name of aliases) {
    const fn = h[name];
    if (typeof fn === 'function') {
      if (typeof stampHandler === 'function') {
        try { stampHandler(); } catch {}
      }
      fn(...args);
      break;
    }
  }
}

function eventAliases(type: string): string[] {
  if (type === 'onClick') return ['onClick', 'onPress'];
  if (type === 'onPress') return ['onPress', 'onClick'];
  if (type === 'onMouseDown') return ['onMouseDown', 'onPointerDown', 'onPressIn'];
  if (type === 'onMouseMove') return ['onMouseMove', 'onPointerMove'];
  if (type === 'onMouseUp') return ['onMouseUp', 'onPointerUp', 'onPressOut'];
  if (type === 'onHoverEnter') return ['onHoverEnter', 'onMouseEnter'];
  if (type === 'onHoverExit') return ['onHoverExit', 'onMouseLeave'];
  return [type];
}

(globalThis as any).__beginJsEvent = () => {};
(globalThis as any).__endJsEvent = () => {};

// Event dispatch entry from Zig — host calls this inside js_on_press eval.
(globalThis as any).__dispatchEvent = (id: number, type: string) => {
  const host: any = globalThis as any;
  const routeInput = host.__routeInputMaybe;
  if (typeof routeInput === 'function') {
    try { routeInput(id, type); } catch {}
  }
  const stampDispatch = host.__clickLatencyStampDispatch;
  if (typeof stampDispatch === 'function') {
    try { stampDispatch(); } catch {}
  }
  // Route diagnostic through __hostLog directly — bypass the console polyfill
  // so we see dispatch logs even if something later overwrites globalThis.console.
  const hl: any = host.__hostLog;
  const h = handlerRegistry.get(id);
  const keys = h ? Object.keys(h).join(',') : '(no-entry)';
  if (typeof hl === 'function') { try { hl(0, `[dispatch] id=${id} type=${type} handlers=${keys}`); } catch {} }
  // DISPATCH BREADCRUMBS (req_4687, TEMP): keep the last few clicks so the
  // freeze-tripwire reports can say which press preceded a timer avalanche.
  if (type === 'onClick' || type === 'onMouseDown') {
    const g: any = globalThis as any;
    const ring: string[] = g.__dispatchRing || (g.__dispatchRing = []);
    ring.push(`${Date.now()} ${type} id=${id} handlers=${keys}`);
    if (ring.length > 8) ring.splice(0, ring.length - 8);
  }
  const dT0 = (globalThis as any).performance?.now?.() ?? Date.now();
  try {
    const payload = type === 'onMouseDown' || type === 'onMouseMove' || type === 'onMouseUp'
      ? getPointerPayload(id, type)
      : { targetId: id };
    dispatchAliases(id, eventAliases(type), payload);
  } catch (e: any) {
    if (typeof hl === 'function') {
      try { hl(2, `[dispatch] error id=${id} type=${type}: ${e?.message || e} ${e?.stack || ''}`); } catch {}
    }
  }
  const dT1 = (globalThis as any).performance?.now?.() ?? Date.now();
  if ((dT1 - dT0) > 50) {
    try { hl(0, `[dispatch-timing] id=${id} type=${type} handler=${(dT1-dT0).toFixed(1)}ms`); } catch {}
  }
};

const registerDispatch: any = (globalThis as any).__registerDispatch;
if (typeof registerDispatch === 'function') {
  try {
    registerDispatch((id: number, type: string) => {
      return (globalThis as any).__dispatchEvent(id, type);
    });
  } catch {}
}

// Layout dispatch entry — fired by framework/layout.zig:setRect for any node
// flagged has_on_layout. Routes the rect to the user's onLayout handler or
// useMeasure subscription. Called once per node per dirty layout pass.
(globalThis as any).__dispatchLayout = (id: number, x: number, y: number, w: number, h: number) => {
  const h_ = handlerRegistry.get(id);
  const fn = h_ && h_.onLayout;
  if (typeof fn !== 'function') return;
  try {
    fn({ x, y, width: w, height: h });
  } catch (e: any) {
    const hl: any = (globalThis as any).__hostLog;
    if (typeof hl === 'function') {
      try { hl(2, `[dispatchLayout] id=${id}: ${e?.message || e}`); } catch {}
    }
  }
};

(globalThis as any).__dispatchInputChange = (id: number, inputSlot?: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onInputChange'); } catch {}
    }
    const slot = typeof inputSlot === 'number' ? inputSlot : id;
    const text = getInputTextForNode(slot);
    const payload = { targetId: id, text };
    dispatchAliases(id, ['onChangeText', 'onChange', 'onInput'], text, payload);
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchInputSubmit = (id: number, inputSlot?: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onInputSubmit'); } catch {}
    }
    const slot = typeof inputSlot === 'number' ? inputSlot : id;
    const text = getInputTextForNode(slot);
    const payload = { targetId: id, text };
    dispatchAliases(id, ['onSubmit', 'onSubmitEditing'], text, payload);
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchInputFocus = (id: number) => {
  try {
    dispatchAliases(id, ['onFocus'], { targetId: id });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchInputBlur = (id: number) => {
  try {
    dispatchAliases(id, ['onBlur'], { targetId: id });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchInputKey = (id: number, keyCode: number, mods: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onInputKey'); } catch {}
    }
    dispatchAliases(id, ['onKeyDown'], { targetId: id, keyCode, mods });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchRightClick = (id: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onRightClick'); } catch {}
    }
    const payload = { targetId: id, ...getPreparedRightClickPayload() };
    dispatchAliases(id, ['onRightClick', 'onContextMenu'], payload);
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchScroll = (id: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onScroll'); } catch {}
    }
    const payload = { targetId: id, ...getPreparedScrollPayload() };
    dispatchAliases(id, ['onScroll'], payload);
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchCanvasMove = (id: number, gx: number, gy: number) => {
  try {
    const routeInput = (globalThis as any).__routeInputMaybe;
    if (typeof routeInput === 'function') {
      try { routeInput(id, 'onCanvasMove'); } catch {}
    }
    dispatchAliases(id, ['onMove'], { targetId: id, gx, gy });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

// <Slider> (SLIDER-0611): the engine owns the thumb during a drag and streams
// the value here (throttled); commit fires once on release with the settle.
(globalThis as any).__dispatchSliderChange = (id: number, value: number) => {
  try {
    dispatchAliases(id, ['onChange', 'onValueChange'], { targetId: id, value });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

(globalThis as any).__dispatchSliderCommit = (id: number, value: number) => {
  try {
    dispatchAliases(id, ['onCommit', 'onChangeEnd'], { targetId: id, value });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

// Slider hover pointer-value (MEDIASLIDER-0705): fires only when the pointer
// crosses into a new hoverStep-sized bucket, and once with -1 on leave —
// quantized-by-meaning, so wiring setState here is cheap by construction.
(globalThis as any).__dispatchSliderHover = (id: number, value: number) => {
  try {
    dispatchAliases(id, ['onHoverValue', 'onHover'], { targetId: id, value });
  } catch (e) {
    // swallow — host prints nothing for eval exceptions except via QJS itself
  }
};

// Effect render dispatch. Host calls this once per frame per Effect node with
// a zero-copy ArrayBuffer view of the pixel buffer. We build (or reuse) a
// context object and invoke the user's onRender handler with it. The handler
// must finish all drawing before returning — host detaches the ArrayBuffer
// immediately after the call completes.
(globalThis as any).__dispatchEffectRender = (
  id: number,
  buffer: ArrayBuffer,
  width: number,
  height: number,
  stride: number,
  time: number,
  dt: number,
  mouse_x: number,
  mouse_y: number,
  mouse_inside: boolean,
  frame: number,
) => {
  const h = handlerRegistry.get(id);
  const fn = h?.onRender;
  if (typeof fn !== 'function') return;
  try {
    const ctx = prepareContext(id, buffer, width, height, stride, time, dt, mouse_x, mouse_y, mouse_inside, frame);
    fn(ctx);
  } catch (e: any) {
    const host: any = globalThis as any;
    const hl: any = host.__hostLog;
    if (typeof hl === 'function') {
      try { hl(2, `[effect] id=${id} error: ${e?.message || e} ${e?.stack || ''}`); } catch {}
    }
  }
};

(globalThis as any).__releaseEffectContext = (id: number) => {
  try { releaseContext(id); } catch {}
};

const reconciler = Reconciler(hostConfig);
// React-reconciler's 7th arg is onRecoverableError — fires for hydration /
// concurrent retries, NOT for uncaught render exceptions.
const onReactError = (e: any) => {
  try { console.error('[react]', e?.stack || e?.message || e); } catch {}
};

// React-reconciler 0.29 in DEV only logs the *original* render-time error via
// the browser's invokeGuardedCallback fake-DOM-event trick (line 14305 of
// react-reconciler.development.js). With no window/document it falls back to
// invokeGuardedCallbackProd which silently stashes the error — only the
// "Above error occurred in <X>" component-stack wrapper survives. To surface
// the real error, mount a top-level error boundary; componentDidCatch
// receives (error, info) before logCapturedError runs.
class GlobalErrorBoundary extends (React as any).Component {
  componentDidCatch(error: any, info: any) {
    const msg = error?.stack || error?.message || String(error);
    const stack = info?.componentStack || '';
    console.error('[react-uncaught] ' + msg + (stack ? '\ncomponent-stack:' + stack : ''));
  }
  render() { return (this.props as any).children; }
}

const container = reconciler.createContainer({ id: 0 }, 0, null, false, null, '', onReactError, null);
reconciler.updateContainer(
  React.createElement(GlobalErrorBoundary as any, null, React.createElement(App, {})),
  container, null, null,
);
