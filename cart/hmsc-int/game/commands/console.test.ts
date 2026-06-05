// console.test.ts — P4 behavior tests for the in-game console SESSION.
//
// The contract under test is the CS-console input discipline over the V19
// scripting surface: toggle state, the toggle-key-never-leaks rule, line →
// registry dispatch with verbatim transcript, input gating (open consumes
// everything), history, and the transcript ring cap. The overlay that draws
// a session is route chrome — the user's re-test owns the visuals.

import { GAME_COMMANDS, type CommandRegistry } from './index';
import {
  CONSOLE_CLOSE_KEYS,
  CONSOLE_TOGGLE_KEY,
  createConsoleSession,
  type ConsoleSession,
} from './console';
import { createGameCommandState, defineGameCommands, type GameCommandState } from './vocabulary';
import { assert, assertEqual, finish, test } from '../_testkit';

function freshSession(opts?: Parameters<typeof createConsoleSession>[2]): {
  session: ConsoleSession;
  game: GameCommandState;
  registry: CommandRegistry<GameCommandState>;
} {
  const registry = GAME_COMMANDS.createRegistry<GameCommandState>();
  defineGameCommands(registry);
  const game = createGameCommandState();
  return { session: createConsoleSession(registry, game, opts), game, registry };
}

function type(session: ConsoleSession, text: string): void {
  for (const ch of text) {
    if (ch === ' ') session.handleKey({ key: 'space' });
    else session.handleKey({ key: ch });
  }
}

/** One PHYSICAL toggle press: keydown + keyup (re-arms the edge). */
function pressToggle(session: ConsoleSession): boolean {
  const consumed = session.handleKey({ key: CONSOLE_TOGGLE_KEY });
  session.handleKeyUp({ key: CONSOLE_TOGGLE_KEY });
  return consumed;
}

test('closed by default; only the toggle key is consumed while closed', () => {
  const { session } = freshSession();
  assertEqual(session.isOpen(), false, 'starts closed');
  assertEqual(session.handleKey({ key: 'w' }), false, 'movement keys pass through while closed');
  assertEqual(session.handleKey({ key: 'space' }), false, 'jump passes through while closed');
  assertEqual(session.isOpen(), false, 'still closed');
  assertEqual(pressToggle(session), true, 'the toggle is consumed');
  assertEqual(session.isOpen(), true, 'open after toggle');
});

test('the toggle is EDGE-triggered: held/repeated keydowns flip exactly once (the "opens twice" verdict)', () => {
  const { session } = freshSession();
  // The engine bus delivers SDL key repeats as fresh keydowns — a held
  // backtick must NOT flip the console again until its keyup re-arms it.
  session.handleKey({ key: CONSOLE_TOGGLE_KEY });
  session.handleKey({ key: CONSOLE_TOGGLE_KEY }); // repeat, no keyup between
  session.handleKey({ key: CONSOLE_TOGGLE_KEY }); // repeat
  assertEqual(session.isOpen(), true, 'three keydowns without keyup = ONE flip (open)');
  assertEqual(session.buffer(), '', 'repeats never leak into the buffer');
  session.handleKeyUp({ key: CONSOLE_TOGGLE_KEY });
  session.handleKey({ key: CONSOLE_TOGGLE_KEY });
  session.handleKey({ key: CONSOLE_TOGGLE_KEY }); // repeat again
  assertEqual(session.isOpen(), false, 'after keyup, the next press flips once (closed)');
  session.handleKeyUp({ key: CONSOLE_TOGGLE_KEY });
  assertEqual(session.handleKey({ key: '~' }), true, 'the ~ alias is a toggle too');
  assertEqual(session.isOpen(), true, 'tilde opens');
  session.handleKeyUp({ key: '~' });
});

test('the toggle key NEVER lands in the line buffer (open or close)', () => {
  const { session } = freshSession();
  pressToggle(session);
  assertEqual(session.buffer(), '', 'opening leaks no backtick');
  type(session, 'pv_where');
  pressToggle(session);
  assertEqual(session.isOpen(), false, 'backtick mid-line closes');
  pressToggle(session);
  assertEqual(session.buffer(), 'pv_where', 'the buffer survives a close/reopen with no extra backtick');
});

