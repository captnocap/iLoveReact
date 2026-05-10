/**
 * useIFTTT — If This Then That, as a one-liner.
 *
 * Wire any trigger to any action. Both sides accept either a string DSL
 * or a function. Mix and match freely.
 *
 * ── String triggers ─────────────────────────────────────────
 *   'key:<key>'              keydown (e.g. 'key:space', 'key:escape')
 *   'key:up:<key>'           keyup
 *   'key:ctrl+<k>'           key combo (e.g. 'key:ctrl+s', 'key:ctrl+shift+z')
 *   'click'                  any mouse click anywhere
 *   'timer:every:<ms>'       repeating interval (Zig-side wheel, frame-quantized)
 *   'timer:once:<ms>'        single-shot delay (Zig-side wheel)
 *   'mount'                  fires once on component mount
 *   'state:<key>:<value>'    fires when shared state matches value
 *   '<event>'                any custom bus event (paired with 'send:<event>')
 *
 * ── System triggers (pumped by Zig, subscribe like any bus event) ──
 *   'system:clipboard'       OS clipboard text changed; payload = new text
 *   'system:focus'           window gained focus;  payload = { at }
 *   'system:blur'            window lost focus;    payload = { at }
 *   'system:fileDropped'     OS drag-and-drop;     payload = path string
 *   'system:cursor:move'     cursor moved;         payload = { x, y, dx, dy }
 *   'system:slowFrame'       frame over budget;    payload = { ms }
 *   'system:hang'            engine hang detected; payload = { count }
 *   'system:ram'             RAM sample;           payload = { used, total, percent }
 *   'system:vram'            VRAM sample;          payload = { used, total, percent }
 *   'system:resize'          window resized;       payload = { w, h }
 *   'system:claude'          any Claude Code hook event; payload = full entry
 *   'system:claude:<tool>'   filtered by tool name (e.g. 'system:claude:bash')
 *   'system:claude:<phase>'  filtered by phase    (e.g. 'system:claude:pre')
 *   'system:error'           runtime error; payload = { message, stack?, args, at }
 *                            — pumped from console.error by runtime/index.tsx
 *
 * ── String actions ──────────────────────────────────────────
 *   'state:set:<key>:<val>'  set shared state
 *   'state:toggle:<key>'     toggle boolean shared state
 *   'send:<type>'            emit a bus event (payload = trigger payload)
 *   'log:<message>'          console.log (debugging)
 *   'clipboard:<text>'       copy text to system clipboard
 *
 * ── Function triggers ──────────────────────────────────────
 *   () => boolean            reactive condition — fires on false→true edge.
 *                            Polled at frame rate via requestAnimationFrame
 *                            (decoupled from host render cycle).
 *
 * ── Function actions ───────────────────────────────────────
 *   (event?) => void         imperative callback, receives trigger payload
 *
 * @example
 *   useIFTTT('key:space',         'state:toggle:paused')
 *   useIFTTT('timer:every:5000',  'log:tick!')
 *   useIFTTT('key:ctrl+s',        () => save())
 *   useIFTTT(() => score > 100,   'send:victory')
 *   useIFTTT('victory',           (e) => showWin(e))
 *
 * ── Render behavior ────────────────────────────────────────
 *
 * Lazy reactivity. `fired` / `lastEvent` / `lastFiredAt` are getters
 * reading directly from the Zig-side registry (counters) and a JS-side
 * mirror (lastEvent). The host re-renders on fire ONLY if any of those
 * fields has been read at least once during the component's lifetime.
 * Carts that just pass an action and ignore the return value are
 * zero-rerender — useIFTTT('timer:every:100', tick) won't re-render the
 * host 10x/sec.
 *
 * Internals: trigger families and action verbs are registered through
 * `ifttt-registry.ts`. Other hooks (process, voice, fs, host, …) can
 * `registerIfttSource`/`registerIfttAction` to expose themselves through
 * this same DSL. The shared bus lives in `runtime/ffi.ts`. Timers,
 * fired-count, and lastFiredAt live in framework/ifttt_zig.zig and are
 * driven by the engine frame loop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as clipboard from './clipboard';
import { subscribe, emit, callHost } from '../ffi';
import {
  registerIfttSource,
  registerIfttAction,
  setIfttFallback,
  resolveTrigger,
  dispatchAction,
  type IfttSubscription,
} from './ifttt-registry';
import {
  compileTrigger,
  isComposable,
  substituteAction,
  type IFTTTComposable,
} from './ifttt-compose';

// ── Source side-effects ───────────────────────────────────────────────
//
// useIFTTT is the natural entry point for any cart using the DSL, so we
// pull in the bundled trigger/action sources here. Each module's
// register*() calls fire on import, populating the registry before any
// useIFTTT() subscription runs. Carts get full source coverage without
// having to import each owning hook explicitly.
import './process';          // proc:* triggers + actions, per-pid memory
import './useFileWatch';     // fs:* triggers
import './system_selection'; // select:* + clipboard:copy triggers
import './ifttt-match';      // match:<channel>::<pattern> generic text-pattern source
import './ifttt-count';      // count:<channel>::<n>:<windowMs> windowed counter
import './ifttt-firsthit';   // firsthit:<channel>::<pattern> single-shot pattern
import './ifttt-repeat';     // repeat:<channel>::<lookback>:<minSim> claim-shape similarity
import './turn-tracker';     // turn:start / turn:end / turn:tool-use canonical channels

// ── Bus + state store ─────────────────────────────────────────────────────

type Handler = (payload?: any) => void;

/** Subscribe to a bus channel. Back-compat facade over ffi.subscribe — both
 *  share the same listener registry, so JS- and Zig-origin events are
 *  reachable through either API. */
