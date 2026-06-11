// game/input.ts — GAME_INPUT: key/pointer TRANSPORT only.
//
// V7: WASD-becomes-velocity lives in the HOST — the input_bench integrator and
// the physics-step movement unify into one host-side movement integrator
// (framework/game/movement.zig, called inside framework/game/physics.zig's
// step). JS keysRef remains only as input transport, never as the integrator.
// So this door carries key events, a held-keys snapshot, the pointer wire, and
// the direction vector the host's own contract asks the cart to ship
// ("a cart ships a direction vector … down the packed physics input buffer
// once per frame" — movement.zig). NOTHING here takes a dt, owns a velocity,
// or advances a position; an integration loop appearing in this file is a V7
// violation, and the tests pin that.
//
// THE WIRES (all transport, no behavior):
// • keys — the framework bus (runtime/ffi.ts): engine.zig fires
//   `__ifttt_onKeyDown/Up(packed)`, runtime/hooks/useIFTTT.ts decodes
//   (mod<<32 | sym — framework/key_pack.zig) into `{key, ctrlKey, shiftKey,
//   altKey, metaKey}` and publishes `__keydown`/`__keyup` — the same
//   transport hmsc's usePlayerDrive rides (the behavior reference). Wire
//   truths this door honors: space arrives as 'space' (not ' ');
//   Shift/Ctrl/Alt arrive as useless raw key names (`sdl:1073742049`…) but
//   TRUE modifier flags — read the flags, never the names (camera_lab's
//   __shift lesson).
// • pointer — core host fns (registered unconditionally in
//   v8_bindings_core.zig): getMouseX/getMouseY/getMouseDown/getMouseRightDown,
//   `__mouse_delta` (relative-mode deltas for mouse look), `__mouse_capture`
//   (relative-mouse on/off). Plus the bus event `system:cursor:move`
//   {x,y,dx,dy}. The reference is hmsc's HmscGameplayRig (mouse-look orbit +
//   right-hold aim).
// • the typing gate — `__tel_input`'s focused_id (the PaintCanvas idiom):
//   movement consumers check isTextEditing() so WASD never fires while the
//   user types into a TextInput. Honest when unwired (reads "not typing").
//
// HONESTY RULE (telemetry.ts set the idiom): every pointer read tolerates a
// missing host fn, and availability() names exactly which fns are absent so a
// consumer can SAY "pointer not wired" instead of treating zeros as truth.
// Keys ride the in-JS bus and need no host fn.
//
// BINDINGS ARE DATA (P2): the control vocabulary is hmsc's
// input/controlContract.ts carried as a table — actions name keys/modifiers/
// pointer inputs with an availability flag; readers (actionDown, moveAxes)
// walk the table instead of hardcoding keys.

import { callHost, hasHost, subscribe } from '@reactjit/ffi';

