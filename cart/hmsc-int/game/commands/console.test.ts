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

function installColonDiagnostics(game: GameCommandState): { nodes: any[]; highlighted: number[] } {
  const nodes: any[] = [
    {
      id: 0, type: 'Root', computed: { x: 0, y: 0, w: 800, h: 600 }, style: { backgroundColor: '#000000' }, props: {},
      children: [],
    },
    {
      id: 1, type: 'Box', computed: { x: 10, y: 20, w: 120, h: 40 }, style: { width: 120, backgroundColor: '#111111' }, props: { label: 'panel' },
      hasHandlers: true, children: [],
    },
    {
      id: 2, type: 'Text', computed: { x: 12, y: 22, w: 80, h: 18 }, style: { color: '#ffffff' }, props: { text: 'hello console' },
      children: [],
    },
  ];
  nodes[0].children = [nodes[1], nodes[2]];
  const highlighted: number[] = [];
  game.__consoleDiagnostics = {
    tree: {
      getTree: () => nodes[0],
      getNodes: () => nodes,
      setStyle: (id, prop, value) => { nodes[id].style[prop] = value; },
      markDirty: () => { nodes[0].dirty = true; },
      highlight: (id) => { highlighted.push(id); },
    },
    inspector: { getPerfData: () => ({ fps: 60, layoutMs: 1.25, paintMs: 2.5, nodeCount: nodes.length }) },
    lua: { eval: (code) => (code === '1 + 2' ? 3 : code) },
    env: { bridge: 'QuickJS (native)', mode: 'test', loveVersion: '11.5', window: { width: 800, height: 600 }, historyCount: 7 },
  };
  return { nodes, highlighted };
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

test('suppressTranscript commands run without drawing input or output', () => {
  const { session, registry } = freshSession();
  registry.define({
    name: 'diag_silent',
    usage: 'diag_silent',
    summary: 'diagnostic self-noise guard',
    run: () => ({ suppressTranscript: true, output: ['terminal-only diagnostic detail'] }),
  });
  session.submit('diag_silent');
  assertEqual(session.transcript().length, 0, 'diagnostic commands can avoid console text churn');
});

test('help produces the FULL registered inventory, generated from the registry, not-yet stubs marked (USER BUG: bare help did not exist)', () => {
  const { session, registry } = freshSession();
  session.submit('help');
  const lines = session.transcript();
  const output = lines.filter((l) => l.kind === 'output');
  const specs = registry.list();
  assertEqual(output.length, specs.length, `help lists every registered command (${specs.length})`);
  for (const spec of specs) {
    assert(
      output.some((l) => l.text.startsWith(spec.usage)),
      `help carries the usage line for ${spec.name}`,
    );
  }
  const pending = GAME_COMMANDS.notYetCaptured;
  for (const name of Object.values(pending).flat()) {
    const line = output.find((l) => l.text.startsWith(name)); // usage lines start with the name
    assert(line != null && line.text.includes('[not yet]'), `${name} must be marked [not yet] in help`);
  }
  assert(
    output.some((l) => !l.text.includes('[not yet]')),
    'captured commands are NOT marked',
  );
});

test('help <command> teaches usage; a pending command names its owning lane', () => {
  const { session } = freshSession();
  session.submit('help wv_road');
  const lines = session.transcript().map((l) => l.text);
  assert(lines.some((t) => t.startsWith('usage: wv_road')), 'usage line prints');
  assert(lines.some((t) => t.includes('not captured yet')), 'pending status names the capture boundary');
});

test('unknown command suggests help — and help now EXISTS (the self-recommending error is fixed)', () => {
  const { session, registry, game } = freshSession();
  session.submit('frobnicate');
  const error = session.transcript().find((l) => l.kind === 'error');
  assert(error != null && error.text.includes('help'), 'the error points at help');
  assertEqual(registry.run(game, 'help').ok, true, 'and help actually runs');
});

test('CONPORT-B watch/unwatch/watches are live console-session verbs', () => {
  const { session } = freshSession();
  session.submit(':watch 1 + 2');
  session.submit(':watch lua 1 + 2');
  session.update(0.5);
  session.submit(':watches');
  const text = session.transcript().map((l) => l.text).join('\n');
  assert(text.includes('Watch #1 (JS): 1 + 2'), 'JS watch announces its expression');
  assert(text.includes('Watch #2 (Lua): 1 + 2'), 'Lua watch announces its expression');
  assert(text.includes('[1] (js) 1 + 2 = 3'), 'JS watch evaluates live');
  assert(text.includes('[2] (lua) 1 + 2 = n/a'), 'Lua watch stays explicit when no Lua bridge is mounted');
  assertEqual(session.watches().length, 2, 'both watches are tracked for the overlay');
  session.submit(':unwatch 1');
  assertEqual(session.watches().length, 1, 'unwatch removes by 1-based index');
  assert(session.transcript().some((l) => l.text === 'Removed watch #1: 1 + 2'), 'unwatch names the removed expression');
});

test('CONPORT-B record/stop/play/macros replay through the real console submit path', () => {
  const { session, game } = freshSession();
  session.submit(':macros');
  assert(session.transcript().some((l) => l.text.includes('No macros saved')), 'bare macro list teaches record');
  session.submit(':record warp');
  session.submit('pv_teleport 2 3 4');
  session.submit(':stop');
  assert(session.transcript().some((l) => l.text === "Saved macro 'warp' (1 commands)"), 'stop saves the recorded command count');
  session.submit(':macros');
  assert(session.transcript().some((l) => l.text === '  warp (1 commands)'), 'macros lists the saved macro');
  game.player.position = { x: 0, y: 0, z: 0 };
  session.submit(':play warp');
  assertEqual(game.player.position.x, 2, 'play re-dispatches the recorded teleport command');
  assertEqual(game.player.position.z, 3, 'recorded z lands');
  assertEqual(game.player.position.y, 4, 'recorded y lands');
});

test('CONPORT-B template/templates print the reference boilerplate inventory', () => {
  const { session } = freshSession();
  session.submit(':templates');
  let text = session.transcript().map((l) => l.text).join('\n');
  assert(text.includes('Available templates:'), 'templates prints a heading');
  assert(text.includes('  box          Basic Box component'), 'templates uses padded sorted rows');
  assert(text.includes('Use :template <name> to view code'), 'templates teaches the detail command');
  session.submit(':template box');
  text = session.transcript().map((l) => l.text).join('\n');
  assert(text.includes('Basic Box component:'), 'template prints the template description');
  assert(text.includes("  <Box style={{ width: '100%', height: '100%', backgroundColor: '#1e1e2e' }}>"), 'template prints indented code lines');
  session.submit(':template no_such_template');
  text = session.transcript().map((l) => l.text).join('\n');
  assert(text.includes('Unknown template: no_such_template'), 'unknown templates fail loud');
  assert(text.includes('Available: box, card, catppuccin, flexrow, grid, pressable, scrollview'), 'unknown template prints sorted choices');
});

test('PageUp/PageDown scroll the transcript; a submit snaps back to the tail', () => {
  const { session } = freshSession();
  pressToggle(session);
  session.submit('help'); // ~50 lines — taller than any overlay
  const tailBefore = session.visibleTail(5).map((l) => l.id).join(',');
  assertEqual(session.scrollOffset(), 0, 'starts at the live tail');
  session.handleKey({ key: 'pageup' });
  assert(session.scrollOffset() > 0, 'PageUp scrolls back');
  const scrolled = session.visibleTail(5).map((l) => l.id).join(',');
  assert(scrolled !== tailBefore, 'the visible window moved');
  session.handleKey({ key: 'pagedown' });
  assertEqual(session.scrollOffset(), 0, 'PageDown returns to the tail');
  session.handleKey({ key: 'pageup' });
  session.submit('pv_where');
  assertEqual(session.scrollOffset(), 0, 'a submit snaps the view back');
  // clamp: spamming PageUp never scrolls past the oldest line
  for (let i = 0; i < 50; i += 1) session.handleKey({ key: 'pageup' });
  assert(session.scrollOffset() < session.transcript().length, 'scrollback clamps inside the transcript');
  assert(session.visibleTail(5).length > 0, 'the view never goes empty');
});

test('part-A colon console diagnostics run through the live session surface', () => {
  const { session, game } = freshSession({ maxTranscriptLines: 160 });
  const diag = installColonDiagnostics(game);

  session.submit(':help');
  assert(session.transcript().some((l) => l.text === 'Console commands:'), ':help prints the reference colon help');
  assert(session.transcript().some((l) => l.text.includes(':style <id> <prop> <val>')), ':help includes style semantics');

  session.submit(':tree');
  assert(session.transcript().some((l) => l.text.includes('Root: 800x600  |  3 nodes')), ':tree summarizes the root');

  session.submit(':nodes 1');
  assert(session.transcript().some((l) => l.text.includes('Box  #1')), ':nodes inspects by id');
  assert(session.transcript().some((l) => l.text.includes('style.width: 120')), ':nodes dumps styles');

  session.submit(':perf');
  assert(session.transcript().some((l) => l.text.includes('FPS: 60  |  Layout: 1.3ms')), ':perf reads inspector data');

  session.submit(':find type:Text');
  assert(session.transcript().some((l) => l.text.includes('Found 1 nodes matching')), ':find counts matches');
  assert(session.transcript().some((l) => l.text.includes('#2 Text')), ':find lists matched nodes');

  session.submit(':style 1 width 200');
  assertEqual(diag.nodes[1].style.width, 200, ':style mutates the node style');
  assertEqual(diag.nodes[0].dirty, true, ':style marks the tree dirty');
  assert(session.transcript().some((l) => l.text.includes('Set #1 style.width: 120 -> 200')), ':style reports old and new values');

  session.submit(':lua 1 + 2');
  assert(session.transcript().some((l) => l.text === '3'), ':lua prints evaluator result');

  session.submit(':dump 0');
  assert(session.transcript().some((l) => l.text.includes('Root #0  800x600')), ':dump prints the subtree root');
  assert(session.transcript().some((l) => l.text.includes('Text #2  80x18 "hello console"')), ':dump prints descendants');

  session.submit(':highlight 1');
  assertEqual(diag.highlighted[0], 1, ':highlight reaches the diagnostics hook');
  assert(session.transcript().some((l) => l.text.includes('Highlighting #1 for 1.5s')), ':highlight reports duration');

  session.submit(':measure hello 20');
  assert(session.transcript().some((l) => l.text.includes('Text: "hello" at 20px ->')), ':measure prints dimensions');

  session.submit(':env');
  assert(session.transcript().some((l) => l.text.includes('Bridge: QuickJS (native)')), ':env reports bridge');
  assert(session.transcript().some((l) => l.text.includes('Window: 800x600')), ':env reports window');

  session.submit(':log');
  assert(session.transcript().some((l) => l.text === 'Debug log channels:'), ':log lists channels');
  session.submit(':log frame on');
  assert(session.transcript().some((l) => l.text.includes('frame: ON')), ':log channel on works');
  session.submit(':log frame off');
  assert(session.transcript().some((l) => l.text.includes('frame: OFF')), ':log channel off works');
  session.submit(':log all');
  assert(session.transcript().some((l) => l.text.includes('All channels enabled')), ':log all enables');
  session.submit(':log none');
  assert(session.transcript().some((l) => l.text.includes('All channels disabled')), ':log none disables');

  session.submit(':clear');
  assertEqual(session.transcript().length, 0, ':clear clears the console transcript');
});

finish('game/commands/console');
