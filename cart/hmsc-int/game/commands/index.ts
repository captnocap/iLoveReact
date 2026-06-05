// game/commands/index.ts — GAME_COMMANDS: the console-command registry AND the
// test scripting surface.
//
// V19 (green has an explicit meaning): anything testable is scriptable here.
// The console commands move IN from hmsc (cart/hmsc/commands/registry.ts is
// the behavior reference — an extraction surface, never modified, V15-
// TRANSITION); a verify script is a recorded command sequence replayed
// headless by compile/verify. The same registry will back the editors/console
// route, so "what I typed in the console" and "what the verify bot replays"
// are one language.
//
// The registry is generic over the context it mutates (the headless boot
// carries its world state through; editors carry theirs) — commands stay pure
// functions of (ctx, args). Validation lives at this boundary: unknown
// commands, duplicate names, and thrown command errors all resolve to a
// CommandOutcome — callers never try/catch.

import { parseCommandValue, tokenizeCommandLine } from './parser';

export type CommandOutcome = {
  ok: boolean;
  /** console lines (error text when ok is false) */
  output: string[];
};

export type CommandSpec<Ctx> = {
  /** the word typed in the console — lowercase, no whitespace */
  name: string;
  /** one-line `name <args>` signature for help text */
  usage: string;
  summary: string;
  /** output lines (or nothing); throw to fail the command */
  run: (ctx: Ctx, args: string[]) => string[] | void;
};

export type ScriptResult = {
  ok: boolean;
  /** every executed line with its output, in order — the replay record */
  transcript: string[];
  commandsRun: number;
};

export type CommandRegistry<Ctx> = {
  define: (spec: CommandSpec<Ctx>) => void;
  /** every spec, sorted by name — help text and editors/console listings */
  list: () => CommandSpec<Ctx>[];
  run: (ctx: Ctx, line: string) => CommandOutcome;
  /** V19 verify semantics: blank/# lines skip, first failure stops the script */
  runScript: (ctx: Ctx, lines: string[]) => ScriptResult;
};

export function createCommandRegistry<Ctx>(): CommandRegistry<Ctx> {
  const specs = new Map<string, CommandSpec<Ctx>>();

  const define = (spec: CommandSpec<Ctx>): void => {
    if (!spec.name || /\s/.test(spec.name)) {
      throw new Error(`command name ${JSON.stringify(spec.name)} must be one non-empty word`);
    }
    if (spec.name !== spec.name.toLowerCase()) {
      throw new Error(`command name "${spec.name}" must be lowercase`);
    }
    if (specs.has(spec.name)) {
      throw new Error(`command "${spec.name}" is already defined`);
    }
    specs.set(spec.name, spec);
  };

  const run = (ctx: Ctx, line: string): CommandOutcome => {
    const tokens = tokenizeCommandLine(line);
    if (tokens.length === 0) return { ok: true, output: [] };
    const spec = specs.get(tokens[0].toLowerCase());
    if (!spec) {
      return { ok: false, output: [`error: unknown command "${tokens[0]}" (try: help)`] };
    }
    try {
      const output = spec.run(ctx, tokens.slice(1));
      return { ok: true, output: output ?? [] };
    } catch (error: any) {
      return { ok: false, output: [`error: ${error?.message ?? String(error)}`] };
    }
  };

  const runScript = (ctx: Ctx, lines: string[]): ScriptResult => {
    const transcript: string[] = [];
    let commandsRun = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const outcome = run(ctx, line);
      transcript.push(`> ${line}`, ...outcome.output);
      if (!outcome.ok) return { ok: false, transcript, commandsRun };
      commandsRun += 1;
    }
    return { ok: true, transcript, commandsRun };
  };

  return {
    define,
    list: () => [...specs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    run,
    runScript,
  };
}

export { parseCommandValue, tokenizeCommandLine };

// The captured hmsc console vocabulary (48 names; see ./vocabulary.ts +
// CAPTURE.md). defineGameCommands() registers it onto any registry whose ctx
// carries a GameCommandState; NOT_YET_CAPTURED lists the commands whose
// behavior still awaits its owning capture lane (they fail loudly until then).
export {
  COMMAND_TUNING,
  GAME_COMMAND_NAMES,
  NOT_YET_CAPTURED,
  SKY_NAMED_HOURS,
  SKY_WEATHER_PRESETS,
  createGameCommandState,
  defineGameCommands,
} from './vocabulary';
export type { GameCommandState, GameEvent, SpawnedEntity, Vec3Like } from './vocabulary';

// The in-game console SESSION (the CS idiom: backtick toggle, key-fed line
// buffer, registry dispatch, transcript ring). Pure + headless — see
// ./console.ts; overlays that draw a session are route/editor chrome.
export { CONSOLE_CLOSE_KEYS, CONSOLE_TOGGLE_KEY, createConsoleSession } from './console';
export type { ConsoleKeyEvent, ConsoleLine, ConsoleLineKind, ConsoleSession } from './console';

import {
  createGameCommandState as createGameCommandStateImpl,
  defineGameCommands as defineGameCommandsImpl,
  COMMAND_TUNING as COMMAND_TUNING_IMPL,
  GAME_COMMAND_NAMES as GAME_COMMAND_NAMES_IMPL,
  NOT_YET_CAPTURED as NOT_YET_CAPTURED_IMPL,
} from './vocabulary';
import { CONSOLE_TOGGLE_KEY as CONSOLE_TOGGLE_KEY_IMPL, createConsoleSession as createConsoleSessionImpl } from './console';

export const GAME_COMMANDS = Object.freeze({
  createRegistry: createCommandRegistry,
  tokenize: tokenizeCommandLine,
  parseValue: parseCommandValue,
  createGameState: createGameCommandStateImpl,
  defineGameCommands: defineGameCommandsImpl,
  createConsoleSession: createConsoleSessionImpl,
  consoleToggleKey: CONSOLE_TOGGLE_KEY_IMPL,
  tuning: COMMAND_TUNING_IMPL,
  names: GAME_COMMAND_NAMES_IMPL,
  notYetCaptured: NOT_YET_CAPTURED_IMPL,
});
