// game/commands/console.ts — the in-game console SESSION (the CS idiom over
// the V19 scripting surface).
//
// Pure and headless: key events in, registry dispatch, transcript ring out.
// The overlay that DRAWS a session is route/editor chrome; this file owns the
// input discipline so it is P4-testable without a window:
//
//   • the toggle key (backtick) opens/closes and is NEVER appended to the
//     line buffer — consumed by the toggle, by construction
//   • while open, EVERY key is consumed (handleKey returns true) — the game
//     gates its movement/jump/aim reads on isOpen(), so typed characters go
//     only to the console
//   • Enter dispatches the buffer through the captured CommandRegistry; the
//     vocabulary's output lands in the transcript verbatim (error lines keep
//     the registry's ok=false marking)
//   • Escape (or backtick again) closes; the buffer survives for the next open
//   • up/down walk the submit history (the CS muscle memory)
//
// The session owns its own line buffer instead of riding the TextInput
// primitive: host input focus is click-hit-test only (engine.zig — no
// programmatic focus wire), and a CS console must accept typing the instant
// it opens. Keys arrive as the framework bus's decoded names (the GAME_INPUT
// wire truths: 'space' for space, lowercase names, TRUE modifier flags) —
// printables are reconstructed here with a US-layout shift table.
//
// P2: the transcript cap rides COMMAND_TUNING's event ring capacity; the
// history depth is the one console-own constant below.

import type { CommandRegistry } from './index';
import { COMMAND_TUNING } from './vocabulary';

export type ConsoleLineKind = 'input' | 'output' | 'error';
export type ConsoleLine = { id: number; kind: ConsoleLineKind; text: string };

/** The bus keydown payload shape the session consumes (GAME_INPUT.onKeyDown). */
export type ConsoleKeyEvent = {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type ConsoleSession = {
  isOpen: () => boolean;
  /** the live input line (append-at-end editing, lean v1) */
  buffer: () => string;
  transcript: () => readonly ConsoleLine[];
  /**
   * Feed every keydown. Returns true when the console consumed the key —
   * closed: only the toggle key; open: every key (the input discipline).
   */
  handleKey: (event: ConsoleKeyEvent) => boolean;
  /** dispatch one line through the registry (what Enter does) */
  submit: (line: string) => void;
  /** bumps on every visible change — a React consumer mirrors this into state */
  revision: () => number;
};

export const CONSOLE_TOGGLE_KEY = '`';
export const CONSOLE_CLOSE_KEYS: readonly string[] = [CONSOLE_TOGGLE_KEY, 'escape'];

const HISTORY_DEPTH = 64;

// US-layout shift table for the printable reconstruction (the wire ships the
// unshifted SDL sym + a TRUE shift flag, never the shifted character).
const SHIFT_MAP: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
};

function printableOf(key: string, shift: boolean): string | null {
  if (key === 'space') return ' ';
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0);
  if (code < 32 || code > 126) return null;
  if (!shift) return key;
  if (key >= 'a' && key <= 'z') return key.toUpperCase();
  return SHIFT_MAP[key] ?? key;
}

export function createConsoleSession<Ctx>(
  registry: CommandRegistry<Ctx>,
  ctx: Ctx,
  opts?: {
    /** transcript ring cap; defaults to the command tuning's event ring */
    maxTranscriptLines?: number;
    /** sync the live game INTO ctx before a command runs (pose, etc.) */
    beforeRun?: (ctx: Ctx) => void;
    /** adopt ctx changes back OUT into the live game after a command ran */
    afterRun?: (ctx: Ctx) => void;
  },
): ConsoleSession {
  const cap = Math.max(8, opts?.maxTranscriptLines ?? COMMAND_TUNING.events.ringCapacity);
  const lines: ConsoleLine[] = [];
  const history: string[] = [];
  let historyAt = -1; // -1 = live buffer (not browsing)
  let open = false;
  let buffer = '';
  let rev = 0;
  let nextLineId = 1;

  const push = (kind: ConsoleLineKind, text: string): void => {
    lines.push({ id: nextLineId, kind, text });
    nextLineId += 1;
    if (lines.length > cap) lines.splice(0, lines.length - cap);
  };

  const submit = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    push('input', `> ${trimmed}`);
    if (history[history.length - 1] !== trimmed) {
      history.push(trimmed);
      if (history.length > HISTORY_DEPTH) history.splice(0, history.length - HISTORY_DEPTH);
    }
    historyAt = -1;
    opts?.beforeRun?.(ctx);
    const outcome = registry.run(ctx, trimmed);
    for (const text of outcome.output) push(outcome.ok ? 'output' : 'error', text);
    opts?.afterRun?.(ctx);
    rev += 1;
  };

  const handleKey = (event: ConsoleKeyEvent): boolean => {
    const key = String(event?.key ?? '').toLowerCase();
    if (!key) return open; // open consumes even unnamed keys
    if (!open) {
      if (key !== CONSOLE_TOGGLE_KEY) return false;
      open = true;
      rev += 1;
      return true; // the toggle key never reaches the buffer
    }
    // open: every key below is consumed
    if (CONSOLE_CLOSE_KEYS.includes(key)) {
      open = false;
      rev += 1;
      return true;
    }
    if (key === 'return' || key === 'enter') {
      const line = buffer;
      buffer = '';
      rev += 1;
      submit(line);
      return true;
    }
    if (key === 'backspace') {
      if (buffer.length > 0) {
        buffer = buffer.slice(0, -1);
        rev += 1;
      }
      return true;
    }
    if (key === 'up') {
      if (history.length > 0) {
        historyAt = historyAt === -1 ? history.length - 1 : Math.max(0, historyAt - 1);
        buffer = history[historyAt];
        rev += 1;
      }
      return true;
    }
    if (key === 'down') {
      if (historyAt !== -1) {
        historyAt = historyAt + 1 >= history.length ? -1 : historyAt + 1;
        buffer = historyAt === -1 ? '' : history[historyAt];
        rev += 1;
      }
      return true;
    }
    if (event?.ctrlKey || event?.altKey || event?.metaKey) return true; // chords: consumed, ignored
    const ch = printableOf(key, event?.shiftKey === true);
    if (ch !== null) {
      buffer += ch;
      historyAt = -1;
      rev += 1;
    }
    return true; // even non-printables (shift itself, F-keys) never leak to the game
  };

  return {
    isOpen: () => open,
    buffer: () => buffer,
    transcript: () => lines,
    handleKey,
    submit,
    revision: () => rev,
  };
}
