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
export type ConsoleWatch = { expr: string; mode: 'js' | 'lua'; lastResult: string };

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
  /**
   * Feed every keyup. Re-arms the toggle edge — the engine bus delivers SDL
   * key REPEATS as fresh keydowns (engine.zig filters nothing), so the toggle
   * flips on the keydown EDGE only: further toggle keydowns are ignored until
   * this sees the key released (one physical press = exactly one flip).
   */
  handleKeyUp: (event: ConsoleKeyEvent) => void;
  /** dispatch one line through the registry (what Enter does) */
  submit: (line: string) => void;
  /** advance live watch evaluation; overlays call this from their frame tick */
  update: (dtSeconds?: number) => void;
  /** active watch expressions, carrying the last evaluated result */
  watches: () => readonly ConsoleWatch[];
  /**
   * The lines an overlay of `count` rows shows, honoring scrollback —
   * PageUp/PageDown walk the transcript (long `help` output is readable);
   * a submit snaps back to the tail.
   */
  visibleTail: (count: number) => ConsoleLine[];
  /** lines currently scrolled back from the tail (0 = live tail) */
  scrollOffset: () => number;
  /** bumps on every visible change — a React consumer mirrors this into state */
  revision: () => number;
};

export const CONSOLE_TOGGLE_KEY = '`';
/** '~' aliases the toggle — some layouts/wires name shifted-backquote directly */
export const CONSOLE_TOGGLE_KEYS: readonly string[] = [CONSOLE_TOGGLE_KEY, '~'];
export const CONSOLE_CLOSE_KEYS: readonly string[] = [...CONSOLE_TOGGLE_KEYS, 'escape'];

const HISTORY_DEPTH = 64;
/** lines one PageUp/PageDown press moves the scrollback */
const SCROLL_PAGE_LINES = 12;
const WATCH_UPDATE_SECONDS = 0.5;

type ConsoleTemplate = { desc: string; code: string };

const CONSOLE_TEMPLATES: Record<string, ConsoleTemplate> = {
  box: {
    desc: 'Basic Box component',
    code: `<Box style={{ width: '100%', height: '100%', backgroundColor: '#1e1e2e' }}>
  <Text style={{ fontSize: 16, color: '#cdd6f4' }}>Hello</Text>
</Box>`,
  },
  flexrow: {
    desc: 'Horizontal flex row',
    code: `<Box style={{ flexDirection: 'row', width: '100%', gap: 8, padding: 12 }}>
  <Box style={{ flexGrow: 1, height: 40, backgroundColor: '#45475a' }} />
  <Box style={{ flexGrow: 1, height: 40, backgroundColor: '#585b70' }} />
  <Box style={{ flexGrow: 1, height: 40, backgroundColor: '#6c7086' }} />
</Box>`,
  },
  card: {
    desc: 'Card with header and body',
    code: `<Box style={{ width: 300, backgroundColor: '#1e1e2e', borderRadius: 8, padding: 16 }}>
  <Text style={{ fontSize: 18, color: '#cdd6f4', marginBottom: 8 }}>Card Title</Text>
  <Text style={{ fontSize: 13, color: '#a6adc8' }}>Card body text goes here.</Text>
</Box>`,
  },
  scrollview: {
    desc: 'ScrollView container',
    code: `<ScrollView style={{ width: '100%', height: 300, backgroundColor: '#181825' }}>
  {/* Content here */}
</ScrollView>`,
  },
  pressable: {
    desc: 'Pressable button',
    code: `<Pressable
  onPress={() => console.log('pressed!')}
  style={{ backgroundColor: '#89b4fa', paddingTop: 8, paddingBottom: 8, paddingLeft: 16, paddingRight: 16, borderRadius: 6 }}
>
  <Text style={{ fontSize: 14, color: '#1e1e2e' }}>Click Me</Text>
</Pressable>`,
  },
  grid: {
    desc: 'CSS-like grid layout using flex',
    code: `<Box style={{ width: '100%', height: '100%', padding: 16, gap: 16 }}>
  <Box style={{ flexDirection: 'row', width: '100%', gap: 16, flexGrow: 1 }}>
    <Box style={{ flexGrow: 2, backgroundColor: '#313244', borderRadius: 8 }} />
    <Box style={{ flexGrow: 1, backgroundColor: '#313244', borderRadius: 8 }} />
  </Box>
  <Box style={{ flexDirection: 'row', width: '100%', gap: 16, flexGrow: 1 }}>
    <Box style={{ flexGrow: 1, backgroundColor: '#313244', borderRadius: 8 }} />
    <Box style={{ flexGrow: 1, backgroundColor: '#313244', borderRadius: 8 }} />
    <Box style={{ flexGrow: 1, backgroundColor: '#313244', borderRadius: 8 }} />
  </Box>
</Box>`,
  },
  catppuccin: {
    desc: 'Catppuccin Mocha color palette reference',
    code: `// Catppuccin Mocha
const colors = {
  rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7',
  mauve: '#cba6f7', red: '#f38ba8', maroon: '#eba0ac',
  peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1',
  teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec',
  blue: '#89b4fa', lavender: '#b4befe', text: '#cdd6f4',
  subtext1: '#bac2de', subtext0: '#a6adc8', overlay2: '#9399b2',
  overlay1: '#7f849c', overlay0: '#6c7086', surface2: '#585b70',
  surface1: '#45475a', surface0: '#313244', base: '#1e1e2e',
  mantle: '#181825', crust: '#11111b',
};`,
  },
};

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

