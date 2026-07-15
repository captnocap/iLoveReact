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
 * Lazy reactivity. `fired` / `lastEvent` / `lastFiredAt` and
 * `action.active` / `action.startedAt` / `action.done` are getters that
 * each flip a sticky "subscribed" flag the first time they're read. After
 * that flip, the host re-renders on every relevant edge for the rest of
 * the component's lifetime — there is no "unsubscribe by stopping to
 * read." Carts that pass an action and never look at the result stay
 * zero-rerender; carts that read once-in-a-conditional pay forever.
 *
 * `fired` / `lastEvent` / `lastFiredAt` share one flag, so reading any
 * one of them subscribes to all three. That's fine for this set (they
 * change together) — but note `lastEvent` is set JS-side before the
 * render commits, while `fired` / `lastFiredAt` are read from Zig at
 * render time, so an in-flight burst can show `fired` ahead of
 * `lastEvent` by one. Not a bug; document it.
 *
 * `flow.completed` fires for every trigger that produced an action, even
 * if the action verb was a typo (no registered prefix). That's deliberate
 * so chains never silently stall — a `console.warn` in dev tells you.
 *
 * Type/runtime drift. `PayloadOf<S>` is a compile-time table; the
 * registry resolves at runtime by prefix. If someone registers a custom
 * source whose actual payload differs from the table's entry, TypeScript
 * will infer the table's type and won't catch it. Keep the table in sync
 * with the registrations.
 *
 * Internals: trigger families and action verbs are registered through
 * `ifttt/registry.ts` (longest-prefix wins regardless of registration
 * order — enforced inside `resolveTrigger` / `dispatchAction`). Other
 * hooks (process, voice, fs, host, …) call `registerIfttSource` /
 * `registerIfttAction` to expose themselves through this same DSL. The
 * shared bus lives in `runtime/ffi.ts`. Timers, fired-count, and
 * lastFiredAt live in framework/ifttt_zig.zig and are driven by the
 * engine frame loop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLatest } from './useLatest';
import { subscribe, emit, callHost } from '../ffi';
import { G } from '../host-globals';
import {
  registerIfttSource,
  registerIfttAction,
  setIfttFallback,
  resolveTrigger,
  dispatchAction,
  type IfttSubscription,
} from './ifttt/registry';
import {
  compileTrigger,
  isComposable,
  substituteAction,
  type IFTTTComposable,
} from './ifttt/compose';
import type {
  TriggerString,
  ActionString,
  PayloadOf,
  ComposableTrigger,
  IFTTTResult,
  ReactiveEdgeSource,
  ReactiveLevelSource,
} from './ifttt/types/triggers';

// Augment the FFI host-call catalog with the IFTTT family. Anything not
// in this list still flows through the wide `callHost<T>` overload.
declare module '../ffi' {
  interface HostCalls {
    __ifttt_state_get(key: string): string | null;
    __ifttt_state_set(key: string, json: string): void;
    __ifttt_wire_alloc(): number;
    __ifttt_wire_free(id: number): void;
    __ifttt_wire_bump(id: number, at: number): void;
    __ifttt_wire_count(id: number): number;
    __ifttt_wire_last_at(id: number): number;
    __ifttt_last_key(): number;
    __ifttt_key_register(
      sym: number,
      ctrl: number,
      shift: number,
      alt: number,
      meta: number,
      isKeyup: number,
      dispatchWire: number,
    ): number;
    __ifttt_key_unregister(keyId: number): void;
    __ifttt_timer_register(ms: number, kind: 0 | 1, dispatchWire: number): number;
    __ifttt_timer_cancel(tid: number): void;
  }
}

