// editors/workbench/logs/logs.test.ts — P4 behavior suite for the LOGS
// WorkbenchSource (WBSET9-0606): the /log churn semantics carried whole
// (key-only filter, tag colors, pause/clear verbs, tail order) + the
// /settings session-bus semantics carried whole (newest-first by global
// seq, per-channel filtering, store-unavailable surfacing) + the new
// stream machinery (lenses, dashboard stats, select/copy text).
//
//   tools/esbuild cart/hmsc-int/editors/workbench/logs/logs.test.ts \
//     --bundle --outfile=zig-out/game/tests/wb_logs.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime \
//     --alias:@game=cart/hmsc-int/game
//   tools/v8cli zig-out/game/tests/wb_logs.test.js
//
// Headless per the characters.test.ts bundling law: store.ts/panel.ts/
// churn.ts only — a fake ring + fake SessionsState stand in for perfLog and
// the V20 wires.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import type { SessionsState } from '../../sessions';
import { isKeyLine, lineColor, lineStamp, tagOf } from './churn';
import { BUS_ID, CHURN_ID, createLogsStore, sparkBuckets, type LogsStore } from './store';
import { logsActions, logsLenses, logsPanel, logsRoster } from './panel';

const LINES = [
  '==== hmsc-int diagnostics churn channel - session start ====',
  '[10.0 +0.0] stroke: verdict ✓ 12 dabs',
  '[12.5 +2.5] render: PaintCanvas #3 (no watched change — parent re-rendered)',
  '[14.0 +1.5] regionSync: schedule chunk 2,3',
  '[16.0 +2.0] regionSync: FIRE 4 chunks',
  '[18.0 +2.0] landforms: rebuilt=1 reused=7 ⚠ 372ms',
];

function fakeBus(): SessionsState {
  const mk = (seq: number, label: string, at: number | null = seq) => ({ seq, label, at });
  return {
    sessions: {
      a: { id: 'a', route: '/characters', channel: 'characters', closedSeq: null, commits: [mk(2, 'autosave · gru'), mk(11, 'gru: saved')] },
      b: { id: 'b', route: '/settings', channel: 'tuning', closedSeq: 9, commits: [mk(6, 'paint.brush → 12')] },
    } as any,
    order: ['a', 'b'],
  } as SessionsState;
}

function fixture(bus: SessionsState | null = fakeBus(), busError: string | null = null): { store: LogsStore; ring: { lines: string[]; on: boolean; cleared: number } } {
  const ring = { lines: LINES.slice(), on: true, cleared: 0 };
  const store = createLogsStore({
    ring: {
      lines: () => ring.lines,
      enabled: () => ring.on,
      setEnabled: (v) => { ring.on = v; },
      clear: () => { ring.cleared += 1; ring.lines.length = 0; },
      path: () => '/tmp/hmsc-int-diagnostics.jsonl',
      subscribe: () => () => {},
    },
    bus: () => bus,
    busError,
  });
  return { store, ring };
}

// ── the churn feed (the /log fold) ───────────────────────────────────────────

test('the /log classification carried whole: tag pull, key rule, line colors', () => {
  assertEqual(tagOf('[1.0 +0.0] stroke: hi'), 'stroke', 'tag pulled from the stamp shape');
  assertEqual(tagOf('plain text'), '', 'no stamp → no tag');
  assert(isKeyLine('[1.0 +0.0] stroke: x'), 'stroke is a key tag');
  assert(isKeyLine('[1.0 +0.0] regionSync: FIRE now'), 'regionSync keeps FIRE');
  assert(!isKeyLine('[1.0 +0.0] regionSync: schedule'), 'regionSync drops schedule/coalesce');
  assert(!isKeyLine('[1.0 +0.0] render: churn'), 'render is per-render noise');
  assertEqual(lineColor('[1.0 +0.0] x: ⚠ bad'), '#fca5a5', 'warning red beats the tag map');
  assertEqual(lineColor('[1.0 +0.0] x: done ✓'), '#86efac', 'success green');
  assertEqual(lineColor('==== header ===='), '#64748b', 'session header dim');
  assertEqual(lineColor('[1.0 +0.0] landforms: y'), '#fbbf24', 'tag map color');
  assertEqual(JSON.stringify(lineStamp('[16.0 +2.0] regionSync: FIRE')), JSON.stringify({ time: '16.0', rest: 'regionSync: FIRE' }), 'the stamp splits for the time cell');
});

test('churn KEY lens keeps the signal lines; ALL keeps everything; newest first', () => {
  const { store } = fixture();
  const key = store.rowsFor(CHURN_ID, 'key', 100);
  assertEqual(key.length, 3, 'stroke + regionSync FIRE + landforms survive the key filter');
  assertEqual(key[0].channel, 'landforms', 'newest first (tail view)');
  assertEqual(key[1].channel, 'regionSync', 'the FIRE line kept');
  assertEqual(key[2].channel, 'stroke', 'oldest last');
  const all = store.rowsFor(CHURN_ID, 'all', 100);
  assertEqual(all.length, LINES.length, 'ALL widens to every line');
  assertEqual(all[0].text.includes('rebuilt=1'), true, 'the newest raw line leads');
  assertEqual(all[0].copy, LINES[LINES.length - 1], 'copy carries the raw line');
  assertEqual(store.rowsFor(CHURN_ID, 'all', 2).length, 2, 'row cap honored');
});