/** The bus payload shape for `__keydown`/`__keyup` (decoded SDL key event). */
export type KeyEvent = {
  key?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type KeyState = {
  /** is this key held right now? (key names are matched case-insensitively) */
  isDown: (key: string) => boolean;
  /** live modifier snapshot from the latest event */
  shift: () => boolean;
  ctrl: () => boolean;
  alt: () => boolean;
  /** stop tracking — the snapshot freezes and the bus subscriptions drop */
  dispose: () => void;
};

/** Subscribe to raw keydown events. Returns the unsubscribe. */
export function onKeyDown(fn: (event: KeyEvent) => void): () => void {
  return subscribe('__keydown', fn);
}

/** Subscribe to raw keyup events. Returns the unsubscribe. */
export function onKeyUp(fn: (event: KeyEvent) => void): () => void {
  return subscribe('__keyup', fn);
}

/**
 * A held-keys snapshot fed by the bus — poll it from the frame tick, hand the
 * intent to the host step. One instance per consumer; dispose with the scene.
 * Loses focus → all keys release: SDL never delivers the keyup once the window
 * blurs, so a held snapshot would stick forever (the PaintCanvas blur-clear).
 */
export function createKeyState(): KeyState {
  const held: Record<string, boolean> = {};
  let shift = false;
  let ctrl = false;
  let alt = false;

  const apply = (event: KeyEvent, down: boolean): void => {
    const key = String(event?.key ?? '').toLowerCase();
    if (key) held[key] = down;
    if (typeof event?.shiftKey === 'boolean') shift = event.shiftKey;
    if (typeof event?.ctrlKey === 'boolean') ctrl = event.ctrlKey;
    if (typeof event?.altKey === 'boolean') alt = event.altKey;
  };
  const clear = (): void => {
    for (const key of Object.keys(held)) held[key] = false;
    shift = false;
    ctrl = false;
    alt = false;
  };
  const offDown = onKeyDown((event) => apply(event, true));
  const offUp = onKeyUp((event) => apply(event, false));
  const offBlur = subscribe('system:blur', clear);

  return {
    isDown: (key: string) => held[key.toLowerCase()] === true,
    shift: () => shift,
    ctrl: () => ctrl,
    alt: () => alt,
    dispose: () => {
      offDown();
      offUp();
      offBlur();
    },
  };
}

// ── The control contract as data (P2 — hmsc input/controlContract.ts) ───────
//
// WASD only for movement because the CONTRACT says so (hmsc's
// controlContract verbatim) — the wire no longer forces it: the packing was
// widened to (mod<<32 | sym) in framework/key_pack.zig (2026-06-04), so
// arrows now arrive as 'left'/'right'/'up'/'down'. Aliasing arrows into the
// table is a contract change, not a transport fix; take it to the contract.

export type InputAction =
  | 'moveForward'
  | 'moveBack'
  | 'strafeLeft'
  | 'strafeRight'
  | 'run'
  | 'jump'
  | 'interact'
  | 'reload'
  | 'quickMenu'
  | 'crouch'
  | 'cameraLook'
  | 'aim'
  | 'primaryAimedAction'
  | 'primaryLightAction';

export type InputBinding = {
  action: InputAction;
  /** wire key names matched against the held snapshot (lowercase) */
  keys?: string[];
  /** matched against the modifier FLAGS, never key names (the wire truncates them) */
  modifier?: 'shift' | 'ctrl' | 'alt';
  /** pointer-side inputs — read via readPointer/readPointerDelta, not KeyState */
  pointer?: 'move' | 'left' | 'right';
  label: string;
  playerIntent: string;
  availability: 'implemented' | 'reserved';
};

export const INPUT_BINDINGS: readonly InputBinding[] = [
  { action: 'moveForward', keys: ['w'], label: 'Move forward', playerIntent: 'Walk toward the camera-forward direction.', availability: 'implemented' },
  { action: 'moveBack', keys: ['s'], label: 'Move back', playerIntent: 'Walk away from the camera-forward direction.', availability: 'implemented' },
  { action: 'strafeLeft', keys: ['a'], label: 'Strafe left', playerIntent: 'Sidestep screen-left.', availability: 'implemented' },
  { action: 'strafeRight', keys: ['d'], label: 'Strafe right', playerIntent: 'Sidestep screen-right.', availability: 'implemented' },
  { action: 'run', modifier: 'shift', label: 'Run', playerIntent: 'Move at the run speed while the movement vector is active.', availability: 'implemented' },
  { action: 'jump', keys: ['space'], label: 'Jump / mantle', playerIntent: 'Jump when grounded, or mantle when a valid ledge is detected.', availability: 'implemented' },
  // PROPUSE-0610: live — the play route's interact layer (sit on seats,
  // search containers) consumes the E/F edge each frame.
  { action: 'interact', keys: ['e', 'f'], label: 'Interact', playerIntent: 'Use the closest valid world interaction.', availability: 'implemented' },
  { action: 'reload', keys: ['r'], label: 'Reload', playerIntent: 'Reload the equipped item when that item supports ammo.', availability: 'reserved' },
  { action: 'quickMenu', keys: ['q', 'tab'], label: 'Item wheel / phone / quick menu', playerIntent: 'Open the quick inventory or phone surface.', availability: 'reserved' },
  { action: 'crouch', keys: ['c'], modifier: 'ctrl', label: 'Crouch', playerIntent: 'Lower stance and reduce movement/noise profile.', availability: 'reserved' },
  { action: 'cameraLook', pointer: 'move', label: 'Camera look/orbit', playerIntent: 'Orbit the third-person camera around the player.', availability: 'implemented' },
  { action: 'aim', pointer: 'right', label: 'Aim over shoulder', playerIntent: 'Apply the shoulder camera shift and show the aim crosshair.', availability: 'implemented' },
  { action: 'primaryAimedAction', pointer: 'left', label: 'Fire / attack / throw', playerIntent: 'Use the equipped item against the aimed target.', availability: 'reserved' },
  { action: 'primaryLightAction', pointer: 'left', label: 'Light action', playerIntent: 'Punch, select, or do nothing depending on the active context.', availability: 'reserved' },
] as const;

const BINDING_BY_ACTION: Partial<Record<InputAction, InputBinding>> = {};
for (const binding of INPUT_BINDINGS) {
  // first entry wins on a shared input (the two primary actions both ride
  // pointer-left and are disambiguated by aim state, a consumer concern)
  if (!BINDING_BY_ACTION[binding.action]) BINDING_BY_ACTION[binding.action] = binding;
}

/** Is a KEY-side action held right now, per the bindings table? Modifiers are
 *  matched against the flags (a key OR its modifier satisfies the binding).
 *  Pointer-side actions read false here — they live on readPointer. */
export function actionDown(state: KeyState, action: InputAction): boolean {
  const binding = BINDING_BY_ACTION[action];
  if (!binding) return false;
  if (binding.keys) {
    for (const key of binding.keys) if (state.isDown(key)) return true;
  }
  if (binding.modifier === 'shift') return state.shift();
  if (binding.modifier === 'ctrl') return state.ctrl();
  if (binding.modifier === 'alt') return state.alt();
  return false;
}

// ── The movement transport (what the cart ships to the host step) ───────────

export type MoveAxes = {
  /** W(+1) / S(−1) */
  forward: number;
  /** D(+1) / A(−1) */
  strafe: number;
};

/** Raw key axes from the held snapshot — pure transport packaging, no math. */
export function moveAxes(state: KeyState): MoveAxes {
  let forward = 0;
  let strafe = 0;
  if (actionDown(state, 'moveForward')) forward += 1;
  if (actionDown(state, 'moveBack')) forward -= 1;
  if (actionDown(state, 'strafeRight')) strafe += 1;
  if (actionDown(state, 'strafeLeft')) strafe -= 1;
  return { forward, strafe };
}

export type MoveIntent = { x: number; z: number };

/**
 * Camera-relative movement DIRECTION — the vector the cart ships down the
 * packed physics input buffer (GAME_PHYSICS stepPhysics intentX/intentZ).
 * |intent| never exceeds 1; no dt, no speed, no velocity — direction is
 * transport, integration is the host's (V7).
 *
 * THE JS TWIN of framework/game/movement.zig `wasdDirection` — the canonical
 * formula lives there but has no V8 binding, and the committed physics wire
 * takes the already-rotated intent, so the cart-side twin is unavoidable.
 * Sign convention pinned by tests: the engine renders world +X as
 * screen-LEFT, so strafe takes the opposite sign of forward to keep D
 * walking screen-right. If wasdDirection ever gets a binding, this retires.
 */
export function moveIntent(axes: MoveAxes, yawRadians: number): MoveIntent {
  let fwd = axes.forward;
  let str = axes.strafe;
  const len2 = fwd * fwd + str * str;
  if (len2 > 1) {
    const inv = 1 / Math.sqrt(len2);
    fwd *= inv;
    str *= inv;
  }
  const cy = Math.cos(yawRadians);
  const sy = Math.sin(yawRadians);
  return {
    x: fwd * sy - str * cy,
    z: fwd * cy + str * sy,
  };
}

// ── The pointer wire ─────────────────────────────────────────────────────────

const POINTER_HOST_FN = {
  x: 'getMouseX',
  y: 'getMouseY',
  leftDown: 'getMouseDown',
  rightDown: 'getMouseRightDown',
  delta: '__mouse_delta',
  capture: '__mouse_capture',
} as const;

const TYPING_GATE_HOST_FN = '__tel_input';

export type PointerState = {
  x: number;
  y: number;
  leftDown: boolean;
  rightDown: boolean;
};

export type InputAvailability = {
  /** every wire fn this door wants that the host did NOT register */
  missing: string[];
  /** true when the full pointer + typing-gate surface is wired */
  complete: boolean;
};

/** Which of this door's host fns are actually registered. Keys ride the in-JS
 *  bus and need none; everything pointer/typing-gate-side is named here. */
export function availability(): InputAvailability {
  const wanted = [...Object.values(POINTER_HOST_FN), TYPING_GATE_HOST_FN];
  const missing = wanted.filter((name) => !hasHost(name));
  return { missing, complete: missing.length === 0 };
}

function readHostNumber(name: string): number {
  const value = callHost<number>(name, 0);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The absolute pointer snapshot. Zeros/false when unwired (see availability). */
export function readPointer(): PointerState {
  return {
    x: readHostNumber(POINTER_HOST_FN.x),
    y: readHostNumber(POINTER_HOST_FN.y),
    leftDown: readHostNumber(POINTER_HOST_FN.leftDown) > 0,
    rightDown: readHostNumber(POINTER_HOST_FN.rightDown) > 0,
  };
}

/** Relative-mode mouse deltas since the last read — the mouse-look feed while
 *  pointer capture is on. {0,0} when unwired. */
export function readPointerDelta(): { dx: number; dy: number } {
  const value = callHost<{ dx?: number; dy?: number } | null>(POINTER_HOST_FN.delta, null);
  const dx = Number(value?.dx ?? 0);
  const dy = Number(value?.dy ?? 0);
  return {
    dx: Number.isFinite(dx) ? dx : 0,
    dy: Number.isFinite(dy) ? dy : 0,
  };
}

/** Relative mouse mode on/off (hides the cursor, routes motion to
 *  __mouse_delta). Returns whether the wire existed — never a silent no-op. */
export function setPointerCapture(enabled: boolean): boolean {
  if (!hasHost(POINTER_HOST_FN.capture)) return false;
  callHost<void>(POINTER_HOST_FN.capture, undefined as never, enabled ? 1 : 0);
  return true;
}

/** Subscribe to absolute cursor movement on the bus ({x, y, dx, dy}). */
export function onCursorMove(fn: (event: { x: number; y: number; dx: number; dy: number }) => void): () => void {
  return subscribe('system:cursor:move', fn);
}

// ── The typing gate ──────────────────────────────────────────────────────────

/** Is a TextInput/TextArea focused anywhere? Movement consumers gate held
 *  keys on this so typing never walks the player (the PaintCanvas idiom).
 *  Unwired reads false — "not typing" is the honest default. */
export function isTextEditing(): boolean {
  const value = callHost<{ focused_id?: number } | null>(TYPING_GATE_HOST_FN, null);
  return !!value && Number(value.focused_id ?? -1) >= 0;
}

// ── THE DOOR ────────────────────────────────────────────────────────────────

export const GAME_INPUT = Object.freeze({
  // key transport
  createKeyState,
  onKeyDown,
  onKeyUp,
  // the control contract + readers
  bindings: INPUT_BINDINGS,
  actionDown,
  moveAxes,
  moveIntent,
  // pointer transport
  availability,
  readPointer,
  readPointerDelta,
  setPointerCapture,
  onCursorMove,
  // the typing gate
  isTextEditing,
});