// Augment globalThis with the reverse-dispatch hooks that Zig calls into.
declare module '../host-globals' {
  interface HostGlobals {
    __ifttt_dispatch_installed?: boolean;
    __ifttt_handlers_installed?: boolean;
    __ifttt_dispatch_timer?(wireId: number): void;
    __ifttt_dispatch_key?(wireId: number): void;
    __ifttt_onKeyDown?(packed: number): void;
    __ifttt_onKeyUp?(packed: number): void;
    // `__ifttt_onClipboardChange` is declared in clipboard.ts via the same
    // augmentation channel — TypeScript merges the interfaces across files.
    __ifttt_onSystemFocus?(gained: number): void;
    __ifttt_onSystemDrop?(): void;
    __ifttt_onSystemCursor?(x: number, y: number, dx: number, dy: number): void;
    __ifttt_onSystemSlowFrame?(ms: number): void;
    __ifttt_onSystemHang?(count: number): void;
    __ifttt_onSystemRam?(used: number, total: number): void;
    __ifttt_onSystemVram?(used: number, total: number): void;
    __ifttt_onSystemResize?(w: number, h: number): void;
    __ifttt_onSystemPointerDevice?(dev: number): void;
    __ifttt_onSystemSelection?(
      textLen: number,
      downX: number,
      downY: number,
      upX: number,
      upY: number,
      screenW: number,
      screenH: number,
    ): void;
    __ifttt_onSystemSelectionCleared?(): void;
    __sys_drop_path?(): string;
    __sys_selection_get?(): string;
  }
}

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
import './clipboard';        // clipboard: action + system:clipboard channel
import './ifttt/match';      // match:<channel>::<pattern> generic text-pattern source
import './ifttt/count';      // count:<channel>::<n>:<windowMs> windowed counter
import './ifttt/firsthit';   // firsthit:<channel>::<pattern> single-shot pattern
import './ifttt/repeat';     // repeat:<channel>::<lookback>:<minSim> claim-shape similarity
import './ifttt/permission'; // permission:any / permission:<tool> / permission:dismissed
import './ifttt/turn-tracker';     // turn:start / turn:end / turn:tool-use canonical channels

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
// install handlers here that decode the packed payload (mod<<32 | sym),
// translate the SDL keycode + modifier mask to friendly names, and emit on
// the shared bus. Trigger sources subscribe to those internal channels.
//
// Packed format from Zig (framework/key_pack.zig): i64 = (mod << 32) | sym
//   sym  — SDL3 keycode (SDLK_*), FULL 32 bits. ASCII for printable chars;
//          extended keys (arrows, F-keys, nav, standalone modifiers) set
//          bit 30 (0x40000000) — the old 16-bit packing truncated these
//          into printable collisions (LEFT arrived as 'p').
//   mod  — SDL_Keymod bitmask: 1=LSHIFT 2=RSHIFT 64=LCTRL 128=RCTRL 256=LALT
//          512=RALT 1024=LGUI 2048=RGUI etc.
// Max value < 2^48 — exact in the f64 crossing the V8 bridge. Decode with
// arithmetic div/mod, NEVER 32-bit bitwise ops (they'd truncate the mod).

// SDL3 keymod bitmask constants. Pinned to SDL3 (the version Zig links
// against in framework/engine.zig). SDL2 had the same numeric values for
// CTRL/SHIFT but the bit layout for ALT/GUI shifted in SDL3 — if Zig is
// ever migrated to a different SDL major, re-verify these. Each constant
// covers BOTH left and right variants (e.g. CTRL = LCTRL | RCTRL).
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

function decodeKey(packed: number): {
  key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
  mods: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
} {
  // (mod << 32) | sym — arithmetic decode; 32-bit bitwise would truncate.
  const sym = packed % 0x100000000;
  const mod = Math.floor(packed / 0x100000000);
  let key = SDL_KEY_NAMES[sym];
  if (!key) {
    if (sym >= 0x20 && sym < 0x7f) key = String.fromCharCode(sym).toLowerCase();
    else key = `sdl:${sym}`;
  }
  const ctrl = (mod & SDL_KMOD_CTRL) !== 0;
  const shift = (mod & SDL_KMOD_SHIFT) !== 0;
  const alt = (mod & SDL_KMOD_ALT) !== 0;
  const meta = (mod & SDL_KMOD_GUI) !== 0;
  return {
    key,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    metaKey: meta,
    // useModifiers' g_mods tracker only updates off `e.mods` — when this bridge wins
    // at boot (engine.zig pre-defines __ifttt_onKeyDown), omitting it left every
    // modifier permanently false and killed all Ctrl chords cart-wide.
    mods: { ctrl, shift, alt, meta },
  };
}