export function busOn(event: string, fn: Handler): () => void {
  return subscribe(event, fn);
}

/** Emit on the bus synchronously. Back-compat facade over ffi.emit. */
export function busEmit(event: string, payload?: any): void {
  emit(event, payload);
}

// Shared state — persisted in Zig via __ifttt_state_get/set, which routes
// through framework/hotstate.zig (the same store useHotState uses, with an
// `ifttt:` key prefix). Survives JS hot reloads — when the V8 isolate is
// torn down and rebuilt, the next setSharedState call still sees its prior
// value live in Zig. JS keeps a tiny last-written cache to skip no-op sets
// (otherwise watchers would fire every time `state:set:flag:true` runs,
// even when nothing changed).
const _stateLastJson = new Map<string, string>();
const stateWatchers = new Map<string, Set<Handler>>();

export function getSharedState(key: string): any {
  // Prefer the local cache (cheap) and fall through to Zig (survives reload).
  if (_stateLastJson.has(key)) {
    try { return JSON.parse(_stateLastJson.get(key)!); } catch { return undefined; }
  }
  const json = callHost<string | null>('__ifttt_state_get', null, key);
  if (json == null) return undefined;
  _stateLastJson.set(key, json);
  try { return JSON.parse(json); } catch { return undefined; }
}

export function setSharedState(key: string, value: any): void {
  let json: string;
  try { json = JSON.stringify(value); } catch { return; }
  if (_stateLastJson.get(key) === json) return;
  _stateLastJson.set(key, json);
  callHost('__ifttt_state_set', undefined, key, json);
  const watchers = stateWatchers.get(key);
  if (watchers) for (const fn of Array.from(watchers)) {
    try { fn(value); } catch (e: any) {
      console.error(`[ifttt] state watcher error for '${key}':`, e?.message || e);
    }
  }
}

