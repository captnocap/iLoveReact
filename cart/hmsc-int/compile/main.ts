// compile/main.ts — the headless game boot (V19: the compile is always green
// and LLM-callable).
//
// `rjit game compile` bundles THIS file into zig-out/game/hmsc-headless.js;
// `rjit game verify` boots it under tools/v8cli with a verify script and reads
// the verdict. The contract, from day one and forever:
//
//   compile → boot headless → replay a command sequence → exit with a verdict
//
// A verify script is a recorded command sequence (compile/verify/*.cmds) —
// game/commands is the scripting surface, so "what I typed in the console" and
// "what the verify bot replays" are one language (V19's explicit green).
//
// MILESTONE-0: the compiled game is nearly empty — a state skeleton whose tick
// is the V8 reconciliation tick counter. It grows as captures land (V15: hmsc
// the game becomes THIS output; the boot will load data/snapshots/, V20). The
// green light exists now so it never goes dark.

import { openStreamStore } from '../data';
import { GAME_COMMANDS, GAME_LOOP, GAME_PATHING, GAME_PHYSICS, type GameCommandState } from '../game';
import { createInitialGameState } from '../state/gameState';
import { createHmscMapfile, factsFromGameState, factsFromMapfile } from '../packageMap';

declare const globalThis: any;

/**
 * The headless game state: the captured command state (the console vocabulary
 * mutates it — game/commands/vocabulary.ts, via the GAME_COMMANDS door) plus
 * the boot-local fields. Grows with the captures; never logic, only state.
 */
type HeadlessGame = ReturnType<typeof GAME_COMMANDS.createGameState> & {
  booted: boolean;
  /** the V8 state-tick counter (~45/min in real time; replay runs it hot) */
  tick: number;
};

type SavedCommandState = GameCommandState | null;
type CommandSaveEvent = { type: 'saved'; state: GameCommandState };

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function buildRegistry() {
  const registry = GAME_COMMANDS.createRegistry<HeadlessGame>();

  // The captured hmsc console vocabulary — all 48 names. Captured commands run
  // for real against the command state; not-yet commands fail loudly with
  // their owning capture lane (V19: the language is complete before the world).
  GAME_COMMANDS.defineGameCommands(registry);

  registry.define({
    name: 'boot',
    usage: 'boot',
    summary: 'boot the game world (milestone-0: the empty state skeleton)',
    run: (game) => {
      if (game.booted) throw new Error('already booted');
      game.booted = true;
      return [
        `booted (state tick cadence ${GAME_LOOP.STATE_TICKS_PER_MINUTE}/min)`,
        `host physics: ${GAME_PHYSICS.hostReady() ? 'live' : 'absent (headless ok)'}`,
        `host pathing: ${GAME_PATHING.hostReady() ? 'live' : 'absent (headless ok)'}`,
      ];
    },
  });

  registry.define({
    name: 'tick',
    usage: 'tick <count>',
    summary: 'advance the game-state tick (V8: the reconciliation cadence)',
    run: (game, args) => {
      if (!game.booted) throw new Error('tick before boot');
      const count = Math.floor(Number(args[0] ?? 1));
      if (!Number.isFinite(count) || count <= 0) throw new Error('count must be a positive number');
      for (let i = 0; i < count; i += 1) {
        game.tick += 1;
        // V8: each tick drains scheduled invalidations + verifies state-vs-plan
        // alignment. Nothing is scheduled in the empty world yet — the drain
        // grows here as systems land behind the GAME_* doors.
      }
      return [`tick=${game.tick}`];
    },
  });

  registry.define({
    name: 'status',
    usage: 'status',
    summary: 'one-line world status',
    run: (game) => [
      `booted=${game.booted ? 1 : 0} tick=${game.tick} events=${game.events.recent.length} entities=${Object.keys(game.world.spawnedEntities).length}`,
    ],
  });

  registry.define({
    name: 'map_roundtrip',
    usage: 'map_roundtrip',
    summary: 'compile the boot world to mapfile and assert equivalent facts',
    run: () => {
      const bootState = createInitialGameState();
      const bootFacts = factsFromGameState(bootState);
      const mapFacts = factsFromMapfile(createHmscMapfile(bootState));
      const bootJson = canonicalJson(bootFacts);
      const mapJson = canonicalJson(mapFacts);
      if (bootJson !== mapJson) {
        throw new Error(`mapfile facts differ boot=${bootJson} map=${mapJson}`);
      }
      return [
        `map_roundtrip session=${mapFacts.sessionName} layout=${mapFacts.layoutKey}`,
        `map_roundtrip counts regions=${mapFacts.surfaceRegions} placed=${mapFacts.placedCells} props=${mapFacts.props} zones=${mapFacts.zones.length}`,
        `map_roundtrip samples tiles=${mapFacts.tileSamples.join(',')} heights=${mapFacts.heightSamples.join(',')}`,
      ];
    },
  });

  // `help` is the vocabulary's now (defineGameCommands registers the bare
  // name, generated from the registry — it lists boot/tick/status too). The
  // boot's local copy collided once the player-facing alias landed; deleted,
  // never forked (no-duplication).

  return registry;
}

function readScriptLines(path: string): string[] | null {
  const read = globalThis.__fs_read;
  if (typeof read !== 'function') return null;
  const text = read(path);
  return typeof text === 'string' ? text.split('\n') : null;
}

function mountPersistence(game: HeadlessGame): void {
  const store = openStreamStore('zig-out/game/headless-data', 'commands');
  const stream = store.defineStream<SavedCommandState, CommandSaveEvent>({
    name: 'commands',
    initial: () => null,
    apply: (_state, event) => event.type === 'saved' ? event.state : _state,
  });

  game.__commandPersistence = {
    save: (state) => {
      const pos = stream.append({ type: 'saved', state });
      const written = store.materializeSnapshots();
      return [`saved game state seq=${pos.globalSeq}`, `snapshots=${written.length}`];
    },
    load: () => {
      const snapshot = store.loadSnapshot<SavedCommandState>('commands');
      return snapshot ? snapshot.state : stream.state();
    },
  };
}

function main(): number {
  const scriptPath = (globalThis.process?.argv ?? [])[1];
  if (!scriptPath) {
    console.error('usage: v8cli zig-out/game/hmsc-headless.js <verify-script.cmds>');
    return 2;
  }
  const lines = readScriptLines(scriptPath);
  if (!lines) {
    console.error(`VERDICT RED — cannot read verify script: ${scriptPath}`);
    return 1;
  }

  const game: HeadlessGame = { ...GAME_COMMANDS.createGameState(), booted: false, tick: 0 };
  mountPersistence(game);
  const registry = buildRegistry();
  const result = registry.runScript(game, lines);
  for (const line of result.transcript) console.log(line);

  if (!result.ok) {
    console.error(`VERDICT RED — ${scriptPath}: failed after ${result.commandsRun} command(s) at tick ${game.tick}`);
    return 1;
  }
  console.log(`VERDICT GREEN — ${scriptPath}: ${result.commandsRun} command(s), survived ${game.tick} tick(s)`);
  return 0;
}

const code = main();
const exit = globalThis.__exit;
if (typeof exit === 'function') exit(code);