if (!G.__ifttt_handlers_installed) {
  G.__ifttt_handlers_installed = true;
  G.__ifttt_onKeyDown = (packed: number) => emit('__keydown', decodeKey(packed));
  G.__ifttt_onKeyUp = (packed: number) => emit('__keyup', decodeKey(packed));
  // `__ifttt_onClipboardChange` lives in clipboard.ts (self-registered).
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
  // Fired by engine.zig notePointerDevice on the mouse ⇄ pen change edge only
  // (never per event). Carts use it for GIMP-style per-device tool memory.
  G.__ifttt_onSystemPointerDevice = (dev: number) => {
    emit('system:pointerDevice', { device: dev ? 'pen' : 'mouse', at: Date.now() });
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
      subscribe(onFire) {
        // Defer the fire so any subscribers the caller registers AFTER
        // useIFTTT returns (e.g. `flow.subscribe(fn)` in the same render)
        // still see the mount edge. Firing synchronously inside subscribe()
        // would deliver only to subscribers that exist at this instant —
        // which excludes anyone who hasn't received the hook's return value
        // yet. queueMicrotask runs after the current sync block but before
        // any I/O or rAF, which is the correct edge for "just mounted."
        let cancelled = false;
        queueMicrotask(() => { if (!cancelled) onFire({ at: Date.now() }); });
        return () => { cancelled = true; };
      },
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

// `clipboard:` action verb lives in clipboard.ts (self-registered).

function runStringAction(action: string, payload: any): void | Promise<void> {
  const resolved = substituteAction(action, payload);
  const { handled, ret } = dispatchAction(resolved, payload);
  if (!handled) console.warn(`[ifttt] unknown action '${resolved}'`);
  return ret;
}

function isReactive(v: unknown): v is ReactiveEdgeSource<any> {
  return !!v
    && typeof v === 'object'
    && typeof (v as { subscribe?: unknown }).subscribe === 'function';
}

function isThenable(v: unknown): v is Promise<void> {
  return !!v && typeof v === 'object' && typeof (v as { then?: unknown }).then === 'function';
}

// Stable-identity key for object triggers (Reactive sources) and inline
// functions inside composables. One WeakMap-assigned id per instance, so
// changing a `when:` predicate function (or any nested fn leaf) flips the
// composeKey and triggers a re-subscribe — without it, JSON.stringify
// silently drops function-valued fields and two different composables
// would collide.
let _reactiveIdCounter = 0;
const _reactiveIds = new WeakMap<object, number>();
function reactiveKey(obj: object): string {
  let id = _reactiveIds.get(obj);
  if (id == null) { id = ++_reactiveIdCounter; _reactiveIds.set(obj, id); }
  return `r:${id}`;
}
/** Identity key for any value — primitives via JSON, objects/functions
 *  via the WeakMap. Stable across renders for the same instance; differs
 *  when the instance differs. */
function identityKey(v: unknown): string {
  if (v == null) return String(v);
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return `${t[0]}:${v}`;
  if (t === 'function' || t === 'object') return reactiveKey(v as object);
  return `?:${t}`;
}

/** Walk a composable structure producing a stable key that respects
 *  function identities. JSON.stringify would silently drop functions
 *  (so two `{ on:'click', when:fn }` with different fn would collide);
 *  this stamps every function/object leaf through the WeakMap. */
function composableKey(node: unknown, depth = 0): string {
  if (depth > 8) return '…';
  if (node == null) return String(node);
  const t = typeof node;
  if (t === 'string' || t === 'number' || t === 'boolean') return `${t[0]}:${node}`;
  if (t === 'function') return identityKey(node);
  if (Array.isArray(node)) return `[${node.map((c) => composableKey(c, depth + 1)).join(',')}]`;
  if (t === 'object') {
    // Reactive (has `subscribe`) — key by object identity, don't descend.
    if (typeof (node as { subscribe?: unknown }).subscribe === 'function') {
      return identityKey(node);
    }
    const o = node as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${k}=${composableKey(o[k], depth + 1)}`).join(',')}}`;
  }
  return `?:${t}`;
}

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Trigger shape accepted by useIFTTT.
 *
 * Plain forms:
 *   'key:ctrl+s'          string DSL — resolved through the registry
 *   () => boolean         reactive condition — fires on false→true edge
 *   flow1                 another IFTTTResult — fires on trigger edge
 *   flow1.completed       another IFTTTResult's completion — fires on settle
 *   anything { subscribe }  any ReactiveEdgeSource
 *
 * Composable forms (see ifttt/compose.ts):
 *   { on: trigger, when?: () => boolean }
 *   { all: triggers[] }   AND, edge-detected
 *   { any: triggers[] }   OR, edge-detected
 *   { seq: triggers[], within: number }
 *   { trigger, debounce?, throttle?, once?, cooldown? }
 *
 * The string form is typed against `TriggerString` (known prefixes
 * autocomplete; arbitrary strings still allowed via `string & {}`).
 * The function form yields `undefined` payload. Composable forms are
 * generic in P; the action callback gets the right argument type.
 *
 * The returned IFTTTResult is three reactive surfaces in one object:
 *
 *   flow            — edge: fired the moment the trigger matched
 *   flow.action     — level: open while the bound action is in flight
 *                     (async actions only; sync actions never visibly open)
 *   flow.completed  — edge: action settled (sync = same tick as trigger;
 *                     async = on Promise settle)
 *
 * You pick the temporal semantics by which surface you reference. There
 * is no default — `useIFTTT(flow1, …)` is distinct from
 * `useIFTTT(flow1.completed, …)`.
 */
export type IFTTTTrigger<P = unknown> = ComposableTrigger<P>;
export type IFTTTAction<P = unknown> = ActionString | ((event: P) => void | Promise<void>);
export type { IFTTTResult, TriggerString, ActionString, PayloadOf, ComposableTrigger };

// ── The hook ──────────────────────────────────────────────────────────────

/** Literal string trigger — payload inferred from `TriggerString`. */
export function useIFTTT<S extends TriggerString>(
  trigger: S,
  action: ActionString | ((event: PayloadOf<S>) => void | Promise<void>),
): IFTTTResult<PayloadOf<S>>;
/** Function trigger — `false → true` edge, no payload. */
export function useIFTTT(
  trigger: () => boolean,
  action: ActionString | (() => void | Promise<void>),
): IFTTTResult<undefined>;
/** Reactive trigger — another IFTTTResult, `flow.completed`, or any
 *  object exposing `subscribe(fn)`. Edges on fn invocation. */
export function useIFTTT<P>(
  trigger: ReactiveEdgeSource<P>,
  action: ActionString | ((event: P) => void | Promise<void>),
): IFTTTResult<P>;
/** Composable trigger — payload generic, defaults to `unknown`. */
export function useIFTTT<P = unknown>(
  trigger: Exclude<ComposableTrigger<P>, string | (() => boolean) | ReactiveEdgeSource<P>>,
  action: ActionString | ((event: P) => void | Promise<void>),
): IFTTTResult<P>;
export function useIFTTT(
  trigger: ComposableTrigger<unknown>,
  action: ActionString | ((event?: any) => void | Promise<void>),
): IFTTTResult<unknown> {
  const actionRef = useLatest(action);

  // Allocate a wireId via the useState lazy initialiser so React tracks the
  // value through bailed renders (StrictMode runs render bodies twice in dev;
  // a render-body `useRef` assignment would leak the first wire). The
  // initialiser captures fireRef *by closure*, but at init time fireRef
  // hasn't been declared yet — so the wire's fire callback reaches through
  // fireRef.current at dispatch time, by which point fireRef is populated.
  // The allocator itself runs once per component instance.
  const [wireId] = useState(() => allocWire((ev: any) => fireRef.current(ev)));
  const wireRef = useRef(wireId);
  useEffect(() => {
    const id = wireRef.current;
    return () => { freeWire(id); };
  }, []);

  // ── Subscriber registries (per-hook) ──────────────────────────────────
  //
  // triggerSubs    — fired on the trigger edge BEFORE the action runs.
  //                  These are what `flow.subscribe(fn)` adds to.
  // completedSubs  — fired after the action settles. `flow.completed.subscribe`.
  // Both stored in refs so the result object can capture stable add/remove
  // closures without re-rendering.
  const triggerSubsRef = useRef<Set<(event: any) => void>>(new Set());
  const completedSubsRef = useRef<Set<(event: any) => void>>(new Set());

  // ── Action-in-flight tracker (`flow.action` level source) ────────────
  //
  // pendingCount   — number of currently-running action invocations.
  //                  Overlapping fires increment; settles decrement.
  // actionStartedAt — performance.now() when pendingCount went 0 → 1.
  // actionDone     — always a pending promise. Resolves when pendingCount
  //                  next goes back to 0; a fresh pending promise is
  //                  installed atomically so awaiters captured BEFORE the
  //                  next open will still see "the next close from now."
  // actionGen      — monotonic counter; each open assigns a gen, each
  //                  fire's settle checks gen still matches. `cancel()`
  //                  bumps gen so stale settles become no-ops (no double
  //                  `completed`, no negative pendingCount drift).
  const pendingCountRef = useRef(0);
  const actionStartedAtRef = useRef(0);
  const actionGenRef = useRef(0);
  const actionDoneRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  // Eagerly seed a pending promise so `await flow.action.done` BEFORE the
  // first fire still blocks until the next close (rather than resolving
  // instantly). Lazy-init guards against SSR / repeated module load.
  if (actionDoneRef.current == null) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    actionDoneRef.current = { promise, resolve };
  }

  /** Open one in-flight slot. Returns the gen token the caller's settle
   *  must present back; if the gen has moved on (cancel between fires)
   *  the settle is a stale ghost and must be ignored. */
  function openAction(): number {
    if (pendingCountRef.current === 0) {
      actionStartedAtRef.current = performance.now();
    }
    pendingCountRef.current += 1;
    const gen = ++actionGenRef.current;
    if (actionSubscribedRef.current) forceTick((n) => (n + 1) & 0xffff);
    return gen;
  }

  /** Close one in-flight slot. Pass the gen returned from openAction;
   *  a stale gen (after cancel) returns false so the caller can skip
   *  `emitCompleted`. */
  function closeAction(gen: number): boolean {
    if (gen !== actionGenRef.current && pendingCountRef.current === 0) {
      // Stale: a cancel already zeroed the counter and bumped gen.
      return false;
    }
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
    if (pendingCountRef.current === 0) {
      actionStartedAtRef.current = 0;
      // Resolve the current pending; install a fresh pending atomically
      // so subsequent `await flow.action.done` awaiters block on the
      // NEXT window's close, not on the just-resolved one.
      const prior = actionDoneRef.current!;
      let nextResolve!: () => void;
      actionDoneRef.current = {
        promise: new Promise<void>((r) => { nextResolve = r; }),
        resolve: nextResolve,
      };
      prior.resolve();
    }
    if (actionSubscribedRef.current) forceTick((n) => (n + 1) & 0xffff);
    return true;
  }

  /** Force-close every in-flight slot regardless of pending promises.
   *  Underlying action Promises still run; their `.finally` settles
   *  will present stale gens and be ignored. `completed` will not fire
   *  for the cancelled fires. */
  function cancelAction(): void {
    if (pendingCountRef.current === 0) return;
    pendingCountRef.current = 0;
    actionStartedAtRef.current = 0;
    actionGenRef.current += 1;  // invalidate every outstanding gen
    const prior = actionDoneRef.current!;
    let nextResolve!: () => void;
    actionDoneRef.current = {
      promise: new Promise<void>((r) => { nextResolve = r; }),
      resolve: nextResolve,
    };
    prior.resolve();
    if (actionSubscribedRef.current) forceTick((n) => (n + 1) & 0xffff);
  }

  function emitCompleted(event: any): void {
    for (const fn of Array.from(completedSubsRef.current)) {
      try { fn(event); } catch (e: any) {
        console.error('[ifttt] completed subscriber error:', e?.message || e);
      }
    }
  }

  // Lazy reactivity: separate flags for trigger-counter reads vs
  // action-level reads. Reading any field opts the host into rerender on
  // the corresponding event; carts that ignore everything stay
  // zero-rerender.
  const subscribedRef = useRef(false);
  const actionSubscribedRef = useRef(false);
  const [, forceTick] = useState(0);

  // ── Fire ──────────────────────────────────────────────────────────────
  //
  // Order matters and is the user-facing contract:
  //   1. Emit `flow.subscribe` listeners (trigger edge, sync)
  //   2. Bump the Zig wire counter + force tick if subscribed
  //   3. Run the action; capture its return
  //   4. If Promise: open the action window, await, close on settle
  //   5. Emit `flow.completed` listeners (sync action = same tick;
  //      async action = on settle, regardless of resolve/reject)
  //
  // Errors in the action are logged but never propagate into `completed`
  // suppression — `flow.completed` always fires once per trigger so chains
  // don't silently stall.
  const fire = (event?: any) => {
    // 1. Trigger-edge subscribers first.
    for (const fn of Array.from(triggerSubsRef.current)) {
      try { fn(event); } catch (e: any) {
        console.error('[ifttt] trigger subscriber error:', e?.message || e);
      }
    }
    // 2. Wire bump + tick.
    const wid = wireRef.current;
    if (wid > 0) bumpWire(wid, event);
    if (subscribedRef.current) forceTick((n) => (n + 1) & 0xffff);

    // 3. Run the action.
    const a = actionRef.current;
    let ret: void | Promise<void> = undefined;
    try {
      ret = typeof a === 'function'
        ? (a(event) as void | Promise<void>)
        : runStringAction(a, event);
    } catch (e: any) {
      console.error('[ifttt] action threw:', e?.message || e);
      emitCompleted(event);
      return;
    }
    // 4 + 5. Track in-flight if async; emit completed on settle either way.
    if (isThenable(ret)) {
      const gen = openAction();
      ret
        .catch((e: any) => console.error('[ifttt] async action rejected:', e?.message || e))
        .finally(() => {
          // Stale settle (cancelAction was called between fire and settle):
          // gen no longer matches → swallow. No `completed` edge, no
          // pendingCount decrement — the cancel already accounted for it.
          if (closeAction(gen)) emitCompleted(event);
        });
    } else {
      emitCompleted(event);
    }
  };
  const fireRef = useLatest(fire);

  // ── Function trigger: false → true edge, polled at frame rate ──────────
  // RAF-driven so the predicate cadence is independent of the host's
  // render cycle (no more re-evaluating every commit). The tick reads
  // through triggerRef so changing the function identity between renders
  // picks up the new predicate without re-subscribing every RAF.
  const triggerRef = useLatest(trigger);
  const isFnTrigger = typeof trigger === 'function';
  const prevCondRef = useRef(false);
  useEffect(() => {
    if (!isFnTrigger) { prevCondRef.current = false; return; }
    let cancelled = false;
    let raf = 0;
    const tick = () => {
      if (cancelled) return;
      const t = triggerRef.current;
      let cur = false;
      if (typeof t === 'function') {
        try { cur = !!(t as () => boolean)(); } catch { cur = false; }
      }
      if (cur && !prevCondRef.current) fireRef.current(undefined);
      prevCondRef.current = cur;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [isFnTrigger]);

  // ── Compose key: re-subscribe only when the trigger shape changes ─────
  // composableKey walks the trigger and stamps every function/object leaf
  // through the reactive WeakMap, so a composable whose `when:` predicate
  // changes identity (but whose surrounding shape looks the same) DOES
  // get re-subscribed. Function triggers (RAF poll path) skip this — the
  // RAF tick reads triggerRef.current directly.
  const composeKey = useMemo(() => {
    if (typeof trigger === 'string') return `s:${trigger}`;
    if (typeof trigger === 'function') return null;
    if (isReactive(trigger)) return reactiveKey(trigger as object);
    return `c:${composableKey(trigger)}`;
  }, [trigger]);

  // ── Trigger subscription ──────────────────────────────────────────────
  // Branches: string (registry), Reactive object (direct subscribe),
  // composable (compile through compose.ts), function (handled above).
  useEffect(() => {
    if (typeof trigger === 'function') return;
    let sub: IfttSubscription | null;
    if (typeof trigger === 'string') {
      sub = resolveTrigger(trigger);
      if (!sub) {
        console.warn(`[ifttt] no source for trigger '${trigger}'`);
        return;
      }
    } else if (isReactive(trigger)) {
      sub = trigger as unknown as IfttSubscription;
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
  return useMemo<IFTTTResult<unknown>>(() => {
    const subscribeTrigger = (fn: (event: any) => void): (() => void) => {
      triggerSubsRef.current.add(fn);
      return () => { triggerSubsRef.current.delete(fn); };
    };
    const subscribeCompleted = (fn: (event: any) => void): (() => void) => {
      completedSubsRef.current.add(fn);
      return () => { completedSubsRef.current.delete(fn); };
    };
    const action: ReactiveLevelSource = {
      get active(): boolean {
        actionSubscribedRef.current = true;
        return pendingCountRef.current > 0;
      },
      get startedAt(): number {
        actionSubscribedRef.current = true;
        return actionStartedAtRef.current;
      },
      get done(): Promise<void> {
        // Always returns the "next close from now" — a perpetually-pending
        // promise that's swapped to a fresh pending atomically on each
        // close. So `await flow.action.done` before any fire blocks until
        // the next action settles, instead of resolving instantly.
        actionSubscribedRef.current = true;
        return actionDoneRef.current!.promise;
      },
      cancel(): void {
        // Force-close every in-flight slot, resolve `.done`, bump the gen
        // token so subsequent settles of those underlying Promises become
        // ghosts — no double `completed`, no negative pendingCount drift.
        // The underlying Promises still run their action work; this only
        // unsubscribes the reactive surface from observing them.
        cancelAction();
      },
    };
    const completed: ReactiveEdgeSource<unknown> = { subscribe: subscribeCompleted };
    return {
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
      subscribe: subscribeTrigger,
      action,
      completed,
    };
  }, []);
}
