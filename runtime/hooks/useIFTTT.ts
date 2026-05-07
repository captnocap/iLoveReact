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
 *   'timer:every:<ms>'       repeating interval
 *   'timer:once:<ms>'        single-shot delay
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
 *                            Keep pure & cheap; runs after every render.
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
 * Internals: trigger families and action verbs are registered through
 * `ifttt-registry.ts`. Other hooks (process, voice, fs, host, …) can
 * `registerIfttSource`/`registerIfttAction` to expose themselves through
 * this same DSL — see Phase C of the registry rollout. The shared bus
 * lives in `runtime/ffi.ts`; useIFTTT's `busOn`/`busEmit` are thin
 * facades over `subscribe`/`emit` there.
 */
import { useEffect, useRef, useState } from 'react';
import * as clipboard from './clipboard';
import { subscribe, emit } from '../ffi';
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

const state = new Map<string, any>();
const stateWatchers = new Map<string, Set<Handler>>();

export function getSharedState(key: string): any {
  return state.get(key);
}

export function setSharedState(key: string, value: any): void {
  const prev = state.get(key);
  if (prev === value) return;
  state.set(key, value);
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

const G = globalThis as any;
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

registerIfttSource('key:up:', {
  match(spec) {
    if (!spec.startsWith('key:up:')) return null;
    const ks = parseKey(spec.slice('key:up:'.length));
    return {
      subscribe(onFire) {
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
        return subscribe('__keydown', (ev: any) => { if (keyMatches(ev, ks)) onFire(ev); });
      },
    };
  },
});

registerIfttSource('timer:every:', {
  match(spec) {
    if (!spec.startsWith('timer:every:')) return null;
    const ms = Math.max(1, Number(spec.slice('timer:every:'.length)) || 0);
    return {
      subscribe(onFire) {
        const id = setInterval(() => onFire({ at: Date.now(), interval: ms }), ms);
        return () => clearInterval(id);
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
        const id = setTimeout(() => onFire({ at: Date.now(), delay: ms }), ms);
        return () => clearTimeout(id);
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
  const [, forceTick] = useState(0);
  const counterRef = useRef(0);
  const lastRef = useRef<any>(undefined);
  const lastAtRef = useRef(0);
  const actionRef = useRef(action);
  actionRef.current = action;

  const fire = (event?: any) => {
    counterRef.current += 1;
    lastRef.current = event;
    lastAtRef.current = Date.now();
    const a = actionRef.current;
    if (typeof a === 'function') a(event);
    else runStringAction(a, event);
    forceTick((n) => (n + 1) & 0xffff);
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  // ── Function trigger: edge-detect false → true (post-render) ──────────
  // Plain `() => boolean` triggers stay on the post-render path so existing
  // carts keep their cadence. Function leaves used INSIDE a composable
  // trigger are polled by the composer (see ifttt-compose.ts) and don't
  // hit this branch.
  const isFnTrigger = typeof trigger === 'function';
  const prevCondRef = useRef(false);
  useEffect(() => {
    if (!isFnTrigger) { prevCondRef.current = false; return; }
    let cur = false;
    try { cur = !!(trigger as () => boolean)(); } catch { cur = false; }
    if (cur && !prevCondRef.current) fireRef.current(undefined);
    prevCondRef.current = cur;
  });

  // ── Compose key: re-subscribe only when the trigger shape changes ─────
  // For string triggers we use the spec itself. For composable triggers we
  // serialize the structure (functions are stable references; JSON skips
  // them, which is acceptable since composer keeps a closure over them).
  const composeKey = (() => {
    if (typeof trigger === 'string') return `s:${trigger}`;
    if (typeof trigger === 'function') return null;
    try { return `c:${JSON.stringify(trigger)}`; } catch { return null; }
  })();

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

  return {
    fired: counterRef.current,
    lastEvent: lastRef.current,
    lastFiredAt: lastAtRef.current,
    fire,
  };
}