test('the churn verbs: pause/resume flips the diagnostics channel, clear wipes (census C4/C5)', () => {
  const { store, ring } = fixture();
  const actions = logsActions(store, CHURN_ID);
  assertEqual(actions.map((a) => a.label).join(','), 'pause,clear', 'logging on → pause + clear');
  actions[0].run();
  assert(!ring.on, 'pause flipped the channel off');
  assertEqual(logsActions(store, CHURN_ID)[0].label, 'resume', 'label follows state');
  logsActions(store, CHURN_ID)[1].run();
  assertEqual(ring.cleared, 1, 'clear delegated to the ring');
  assertEqual(logsActions(store, BUS_ID).length, 0, 'bus feeds have no destructive verbs');
});

// ── the session bus feeds (the /settings fold) ──────────────────────────────

test('the roster: churn + session bus + one row per live channel', () => {
  const { store } = fixture();
  const rows = logsRoster(store);
  assertEqual(rows.map((r) => r.id).join(','), 'churn,bus,bus:characters,bus:tuning', 'fixed feeds first, channels after');
  assertEqual(rows[0].label, 'churn (ring)', 'churn labeled');
  assertEqual(rows[1].label, 'session bus', 'the bus overview labeled');
  assertEqual(rows[2].label, 'characters', 'channel rows wear the channel name');
});

test('bus rows: newest first by global seq; a channel row filters; ALL widens (LAW 2)', () => {
  const { store } = fixture();
  const all = store.rowsFor(BUS_ID, 'all', 100);
  assertEqual(all.map((r) => r.time).join(','), '#11,#6,#2', 'the global sequence, newest first');
  const ch = store.rowsFor('bus:characters', 'channel', 100);
  assertEqual(ch.length, 2, 'the channel lens filters');
  assertEqual(ch[0].channel, 'characters', 'rows wear their channel');
  const widened = store.rowsFor('bus:characters', 'all', 100);
  assertEqual(widened.length, 3, 'the ALL lens widens a channel row to the whole bus');
  assertEqual(widened[1].copy, '#6 [tuning] /settings paint.brush → 12', 'copy carries seq+channel+route+label');
});

test('lenses per feed: churn KEY⇄ALL, bus single, channel CHANNEL⇄ALL', () => {
  assertEqual(logsLenses(CHURN_ID).map((l) => l.id).join(','), 'key,all', 'the /log key-only toggle is a lens');
  assertEqual(logsLenses(BUS_ID).length, 1, 'the bus overview IS all — no segment shown');
  assertEqual(logsLenses('bus:tuning').map((l) => l.label).join(','), 'TUNING,ALL', 'channel lens leads (the focused default)');
});

test('the dashboard band reads true: ring count + logging state, per-channel commits, live sparks', () => {
  const { store, ring } = fixture();
  const stats = store.stats();
  assertEqual(stats.map((s) => s.label).join(','), 'churn,characters,tuning', 'one card per feed');
  assertEqual(stats[0].big, `${LINES.length}`, 'churn card counts the ring');
  assertEqual(stats[0].sub, 'logging', 'state in the sub line');
  ring.on = false;
  assertEqual(store.stats()[0].sub, 'paused', 'state flips live');
  assertEqual(stats[1].big, '2', 'characters card counts its commits');
  assert(stats[1].sub.includes('1 open'), 'open sessions surface');
  assertEqual(stats[1].spark.length, 12, 'a 12-bin spark');
  assert(stats[1].spark.some((h) => h > 0), 'activity registers');
  assertEqual(JSON.stringify(sparkBuckets([], 0, 1)), JSON.stringify(new Array(12).fill(0)), 'no samples → a flat spark, never NaN');
});

test('select/copy: the selection joins copy text in displayed order', () => {
  const { store } = fixture();
  const rows = store.rowsFor(BUS_ID, 'all', 100);
  const picked = new Set([rows[0].key, rows[2].key]);
  assertEqual(
    store.copyText(rows, picked),
    '#11 [characters] /characters gru: saved\n#2 [characters] /characters autosave · gru',
    'newest-first order kept, unselected rows skipped',
  );
  assertEqual(store.copyText(rows, new Set()), '', 'empty selection → empty text');
});

test('the panel carries properties, never stats; a down store is namable (census C3)', () => {
  const { store } = fixture();
  const churnPanel = logsPanel(store, CHURN_ID);
  const fields = churnPanel.groups[0].fields as any[];
  assertEqual(fields.find((f) => f.k === 'file').get(), '/tmp/hmsc-int-diagnostics.jsonl', 'the on-disk path (the route header parity)');
  assertEqual(fields.find((f) => f.k === 'state').get(), 'logging', 'feed state');
  const chPanel = logsPanel(store, 'bus:characters');
  assertEqual((chPanel.groups[0].fields as any[]).find((f) => f.k === 'routes').get(), '/characters', 'routes fold per channel');
  const { store: down } = fixture(null, 'corrupt record at sessions.jsonl:884');
  assertEqual(logsRoster(down).map((r) => r.id).join(','), 'churn,bus', 'no bus → fixed feeds only, churn fully live');
  assertEqual(down.rowsFor(BUS_ID, 'all', 10).length, 0, 'a down bus streams nothing, never throws');
  assert(((logsPanel(down, BUS_ID).groups[0].fields as any[]).find((f) => f.k === 'store').get() as string).includes('unavailable'), 'the store-unavailable warning surfaces');
});

finish('workbench/logs');
