// compile/worldTicker behavior tests (P4) — the TICKER lump (req_0893 #3):
// records derive from placed ledTicker pieces (the message → column bitmasks),
// the wire round-trips byte-exact, and the layout matches what constructor.zig
// decodeTickers reads. Runs under tools/v8cli via `rjit game verify`.

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { decodeTickers, encodeTickers, tickerRecords, TICKER_LUMP_VERSION } from './worldTicker';
import type { PlacedBuildPiece } from '@game';

const TICKER_ID = 'prop.ledTicker';

let nextId = 0;
function ticker(text: string | undefined): PlacedBuildPiece {
  nextId += 1;
  return { id: `tk_${nextId}`, pieceId: TICKER_ID, x: 2, y: 3, z: 4, yawDegrees: 90, text };
}

test('records derive only from ledTicker pieces; the message becomes lit columns', () => {
  const pieces = [
    ticker('HI'),
    { id: 'rock1', pieceId: 'prop.rock', x: 0, y: 0, z: 0, yawDegrees: 0 } as PlacedBuildPiece,
  ];
  const records = tickerRecords(pieces);
  assertEqual(records.length, 1, 'one record — the rock is not a ticker');
  const r = records[0];
  assertEqual(r.rows, 7, 'the dot-matrix is 7 rows tall');
  assert(r.windowCols > 0, 'a visible window');
  assert(r.columns.length > 0, 'the message lowered to columns');
  // "HI" = 2 glyphs × (5 cols + 1 spacer) = 12, plus the 4-col loop pad.
  assertEqual(r.columns.length, 2 * 6 + 4, 'HI is 12 columns + a 4-column loop gap');
  assert(r.columns.some((m) => m !== 0), 'some columns are lit');
});

test('the wire round-trips value-exact at f32 precision (the constructor.zig reference)', () => {
  const records = tickerRecords([ticker('GO 24/7')]);
  const bytes = encodeTickers(records);
  const back = decodeTickers(bytes);
  assertEqual(back.version, TICKER_LUMP_VERSION, 'version survives');
  assertEqual(back.records.length, 1, 'one record back');
  const a = records[0];
  const b = back.records[0];
  assertEqual(b.columns.join(','), a.columns.join(','), 'columns survive byte-exact');
  assertEqual(b.windowCols, a.windowCols, 'windowCols survives');
  assertEqual(b.rows, a.rows, 'rows survive');
  assertEqual(Math.fround(a.scrollColsPerSec), b.scrollColsPerSec, 'speed round-trips at f32');
  assertEqual(Math.fround(a.faceTopMeters), b.faceTopMeters, 'faceTop round-trips at f32');
  assertEqual(Math.fround(a.x), b.x, 'anchor x round-trips at f32');
  const empty = decodeTickers(encodeTickers([]));
  assertEqual(empty.records.length, 0, 'a ticker-free map encodes an empty lump');
});

finish('compile-ticker');