test('escape closes and returns input to the game', () => {
  const { session } = freshSession();
  pressToggle(session);
  assert(CONSOLE_CLOSE_KEYS.includes('escape'), 'escape is a ruled close key');
  assertEqual(session.handleKey({ key: 'escape' }), true, 'escape is consumed');
  assertEqual(session.isOpen(), false, 'closed by escape');
  assertEqual(session.handleKey({ key: 'w' }), false, 'movement keys flow again after close');
});

test('while open EVERY key is consumed — typed characters go only to the console', () => {
  const { session } = freshSession();
  pressToggle(session);
  for (const key of ['w', 'a', 's', 'd', 'space', 'f1', 'up', 'down']) {
    assertEqual(session.handleKey({ key }), true, `'${key}' must be consumed while open`);
  }
});

test('enter dispatches through the captured registry; output lands verbatim', () => {
  const { session, game } = freshSession();
  game.player.position = { x: 12, y: 1.5, z: -7 };
  pressToggle(session);
  type(session, 'pv_where');
  session.handleKey({ key: 'return' });
  const lines = session.transcript();
  assertEqual(lines[0].kind, 'input', 'first line echoes the input');
  assertEqual(lines[0].text, '> pv_where', 'echo carries the prompt marker');
  assert(lines.length > 1, 'the command produced output');
  assert(
    lines.some((l) => l.kind === 'output' && l.text.includes('12')),
    `pv_where output shows the position (got: ${lines.map((l) => l.text).join(' | ')})`,
  );
  assertEqual(session.buffer(), '', 'the buffer clears after submit');
});

test('a failing command lands as error lines, exactly what the vocabulary said', () => {
  const { session } = freshSession();
  session.submit('no_such_command');
  const lines = session.transcript();
  assertEqual(lines[1].kind, 'error', 'failure output is marked error');
  assert(lines[1].text.includes('unknown command'), 'the registry error text is verbatim');
});

test('shift reconstruction + space wire-name typing builds real command lines', () => {
  const { session } = freshSession();
  pressToggle(session);
  type(session, 'gv_state player.position');
  assertEqual(session.buffer(), 'gv_state player.position', 'dots/underscores/spaces type clean');
  session.handleKey({ key: 'backspace' });
  assertEqual(session.buffer(), 'gv_state player.positio', 'backspace edits the tail');
  session.handleKey({ key: '1', shiftKey: true });
  assertEqual(session.buffer(), 'gv_state player.positio!', 'US shift table reconstructs symbols');
});

test('history: up recalls, down returns to the live buffer', () => {
  const { session } = freshSession();
  pressToggle(session);
  type(session, 'cmd_help');
  session.handleKey({ key: 'return' });
  type(session, 'pv_where');
  session.handleKey({ key: 'return' });
  session.handleKey({ key: 'up' });
  assertEqual(session.buffer(), 'pv_where', 'up recalls the last submit');
  session.handleKey({ key: 'up' });
  assertEqual(session.buffer(), 'cmd_help', 'up again walks back');
  session.handleKey({ key: 'down' });
  session.handleKey({ key: 'down' });
  assertEqual(session.buffer(), '', 'down past the newest returns to the live (empty) buffer');
});

test('beforeRun/afterRun bracket each dispatch (the live-game sync seam)', () => {
  const order: string[] = [];
  const { session } = freshSession({
    beforeRun: () => order.push('before'),
    afterRun: () => order.push('after'),
  });
  session.submit('cmd_help');
  assertEqual(order.join(','), 'before,after', 'hooks run around the registry call');
});

test('the transcript is a ring — old lines fall off at the cap', () => {
  const { session } = freshSession({ maxTranscriptLines: 8 });
  for (let i = 0; i < 10; i += 1) session.submit(`gv_state config.sky.hour`);
  const lines = session.transcript();
  assert(lines.length <= 8, `capped at 8 (got ${lines.length})`);
  const ids = lines.map((l) => l.id);
  assert(ids[0] > 1, 'the earliest lines were dropped, not the newest');
});

test('empty/whitespace submits are no-ops (no transcript noise)', () => {
  const { session } = freshSession();
  session.submit('   ');
  assertEqual(session.transcript().length, 0, 'nothing echoed');
});

finish('game/commands/console');
