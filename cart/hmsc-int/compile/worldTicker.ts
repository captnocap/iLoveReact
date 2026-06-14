// worldTicker.ts — bake the LED TICKER boards (req_0893 #3) into the TICKER map
// lump so the compiled no-V8 game scrolls them, not just /test.
//
// THE GAP THIS FIXES: a ledTicker's HOUSING bakes through the normal prop path,
// but its lit face is ANIMATED — it can't ride the bake-once material pipeline.
// This lump ships the message (as per-column LED bitmasks, blockText.textColumns
// via ledTicker.tickerColumns) plus the board geometry, and world_loader.zig
// advances a scroll offset + draws the lit LEDs every frame — the same per-frame
// live-entity mechanism the elevator car uses (worldElevators.ts).
//
// All board DIMENSIONS are baked (the loader stays constant-free and can't drift
// from the editor's LedTicker.tsx, which reads the SAME ledTicker.ts source).

import { GAME_BUILD } from '@game';
import type { PlacedBuildPiece } from '@game';
import { hx } from '../game/kinds/propModels';
import {
  tickerColumns,
  LED_CELL_METERS,
  LED_DOT_SIZE_METERS,
  LED_WINDOW_COLS,
  LED_ROWS,
  LED_DEPTH_METERS,
  LED_FACE_INSET_METERS,
  LED_SCROLL_COLS_PER_SEC,
  LED_ON_COLOR,
  ledFaceWidthMeters,
  ledFaceHeightMeters,
  ledFaceCenterYMeters,
} from './propRecipes/ledTicker';

export const TICKER_LUMP_VERSION = 1;

export type TickerRecord = {
  /** world anchor (the prop's ground origin) + yaw */
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
  /** board geometry (anchor-local), baked so the loader needs no constants */
  cellMeters: number;
  dotSizeMeters: number;
  faceLeftMeters: number; // local x of the window's left edge
  faceTopMeters: number; // local y of the top row's top edge
  faceWidthMeters: number; // window width (for left/right clipping)
  faceZMeters: number; // local z the lit dots sit at
  /** lit LED color, 0..1 */
  colorR: number;
  colorG: number;
  colorB: number;
  scrollColsPerSec: number;
  windowCols: number;
  rows: number;
  /** the message as per-column lit-row bitmasks (GLYPH_ROWS bits each) */
  columns: number[];
};

/** Derive the TICKER records from placed pieces — every prop piece whose kind is
 *  ledTicker. The geometry mirrors ledTicker.ts (the editor's source), so the
 *  compiled board and /test's board are the same object. */
export function tickerRecords(pieces: readonly PlacedBuildPiece[]): TickerRecord[] {
  const color = hx(LED_ON_COLOR);
  const out: TickerRecord[] = [];
  for (const piece of pieces) {
    const def = GAME_BUILD.catalog.get(piece.pieceId);
    if (def.kind !== 'prop' || def.propKind !== 'ledTicker') continue;
    out.push({
      x: piece.x,
      y: piece.y,
      z: piece.z,
      yawDegrees: piece.yawDegrees,
      cellMeters: LED_CELL_METERS,
      dotSizeMeters: LED_DOT_SIZE_METERS,
      faceLeftMeters: -ledFaceWidthMeters / 2,
      faceTopMeters: ledFaceCenterYMeters + ledFaceHeightMeters / 2,
      faceWidthMeters: ledFaceWidthMeters,
      faceZMeters: LED_DEPTH_METERS / 2 + LED_FACE_INSET_METERS,
      colorR: color[0],
      colorG: color[1],
      colorB: color[2],
      scrollColsPerSec: LED_SCROLL_COLS_PER_SEC,
      windowCols: LED_WINDOW_COLS,
      rows: LED_ROWS,
      columns: tickerColumns(piece.text),
    });
  }
  return out;
}

/** Encode the TICKER lump.
 *
 *  Layout (version 1, little-endian):
 *    u32 version | u32 tickerCount
 *    per ticker:
 *      f32 x | f32 y | f32 z | f32 yawDegrees
 *      f32 cell | f32 dotSize | f32 faceLeft | f32 faceTop | f32 faceWidth | f32 faceZ
 *      f32 r | f32 g | f32 b | f32 scrollColsPerSec
 *      u32 windowCols | u32 rows | u32 colCount | u8[colCount] columns */
export function encodeTickers(records: readonly TickerRecord[]): Uint8Array {
  let bytes = 8;
  for (const r of records) bytes += 14 * 4 + 3 * 4 + r.columns.length;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, TICKER_LUMP_VERSION, true);
  view.setUint32(4, records.length, true);
  let at = 8;
  const f = (v: number) => { view.setFloat32(at, v, true); at += 4; };
  const u = (v: number) => { view.setUint32(at, v, true); at += 4; };
  for (const r of records) {
    f(r.x); f(r.y); f(r.z); f(r.yawDegrees);
    f(r.cellMeters); f(r.dotSizeMeters); f(r.faceLeftMeters); f(r.faceTopMeters); f(r.faceWidthMeters); f(r.faceZMeters);
    f(r.colorR); f(r.colorG); f(r.colorB); f(r.scrollColsPerSec);
    u(r.windowCols); u(r.rows); u(r.columns.length);
    for (const col of r.columns) { out[at] = col & 0xff; at += 1; }
  }
  return out;
}

/** Wire-format twin of encodeTickers — the round-trip test's reader and the
 *  reference for constructor.zig's TICKER decode. */
export function decodeTickers(bytes: Uint8Array): { version: number; records: TickerRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== TICKER_LUMP_VERSION) throw new Error(`unsupported ticker version ${version}`);
  const count = view.getUint32(4, true);
  let at = 8;
  const f = () => { const v = view.getFloat32(at, true); at += 4; return v; };
  const u = () => { const v = view.getUint32(at, true); at += 4; return v; };
  const records: TickerRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const r: TickerRecord = {
      x: f(), y: f(), z: f(), yawDegrees: f(),
      cellMeters: f(), dotSizeMeters: f(), faceLeftMeters: f(), faceTopMeters: f(), faceWidthMeters: f(), faceZMeters: f(),
      colorR: f(), colorG: f(), colorB: f(), scrollColsPerSec: f(),
      windowCols: u(), rows: u(), columns: [],
    };
    const colCount = u();
    for (let k = 0; k < colCount; k += 1) { r.columns.push(bytes[at]); at += 1; }
    records.push(r);
  }
  return { version, records };
}