function templateNames(): string[] {
  return Object.keys(CONSOLE_TEMPLATES).sort();
}

function stringifyWatchResult(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function watchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evalJsSilent(expr: string): string {
  const g = globalThis as unknown as { __js_eval?: (source: string) => unknown };
  try {
    if (typeof g.__js_eval === 'function') return stringifyWatchResult(g.__js_eval(expr));
    try {
      return stringifyWatchResult(Function(`"use strict"; return (${expr});`)());
    } catch {
      return stringifyWatchResult(Function(`"use strict"; ${expr}`)());
    }
  } catch (error) {
    return `Error: ${watchError(error)}`;
  }
}

function evalLuaSilent(expr: string): string {
  const g = globalThis as unknown as { __lua_eval?: (source: string) => unknown };
  if (typeof g.__lua_eval !== 'function') return 'n/a';
  try {
    return stringifyWatchResult(g.__lua_eval(expr));
  } catch (error) {
    return `error: ${watchError(error)}`;
  }
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
  let scrollBack = 0; // lines scrolled up from the tail (0 = live tail)
  const watches: ConsoleWatch[] = [];
  const macros: Record<string, string[]> = {};
  let recording: string | null = null;
  let recordBuffer: string[] = [];
  let watchElapsed = WATCH_UPDATE_SECONDS;
  let lastWatchWallMs = 0;

  const push = (kind: ConsoleLineKind, text: string): void => {
    lines.push({ id: nextLineId, kind, text });
    nextLineId += 1;
    if (lines.length > cap) lines.splice(0, lines.length - cap);
  };

  const updateWatches = (dtSeconds?: number): void => {
    if (watches.length === 0) return;
    if (dtSeconds == null) {
      const now = Date.now();
      if (lastWatchWallMs === 0) lastWatchWallMs = now;
      dtSeconds = Math.max(0, (now - lastWatchWallMs) / 1000);
      lastWatchWallMs = now;
    }
    watchElapsed += dtSeconds;
    if (watchElapsed < WATCH_UPDATE_SECONDS) return;
    watchElapsed = 0;
    for (const watch of watches) {
      watch.lastResult = watch.mode === 'lua' ? evalLuaSilent(watch.expr) : evalJsSilent(watch.expr);
    }
    rev += 1;
  };

  const pushOutputLines = (output: string[]): void => {
    for (const text of output) push('output', text);
  };

  const isMacroControlCommand = (trimmed: string): boolean => {
    if (!trimmed.startsWith(':')) return false;
    const name = trimmed.slice(1).split(/\s+/, 1)[0] ?? '';
    return name === 'stop' || name === 'record' || name === 'play';
  };

  const runBuiltin = (trimmed: string): boolean => {
    if (!trimmed.startsWith(':')) return false;
    const match = trimmed.slice(1).match(/^(\S+)(?:\s+(.*))?$/);
    if (!match) return false;
    const name = match[1];
    const args = match[2] ?? '';

    if (name === 'watch') {
      if (args === '') {
        push('error', 'Usage: :watch <js expr>  or  :watch lua <lua expr>');
        return true;
      }
      const lua = args.match(/^lua\s+(.+)$/);
      if (lua) {
        watches.push({ expr: lua[1], mode: 'lua', lastResult: '' });
        push('output', `Watch #${watches.length} (Lua): ${lua[1]}`);
      } else {
        watches.push({ expr: args, mode: 'js', lastResult: '' });
        push('output', `Watch #${watches.length} (JS): ${args}`);
      }
      watchElapsed = WATCH_UPDATE_SECONDS;
      return true;
    }

    if (name === 'unwatch') {
      const idx = Number(args);
      if (!Number.isInteger(idx) || idx < 1 || idx > watches.length) {
        push('error', `Usage: :unwatch <index>  (1-${watches.length})`);
        return true;
      }
      const removed = watches.splice(idx - 1, 1)[0];
      push('output', `Removed watch #${idx}: ${removed.expr}`);
      return true;
    }

    if (name === 'watches') {
      updateWatches(WATCH_UPDATE_SECONDS);
      if (watches.length === 0) {
        push('output', 'No active watches');
      } else {
        push('output', 'Active watches:');
        watches.forEach((watch, index) => {
          push('output', `  [${index + 1}] (${watch.mode}) ${watch.expr} = ${watch.lastResult}`);
        });
      }
      return true;
    }

    if (name === 'record') {
      if (args === '') {
        push('error', 'Usage: :record <name>');
        return true;
      }
      recording = args;
      recordBuffer = [];
      push('output', `Recording macro '${args}'... (type :stop to finish)`);
      return true;
    }

    if (name === 'stop') {
      if (!recording) {
        push('output', 'Not recording');
        return true;
      }
      macros[recording] = [...recordBuffer];
      push('output', `Saved macro '${recording}' (${recordBuffer.length} commands)`);
      recording = null;
      recordBuffer = [];
      return true;
    }

    if (name === 'play') {
      if (args === '') {
        push('error', 'Usage: :play <name>');
        return true;
      }
      const commands = macros[args];
      if (!commands) {
        push('error', `Macro not found: ${args}`);
        const names = Object.keys(macros);
        if (names.length > 0) push('output', `Available: ${names.join(', ')}`);
        return true;
      }
      push('output', `Playing macro '${args}' (${commands.length} commands):`);
      for (const command of commands) submit(command);
      return true;
    }

    if (name === 'macros') {
      const names = Object.keys(macros);
      if (names.length === 0) {
        push('output', 'No macros saved. Use :record <name> to start.');
      } else {
        push('output', 'Saved macros:');
        for (const macroName of names) push('output', `  ${macroName} (${macros[macroName].length} commands)`);
      }
      return true;
    }

    if (name === 'template') {
      if (args === '') {
        push('error', 'Usage: :template <name>');
        push('output', 'Use :templates to list available templates');
        return true;
      }
      const tmpl = CONSOLE_TEMPLATES[args];
      if (!tmpl) {
        push('error', `Unknown template: ${args}`);
        push('output', `Available: ${templateNames().join(', ')}`);
        return true;
      }
      push('output', `${tmpl.desc}:`);
      pushOutputLines(tmpl.code.split('\n').map((line) => `  ${line}`));
      return true;
    }

    if (name === 'templates') {
      push('output', 'Available templates:');
      for (const templateName of templateNames()) {
        push('output', `  ${templateName.padEnd(12)} ${CONSOLE_TEMPLATES[templateName].desc}`);
      }
      push('output', '');
      push('output', 'Use :template <name> to view code');
      return true;
    }

    return false;
  };

  function submit(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    const transcriptStart = lines.length;
    push('input', `> ${trimmed}`);
    if (history[history.length - 1] !== trimmed) {
      history.push(trimmed);
      if (history.length > HISTORY_DEPTH) history.splice(0, history.length - HISTORY_DEPTH);
    }
    historyAt = -1;
    scrollBack = 0; // a submit snaps the view back to the live tail
    if (recording && !isMacroControlCommand(trimmed)) recordBuffer.push(trimmed);
    if (runBuiltin(trimmed)) {
      rev += 1;
      return;
    }
    opts?.beforeRun?.(ctx);
    const outcome = registry.run(ctx, trimmed);
    if (outcome.clearTranscript) lines.splice(0, lines.length);
    if (outcome.suppressTranscript) {
      lines.splice(transcriptStart, lines.length - transcriptStart);
    } else {
      for (const text of outcome.output) push(outcome.ok ? 'output' : 'error', text);
    }
    opts?.afterRun?.(ctx);
    rev += 1;
  }

  // The toggle is EDGE-triggered: the engine bus delivers SDL key repeats as
  // fresh keydowns (engine.zig filters nothing), so a held backtick would
  // otherwise flip the console open→closed→open ("opens twice" — the user
  // verdict that pinned this). Flip on the first keydown, ignore toggle
  // keydowns until handleKeyUp re-arms.
  let toggleHeld = false;

  const handleKey = (event: ConsoleKeyEvent): boolean => {
    const key = String(event?.key ?? '').toLowerCase();
    if (!key) return open; // open consumes even unnamed keys
    if (CONSOLE_TOGGLE_KEYS.includes(key)) {
      if (!toggleHeld) {
        toggleHeld = true;
        open = !open;
        rev += 1;
      }
      return true; // the toggle key never reaches the buffer, held or not
    }
    if (!open) return false;
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
    // Transcript scrollback — long output (help's full inventory) stays
    // readable; clamped so the view never scrolls past the oldest line.
    if (key === 'pageup') {
      const next = Math.min(Math.max(0, lines.length - 1), scrollBack + SCROLL_PAGE_LINES);
      if (next !== scrollBack) {
        scrollBack = next;
        rev += 1;
      }
      return true;
    }
    if (key === 'pagedown') {
      const next = Math.max(0, scrollBack - SCROLL_PAGE_LINES);
      if (next !== scrollBack) {
        scrollBack = next;
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

  const handleKeyUp = (event: ConsoleKeyEvent): void => {
    const key = String(event?.key ?? '').toLowerCase();
    if (CONSOLE_TOGGLE_KEYS.includes(key)) toggleHeld = false;
  };

  return {
    isOpen: () => open,
    buffer: () => buffer,
    transcript: () => lines,
    handleKey,
    handleKeyUp,
    submit,
    update: updateWatches,
    watches: () => watches,
    visibleTail: (count: number): ConsoleLine[] => {
      const end = Math.max(0, lines.length - scrollBack);
      return lines.slice(Math.max(0, end - Math.max(1, count)), end);
    },
    scrollOffset: () => scrollBack,
    revision: () => rev,
  };
}