function watchSharedState(key: string, fn: Handler): () => void {
  let set = stateWatchers.get(key);
  if (!set) { set = new Set(); stateWatchers.set(key, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

// ── Wire registry (JS side) ──────────────────────────────────────────────
//
// Every useIFTTT() call allocates a Zig wireId at mount. The Zig side
// tracks fired/lastAt counters; the JS side keeps a fire dispatcher per
// wire so the Zig timer wheel can call back into JS (the cart-supplied
// action callback is, of necessity, JS-side).

type WireEntry = {
  fire: (ev?: any) => void;
  lastEvent?: any;
};
const _wires = new Map<number, WireEntry>();

const G = globalThis as any;
if (!G.__ifttt_dispatch_installed) {
  G.__ifttt_dispatch_installed = true;
  // Called by framework/ifttt_zig.zig when a registered Zig timer fires.
  G.__ifttt_dispatch_timer = (wireId: number) => {
    const w = _wires.get(wireId);
    if (!w) return;
    try { w.fire({ at: Date.now() }); } catch (e: any) {
      console.error('[ifttt] timer dispatch error:', e?.message || e);
    }
  };
  // Called by framework/ifttt_zig.zig when a registered key match fires.
  // The packed key (sym|mod) lives in Zig and is read back on demand —
  // saves passing two ints through callGlobalInt.
  G.__ifttt_dispatch_key = (wireId: number) => {
    const w = _wires.get(wireId);
    if (!w) return;
    try {
      const packed = callHost<number>('__ifttt_last_key', 0);
      w.fire(decodeKey(packed));
    } catch (e: any) {
      console.error('[ifttt] key dispatch error:', e?.message || e);
    }
  };
}

function allocWire(fire: (ev?: any) => void): number {
  const id = callHost<number>('__ifttt_wire_alloc', 0);
  if (id > 0) _wires.set(id, { fire });
  return id;
}

function freeWire(id: number): void {
  if (id <= 0) return;
  _wires.delete(id);
  callHost('__ifttt_wire_free', undefined, id);
}

function bumpWire(id: number, ev?: any): void {
  if (id <= 0) return;
  callHost('__ifttt_wire_bump', undefined, id, Date.now());
  const w = _wires.get(id);
  if (w) w.lastEvent = ev;
}

// ── Global key listening ──────────────────────────────────────────────────
//
// The framework's engine.zig already invokes __ifttt_onKeyDown(packed) and
// __ifttt_onKeyUp(packed) on every SDL key event (regardless of focus). We
// install handlers here that decode the packed payload (mod<<16 | sym),
// translate the SDL keycode + modifier mask to friendly names, and emit on
// the shared bus. Trigger sources subscribe to those internal channels.
//
// Packed format from Zig: i64 = (mod << 16) | (sym & 0xFFFF)
//   sym  — SDL3 keycode (SDLK_*). ASCII for printable chars; specific
//          high values for non-printable keys (Enter, Escape, …).
//   mod  — SDL_Keymod bitmask: 1=LSHIFT 2=RSHIFT 64=LCTRL 128=RCTRL 256=LALT
//          512=RALT 1024=LGUI 2048=RGUI etc.

const SDL_KMOD_SHIFT = 0x0003;
const SDL_KMOD_CTRL = 0x00C0;
const SDL_KMOD_ALT = 0x0300;
const SDL_KMOD_GUI = 0x0C00;

const SDL_KEY_NAMES: Record<number, string> = {
  8: 'backspace', 9: 'tab', 13: 'enter', 27: 'escape', 32: 'space', 127: 'delete',
  // Arrow keys (SDL3 scancode | 0x40000000)
  0x40000050: 'left', 0x40000052: 'up', 0x4000004f: 'right', 0x40000051: 'down',
  // Function keys
  0x4000003a: 'f1', 0x4000003b: 'f2', 0x4000003c: 'f3', 0x4000003d: 'f4',
  0x4000003e: 'f5', 0x4000003f: 'f6', 0x40000040: 'f7', 0x40000041: 'f8',
  0x40000042: 'f9', 0x40000043: 'f10', 0x40000044: 'f11', 0x40000045: 'f12',
  // Editing / navigation
  0x40000049: 'insert', 0x4000004a: 'home', 0x4000004d: 'end',
  0x4000004b: 'pageup', 0x4000004e: 'pagedown',
};

function decodeKey(packed: number): { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean } {
  const sym = packed & 0xffff;
  const mod = (packed >> 16) & 0xffff;
  let key = SDL_KEY_NAMES[sym];
  if (!key) {
    if (sym >= 0x20 && sym < 0x7f) key = String.fromCharCode(sym).toLowerCase();
    else key = `sdl:${sym}`;
  }
  return {
    key,
    ctrlKey: (mod & SDL_KMOD_CTRL) !== 0,
    shiftKey: (mod & SDL_KMOD_SHIFT) !== 0,
    altKey: (mod & SDL_KMOD_ALT) !== 0,
    metaKey: (mod & SDL_KMOD_GUI) !== 0,
  };
}

if (!G.__ifttt_handlers_installed) {
  G.__ifttt_handlers_installed = true;
  G.__ifttt_onKeyDown = (packed: number) => emit('__keydown', decodeKey(packed));
  G.__ifttt_onKeyUp = (packed: number) => emit('__keyup', decodeKey(packed));
  G.__ifttt_onClipboardChange = () => {
    let text = '';
    try { text = clipboard.get(); } catch { /* ignore */ }
    emit('system:clipboard', text);
  };
  G.__ifttt_onSystemFocus = (gained: number) => {
    emit(gained ? 'system:focus' : 'system:blur', { at: Date.now() });
  };
  G.__ifttt_onSystemDrop = () => {
    let path = '';
    try { path = String((G.__sys_drop_path?.() ?? '')); } catch { /* ignore */ }
    emit('system:fileDropped', path);
  };
  G.__ifttt_onSystemCursor = (x: number, y: number, dx: number, dy: number) => {
    emit('system:cursor:move', { x, y, dx, dy });
  };
  G.__ifttt_onSystemSlowFrame = (ms: number) => emit('system:slowFrame', { ms });
  G.__ifttt_onSystemHang = (count: number) => emit('system:hang', { count });
  G.__ifttt_onSystemRam = (used: number, total: number) => {
    const percent = total > 0 ? (used / total) * 100 : 0;
    emit('system:ram', { used, total, percent });
  };
  G.__ifttt_onSystemVram = (used: number, total: number) => {
    const percent = total > 0 ? (used / total) * 100 : 0;
    emit('system:vram', { used, total, percent });
  };
  G.__ifttt_onSystemResize = (w: number, h: number) => {
    emit('system:resize', { w, h });
  };
  G.__ifttt_onSystemSelection = (
    textLen: number,
    downX: number,
    downY: number,
    upX: number,
    upY: number,
    screenW: number,
    screenH: number,
  ) => {
    let text = '';
    try { text = String((G.__sys_selection_get?.() ?? '')); } catch { /* ignore */ }
    emit('system:selection', {
      text, textLen, downX, downY, upX, upY, screenW, screenH, at: Date.now(),
    });
  };
  G.__ifttt_onSystemSelectionCleared = () => {
    emit('system:selection:cleared', { at: Date.now() });
  };
}

// Cart-side entry point for Claude Code hook events. Cart hosts an HTTP
// listener (e.g. via useHost) and pipes each POST body through here.
export function dispatchClaudeEvent(input: string | object): void {
  let entry: any = null;
  if (typeof input === 'string') {
    try { entry = JSON.parse(input); } catch { return; }
  } else {
    entry = input;
  }
  if (!entry || typeof entry !== 'object') return;
  const tool = String(entry.tool ?? '').toLowerCase();
  const phase = String(entry.phase ?? '').toLowerCase();
  emit('system:claude', entry);
  if (tool) emit(`system:claude:${tool}`, entry);
  if (phase) emit(`system:claude:${phase}`, entry);
}

// ── Key parsing helpers ───────────────────────────────────────────────────

type KeySpec = { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };

function parseKey(spec: string): KeySpec {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const out: KeySpec = { key };
  for (const m of parts) {
    if (m === 'ctrl' || m === 'control') out.ctrl = true;
    else if (m === 'shift') out.shift = true;
    else if (m === 'alt' || m === 'option') out.alt = true;
    else if (m === 'meta' || m === 'cmd' || m === 'command') out.meta = true;
  }
  return out;
}

function keyMatches(ev: any, spec: KeySpec): boolean {
  const ek = String(ev?.key ?? '').toLowerCase();
  if (ek !== spec.key) return false;
  if (!!spec.ctrl !== !!ev?.ctrlKey) return false;
  if (!!spec.shift !== !!ev?.shiftKey) return false;
  if (!!spec.alt !== !!ev?.altKey) return false;
  if (!!spec.meta !== !!ev?.metaKey) return false;
  return true;
}

function coerce(raw: string): any {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === '') return '';
  const n = Number(raw);
  if (!Number.isNaN(n) && /^[+-]?\d+(\.\d+)?$/.test(raw)) return n;
  return raw;
}

// Reverse map of SDL_KEY_NAMES — built lazily so the named-key list and
// reverse map can never drift. Used to resolve a parsed key string
// (e.g. "escape") back to its SDL keycode for Zig-side matching.
let _nameToSym: Map<string, number> | null = null;
function nameToSym(name: string): number | null {
  if (!name) return null;
  // Single printable ASCII char → its lowercase code.
  if (name.length === 1) {
    const c = name.charCodeAt(0);
    if (c >= 0x20 && c < 0x7f) return c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
  }
  if (!_nameToSym) {
    _nameToSym = new Map();
    for (const codeStr of Object.keys(SDL_KEY_NAMES)) {
      _nameToSym.set(SDL_KEY_NAMES[Number(codeStr)], Number(codeStr));
    }
  }
  return _nameToSym.get(name) ?? null;
}

// ── Built-in trigger sources ──────────────────────────────────────────────

registerIfttSource('mount', {
  match(spec) {
    if (spec !== 'mount') return null;
    return {
      subscribe(onFire) { onFire({ at: Date.now() }); return () => {}; },
    };
  },
});

registerIfttSource('click', {
  match(spec) {
    if (spec !== 'click') return null;
    return { subscribe(onFire) { return subscribe('__click', onFire); } };
  },
});

// Key sources — registration pre-compiles the spec into (sym, modifier
// wants) and registers with the Zig key matcher. On keydown/keyup the
// engine walks the Zig list directly; the JS bridge is only crossed
// once per matching wire (vs once per keystroke + walking every
// `key:`-source subscriber's keyMatches check). Falls back to a JS
// `__keydown`/`__keyup` bus subscription when the binding is missing
// or the spec uses a key name we can't resolve to an SDL keycode.
function compileAndRegisterKey(
  ks: KeySpec,
  isKeyup: boolean,
  onFire: (ev: any) => void,
): (() => void) | null {
  const sym = nameToSym(ks.key);
  if (sym == null) return null;
  const dispatchWire = allocWire(onFire);
  if (dispatchWire <= 0) return null;
  const keyId = callHost<number>(
    '__ifttt_key_register', 0,
    sym,
    ks.ctrl ? 1 : 0,
    ks.shift ? 1 : 0,
    ks.alt ? 1 : 0,
    ks.meta ? 1 : 0,
    isKeyup ? 1 : 0,
    dispatchWire,
  );
  if (keyId <= 0) {
    freeWire(dispatchWire);
    return null;
  }
  return () => {
    callHost('__ifttt_key_unregister', undefined, keyId);
    freeWire(dispatchWire);
  };
}

registerIfttSource('key:up:', {
  match(spec) {
    if (!spec.startsWith('key:up:')) return null;
    const ks = parseKey(spec.slice('key:up:'.length));
    return {
      subscribe(onFire) {
        const cleanup = compileAndRegisterKey(ks, true, onFire);
        if (cleanup) return cleanup;
        return subscribe('__keyup', (ev: any) => { if (keyMatches(ev, ks)) onFire(ev); });
      },
    };
  },
});

registerIfttSource('key:', {
  match(spec) {
    // `key:up:` is owned by the longer-prefix source above; longest-match
    // wins so this branch is only reached for keydown specs.
    if (!spec.startsWith('key:')) return null;
    const ks = parseKey(spec.slice('key:'.length));
    return {
      subscribe(onFire) {
        const cleanup = compileAndRegisterKey(ks, false, onFire);
        if (cleanup) return cleanup;
        return subscribe('__keydown', (ev: any) => { if (keyMatches(ev, ks)) onFire(ev); });
      },
    };
  },
});

// Timer sources — Zig-owned wheel via __ifttt_timer_register. Each
// subscription allocates its own dispatch wire (separate from the hook's
// own wire) so the Zig timer fire lands here through __ifttt_dispatch_timer
// and we can hand the event to onFire. Falls back to JS setInterval if
// the binding isn't available (e.g. on TUI host without ifttt bindings).
registerIfttSource('timer:every:', {
  match(spec) {
    if (!spec.startsWith('timer:every:')) return null;
    const ms = Math.max(1, Number(spec.slice('timer:every:'.length)) || 0);
    return {
      subscribe(onFire) {
        const dispatchWire = allocWire(() => onFire({ at: Date.now(), interval: ms }));
        if (dispatchWire <= 0) {
          const id = setInterval(() => onFire({ at: Date.now(), interval: ms }), ms);
          return () => clearInterval(id);
        }
        const tid = callHost<number>('__ifttt_timer_register', 0, ms, 0, dispatchWire);
        return () => {
          callHost('__ifttt_timer_cancel', undefined, tid);
          freeWire(dispatchWire);
        };
      },
    };
  },
});

registerIfttSource('timer:once:', {
  match(spec) {
    if (!spec.startsWith('timer:once:')) return null;
    const ms = Math.max(0, Number(spec.slice('timer:once:'.length)) || 0);
    return {
      subscribe(onFire) {
        const dispatchWire = allocWire(() => onFire({ at: Date.now(), delay: ms }));
        if (dispatchWire <= 0) {
          const id = setTimeout(() => onFire({ at: Date.now(), delay: ms }), ms);
          return () => clearTimeout(id);
        }
        const tid = callHost<number>('__ifttt_timer_register', 0, ms, 1, dispatchWire);
        return () => {
          callHost('__ifttt_timer_cancel', undefined, tid);
          freeWire(dispatchWire);
        };
      },
    };
  },
});

registerIfttSource('state:', {
  match(spec) {
    if (!spec.startsWith('state:')) return null;
    const rest = spec.slice('state:'.length);
    const colon = rest.indexOf(':');
    const key = colon < 0 ? rest : rest.slice(0, colon);
    const expected = coerce(colon < 0 ? '' : rest.slice(colon + 1));
    return {
      subscribe(onFire) {
        if (getSharedState(key) === expected) onFire(getSharedState(key));
        return watchSharedState(key, (v) => { if (v === expected) onFire(v); });
      },
    };
  },
});

// Fallback — any unmatched spec subscribes to a raw bus channel of that
// name. Pairs with `send:<event>` actions and ad-hoc cart channels.
setIfttFallback({
  match(spec) {
    return { subscribe(onFire) { return subscribe(spec, onFire); } };
  },
});

// ── Built-in actions ──────────────────────────────────────────────────────

registerIfttAction('state:set:', (rest, _payload) => {
  const colon = rest.indexOf(':');
  const key = colon < 0 ? rest : rest.slice(0, colon);
  const raw = colon < 0 ? '' : rest.slice(colon + 1);
  setSharedState(key, coerce(raw));
});

registerIfttAction('state:toggle:', (rest, _payload) => {
  setSharedState(rest, !getSharedState(rest));
});

registerIfttAction('send:', (rest, payload) => {
  emit(rest, payload);
});

registerIfttAction('log:', (rest, payload) => {
  console.log('[ifttt]', rest, payload ?? '');
});

registerIfttAction('clipboard:', (rest, _payload) => {
  clipboard.set(rest);
});

function runStringAction(action: string, payload: any): void {
  const resolved = substituteAction(action, payload);
  if (!dispatchAction(resolved, payload)) {
    console.warn(`[ifttt] unknown action '${resolved}'`);
  }
}

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Trigger shape accepted by useIFTTT.
 *
 * Plain forms (Phase A):
 *   'key:ctrl+s'          string DSL — resolved through the registry
 *   () => boolean         reactive condition — fires on false→true edge
 *
 * Composable forms (Phase B — see ifttt-compose.ts):
 *   { on: trigger, when?: () => boolean }
 *   { all: triggers[] }   AND, edge-detected
 *   { any: triggers[] }   OR, edge-detected
 *   { seq: triggers[], within: number }
 *   { trigger, debounce?, throttle?, once?, cooldown? }
 */
export type IFTTTTrigger = IFTTTComposable;
export type IFTTTAction = string | ((event?: any) => void);

export type IFTTTResult = {
  fired: number;
  lastEvent: any;
  lastFiredAt: number;
  fire: (event?: any) => void;
};

// ── The hook ──────────────────────────────────────────────────────────────

export function useIFTTT(trigger: IFTTTTrigger, action: IFTTTAction): IFTTTResult {
  const actionRef = useRef(action);
  actionRef.current = action;

  // Allocate a wireId on first render. This is the hook's own counter row
  // (separate from any per-trigger dispatch wires the source registry may
  // allocate); we never call setState off it, so the host doesn't rerender.
  const wireRef = useRef<number>(0);
  if (wireRef.current === 0) {
    wireRef.current = allocWire((ev) => fireRef.current(ev));
  }
  useEffect(() => {
    return () => {
      const id = wireRef.current;
      wireRef.current = 0;
      freeWire(id);
    };
  }, []);

  // Lazy reactivity: the host doesn't rerender on fire by default.
  // First read of any result field flips `subscribedRef`; thereafter
  // each fire bumps a useState so consumers (diagnostic dashboards,
  // counters in render) update. Carts that ignore the return value
  // never set the flag and stay zero-rerender.
  const subscribedRef = useRef(false);
  const [, forceTick] = useState(0);

  const fire = (event?: any) => {
    const wid = wireRef.current;
    if (wid > 0) bumpWire(wid, event);
    const a = actionRef.current;
    if (typeof a === 'function') a(event);
    else runStringAction(a, event);
    if (subscribedRef.current) forceTick((n) => (n + 1) & 0xffff);
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  // ── Function trigger: false → true edge, polled at frame rate ──────────
  // RAF-driven so the predicate cadence is independent of the host's
  // render cycle (no more re-evaluating every commit).
  const isFnTrigger = typeof trigger === 'function';
  const prevCondRef = useRef(false);
  useEffect(() => {
    if (!isFnTrigger) { prevCondRef.current = false; return; }
    let cancelled = false;
    let raf = 0;
    const tick = () => {
      if (cancelled) return;
      let cur = false;
      try { cur = !!(trigger as () => boolean)(); } catch { cur = false; }
      if (cur && !prevCondRef.current) fireRef.current(undefined);
      prevCondRef.current = cur;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFnTrigger]);

  // ── Compose key: re-subscribe only when the trigger shape changes ─────
  const composeKey = useMemo(() => {
    if (typeof trigger === 'string') return `s:${trigger}`;
    if (typeof trigger === 'function') return null;
    try { return `c:${JSON.stringify(trigger)}`; } catch { return null; }
  }, [trigger]);

  // ── String / composable trigger subscription ──────────────────────────
  useEffect(() => {
    if (typeof trigger === 'function') return;
    let sub: IfttSubscription | null;
    if (typeof trigger === 'string') {
      sub = resolveTrigger(trigger);
      if (!sub) {
        console.warn(`[ifttt] no source for trigger '${trigger}'`);
        return;
      }
    } else if (isComposable(trigger)) {
      sub = compileTrigger(trigger as IFTTTComposable);
    } else {
      return;
    }
    return sub.subscribe((ev?: any) => fireRef.current(ev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeKey]);

  // Stable handle. `fired`/`lastFiredAt` read from the Zig registry on
  // demand; `lastEvent` is JS-side (mirrored in WireEntry by bumpWire).
  // Reading any field opts the host into rerender-on-fire (lazy
  // subscription). Carts that never read these never trigger renders.
  return useMemo<IFTTTResult>(() => ({
    get fired(): number {
      subscribedRef.current = true;
      return callHost<number>('__ifttt_wire_count', 0, wireRef.current);
    },
    get lastEvent(): any {
      subscribedRef.current = true;
      return _wires.get(wireRef.current)?.lastEvent;
    },
    get lastFiredAt(): number {
      subscribedRef.current = true;
      return callHost<number>('__ifttt_wire_last_at', 0, wireRef.current);
    },
    fire: (event?: any) => fireRef.current(event),
  }), []);
}
