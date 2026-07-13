// commands/keychord.ts — the keychord parser / normalizer.
//
// One job, done once: turn any human-written or event-derived chord into a
// single CANONICAL string so a menu hotkey, a tooltip hint, and a live keydown
// all resolve to the exact same key. This is repurposed from the editor-control
// donor (cart/hmsc-int/editors/controls.ts) — its chord vocabulary and ctrl→
// alt→shift→meta ordering — but it lives here, in runtime/, with no cart import.
//
// Canonical form: modifiers lowercased in ctrl+alt+shift+meta order, then the
// base key, joined by '+'  →  'Ctrl+Shift+Z' and 'control+z+shift'(any order)
// both normalize to 'ctrl+shift+z'. A bare key has no modifiers ('escape').

/** Modifier spellings that all mean the same chord prefix. */
const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'ctrl', control: 'ctrl', ctl: 'ctrl', cmd: 'meta', command: 'meta',
  meta: 'meta', super: 'meta', win: 'meta', alt: 'alt', option: 'alt', opt: 'alt',
  shift: 'shift',
};

/** Base-key spellings normalized to one name (the DOM-ish lowercase key). */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape', del: 'delete', return: 'enter', bksp: 'backspace',
  up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  spacebar: 'space', ' ': 'space',
};

/** Stable modifier order — the only order canonical chords are written in. */
const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

const PRETTY: Record<string, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Cmd', escape: 'Esc',
  delete: 'Del', backspace: 'Bksp', enter: 'Enter', space: 'Space', home: 'Home',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
};

/** Printable non-alphanumeric keys used by desktop-app keymaps. `+` itself is
 * intentionally absent because `+` is the chord separator. This covers the
 * characters a native key event may report after Shift (notably `?`). */
const PRINTABLE_BASE_KEYS = new Set([
  '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', ',', '-', '.', '/',
  ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`',
  '{', '|', '}', '~',
]);

/** Parse + canonicalize a chord string. Throws on a malformed chord (no base
 *  key, or two base keys) — a bad default key is an author error, caught at
 *  registration just like a duplicate command id. */
export function normalizeChord(chord: string): string {
  const parts = String(chord ?? '')
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (!parts.length) throw new Error(`keychord: empty chord ${JSON.stringify(chord)}`);

  const mods = new Set<string>();
  let base: string | null = null;
  for (const p of parts) {
    const mod = MODIFIER_ALIASES[p];
    if (mod) { mods.add(mod); continue; }
    const key = KEY_ALIASES[p] ?? p;
    if (base !== null) {
      throw new Error(`keychord: ${JSON.stringify(chord)} has two base keys (${base}, ${key})`);
    }
    base = key;
  }
  if (base === null) throw new Error(`keychord: ${JSON.stringify(chord)} has no base key`);
  if (!/^[a-z0-9]+$/.test(base) && !PRINTABLE_BASE_KEYS.has(base)) {
    throw new Error(`keychord: ${JSON.stringify(chord)} has an unsupported base key (${JSON.stringify(base)})`);
  }

  return [...MOD_ORDER.filter((m) => mods.has(m)), base].join('+');
}

/** Same as normalizeChord but returns null instead of throwing — for resolving
 *  a live, possibly-junk key string without a try/catch at the call site. */
export function tryNormalizeChord(chord: string): string | null {
  try { return normalizeChord(chord); } catch { return null; }
}

/** A key-bus / DOM-ish event. */
export interface KeyChordEvent {
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

/** Canonical chord for a key event — the live-keydown twin of normalizeChord. */
export function chordFromEvent(ev: KeyChordEvent): string {
  const base = KEY_ALIASES[String(ev?.key ?? '').toLowerCase()] ?? String(ev?.key ?? '').toLowerCase();
  const mods = MOD_ORDER.filter((m) =>
    (m === 'ctrl' && ev?.ctrlKey) || (m === 'alt' && ev?.altKey) ||
    (m === 'shift' && ev?.shiftKey) || (m === 'meta' && ev?.metaKey));
  return [...mods, base].join('+');
}

/** Human-readable chord for a tooltip / menu row: 'ctrl+shift+z' → 'Ctrl+Shift+Z'. */
export function prettyChord(chord: string): string {
  return tryNormalizeChord(chord)?.split('+')
    .map((p) => PRETTY[p] ?? (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join('+') ?? chord;
}
