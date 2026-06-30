// commands/command.ts — the editor COMMAND + keybinding registry.
//
// "The text menu is the source of truth." Every editor action is one CommandDef,
// registered ONCE via defineCommand() (mirroring defineEventType()'s anti-
// collision seam: re-using an id throws, so parallel workers add commands
// without editing a shared switch). The SAME command is reachable two ways —
// from its menu (commandsByMenu) and from its hotkey (resolveHotkey) — because
// both indexes point at one CommandDef, so a menu and a keypress can never drift
// apart.
//
// Commands EMIT, they never mutate. A command's run(ctx) builds an authoring
// event and dispatch()es it on the editorbus (runtime/editorbus); the bus
// orders it and the hot index / dock / console fold the ordered stream. That
// keeps the editor multiplayer-shaped and the latency doctrine achievable.
//
// Keybinds: a sensible default per command (defaultKey), normalized through
// keychord.ts so 'Ctrl+Shift+Z' and 'control+z+shift' resolve identically.
// Light, self-serve rebinding (rebindHotkey + export/load) layers over the
// defaults; the registry stays a deep module behind a narrow surface.

import { type TargetRef } from '../editorbus';
import { normalizeChord, tryNormalizeChord } from './keychord';

/** Top menu the command appears under. Open vocabulary owned by the cart's menu
 *  bar ('File' | 'Edit' | 'View' | 'Map' | 'Build' | 'Story' | 'Window' | …). */
export type Menu = string;

/** What a command's run() is handed when it fires. Commands read it to shape the
 *  event they emit (which things are targeted, any inline arguments) — they do
 *  NOT receive a state handle, because they emit rather than mutate. */
export interface CommandContext {
  /** The things the action affects, carried into the emitted event's `targets`
   *  so dirty-tracking / the hot index stay O(1). Empty for global commands. */
  targets?: TargetRef[];
  /** Optional per-invocation arguments (e.g. the piece a "place" command stamps). */
  args?: Record<string, unknown>;
}

/** One editor command. The narrow public surface every menu row, palette entry,
 *  and hotkey resolves to. */
export interface CommandDef {
  /** Stable kebab id and registry key, e.g. 'redo-local'. */
  id: string;
  /** Top menu it lists under. */
  menu: Menu;
  /** Human label shown in the menu / palette, e.g. 'Redo Local Step'. */
  label: string;
  /** Icon token (lucide name) the menu row renders. */
  icon: string;
  /** Sensible default key chord, any spelling — normalized on registration.
   *  Omit for a command with no hotkey (menu-only). */
  defaultKey?: string;
  /** Whether the emitted edit participates in normal undo. */
  undoable: boolean;
  /** Whether the action runs as a native (Zig) interactable system vs JS-only. */
  native: boolean;
  /** Fire the command: build an authoring event and dispatch() it. EMIT only —
   *  never mutate editor state here. */
  run(ctx: CommandContext): void;
}

const BY_ID = new Map<string, CommandDef>();
const BY_HOTKEY = new Map<string, string>();   // normalized chord -> command id
const ID_TO_HOTKEY = new Map<string, string>(); // command id -> normalized chord
const OVERRIDDEN = new Set<string>();           // ids whose chord was rebound

function bindHotkey(id: string, normChord: string): void {
  const holder = BY_HOTKEY.get(normChord);
  if (holder && holder !== id) {
    throw new Error(`commands: HOTKEY CONFLICT — '${normChord}' is bound to both ${holder} and ${id}`);
  }
  const prev = ID_TO_HOTKEY.get(id);
  if (prev && prev !== normChord) BY_HOTKEY.delete(prev);
  BY_HOTKEY.set(normChord, id);
  ID_TO_HOTKEY.set(id, normChord);
}

/** Register a command ONCE. Re-using an id throws (two systems fighting over one
 *  name — the seam exists to prevent it), as does colliding on a default key.
 *  Returns the def so a workstream can keep a typed handle. */
export function defineCommand(def: CommandDef): CommandDef {
  if (BY_ID.has(def.id)) {
    throw new Error(`commands: command id '${def.id}' already registered`);
  }
  if (def.defaultKey != null && def.defaultKey !== '') {
    bindHotkey(def.id, normalizeChord(def.defaultKey)); // throws on malformed / conflict
  }
  BY_ID.set(def.id, def);
  return def;
}

/** Look a command up by id (palette, command bar, programmatic dispatch). */
export function commandById(id: string): CommandDef | undefined {
  return BY_ID.get(id);
}

/** Every command under a menu, in registration order — the menu IS the source
 *  of truth, so this is what the menu bar renders. */
export function commandsByMenu(menu: Menu): CommandDef[] {
  return [...BY_ID.values()].filter((c) => c.menu === menu);
}

/** Resolve a key chord (any spelling) to its command — the live-keydown entry
 *  point. Returns the SAME CommandDef its menu row points at. Unknown / junk
 *  chord → undefined (never throws on a live key). */
export function resolveHotkey(keyChord: string): CommandDef | undefined {
  const norm = tryNormalizeChord(keyChord);
  if (norm == null) return undefined;
  const id = BY_HOTKEY.get(norm);
  return id ? BY_ID.get(id) : undefined;
}

/** Run a command by id with an optional context. Convenience over
 *  `commandById(id)?.run(ctx)` that surfaces an unknown id loudly. */
export function runCommand(id: string, ctx: CommandContext = {}): void {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`commands: no command '${id}'`);
  c.run(ctx);
}

/** The effective (possibly rebound) normalized chord for a command, or '' if
 *  unbound. The legend / tooltip reads this so a rebind shows everywhere. */
export function hotkeyFor(id: string): string {
  return ID_TO_HOTKEY.get(id) ?? '';
}

/** All registered commands — for the command palette and validation tooling. */
export function registeredCommands(): CommandDef[] {
  return [...BY_ID.values()];
}

export type RebindResult = { ok: true } | { ok: false; conflict: string };

/** Self-serve rebind: point a command at a new chord. Rejects a malformed chord
 *  or a collision with another command (a warning, never a crash — the user-
 *  facing twin of the boot-time conflict check). Light persistence only:
 *  exportHotkeys/loadHotkeys round-trip the overrides; this is not a full
 *  rebinding UI. */
export function rebindHotkey(id: string, keyChord: string): RebindResult {
  if (!BY_ID.has(id)) return { ok: false, conflict: `no command '${id}'` };
  const norm = tryNormalizeChord(keyChord);
  if (norm == null) return { ok: false, conflict: `'${keyChord}' is not a valid chord` };
  const holder = BY_HOTKEY.get(norm);
  if (holder && holder !== id) return { ok: false, conflict: `'${norm}' is already bound to ${holder}` };
  bindHotkey(id, norm);
  OVERRIDDEN.add(id);
  return { ok: true };
}

/** Only the user's rebinds (id → chord), for persistence. */
export function exportHotkeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of OVERRIDDEN) out[id] = ID_TO_HOTKEY.get(id)!;
  return out;
}

/** Apply saved rebinds (boot-time). Silently drops unknown / malformed / now-
 *  conflicting entries so a corrupt store can never break input. */
export function loadHotkeys(saved: Record<string, string> | null | undefined): void {
  for (const [id, chord] of Object.entries(saved ?? {})) {
    if (typeof chord === 'string') rebindHotkey(id, chord);
  }
}
