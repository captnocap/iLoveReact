// ledTicker — a scrolling LED ticker-tape sign (req_0893, ask #3).
//
// PARAMETRIC + ANIMATED: the placement carries a `text` message (the shared prop
// text channel), shown as a scrolling dot-matrix on a recessed face. Like the
// decal split, ONE data recipe (the message → column bitmasks, blockText.textColumns)
// feeds TWO renderers that must agree:
//   • editor (/test): render3d/props/LedTicker.tsx draws the lit LEDs as a
//     Scene3D.Instances bucket, advancing the scroll offset each frame;
//   • compiled (no-V8): the bake emits a TICKER lump (worldGeometry) that
//     world_loader.zig scrolls + draws per frame (the elevator-car pattern).
// The HOUSING is plain static geometry baked through the normal prop path
// (resolvePropParts → ledTickerHousingParts); only the lit face is animated, so
// the two concerns stay cleanly separated.
//
// All board DIMENSIONS live here as named constants and ride INTO the lump, so
// the Zig loader uses baked values and can never drift from the editor.

import { box, hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';
import { textColumns, TICKER_FONT_ROWS } from './blockText';

// ── board geometry (1 tile = 1 meter) ────────────────────────────────────────
export const LED_ROWS = TICKER_FONT_ROWS; // 7 — the dot-matrix is this tall
export const LED_CELL_METERS = 0.055; // one LED cell pitch
export const LED_WINDOW_COLS = 26; // visible columns (the lit window width)
export const LED_DOT_FRAC = 0.82; // dot size as a fraction of the cell pitch
export const LED_BORDER_METERS = 0.07; // dark bezel around the window
export const LED_DEPTH_METERS = 0.09; // housing depth
export const LED_FACE_INSET_METERS = 0.012; // how far the lit dots sit proud of the face
export const LED_SCROLL_COLS_PER_SEC = 9; // scroll speed (columns per second)
export const LED_DEFAULT_TEXT = 'BREAKING NEWS';
export const LED_ON_COLOR = '#ff5a1e'; // lit LED — classic amber-red
export const LED_HOUSING_COLOR = '#0a0a10'; // the dark board the LEDs sit on
// Generous — a real ticker runs long messages; bounded so a hostile string can't
// blow the lump. See [[feedback_juice_limits_dont_set_low]].
export const MAX_TICKER_COLS = 1024;

export const ledFaceWidthMeters = LED_WINDOW_COLS * LED_CELL_METERS;
export const ledFaceHeightMeters = LED_ROWS * LED_CELL_METERS;
export const ledHousingWidthMeters = ledFaceWidthMeters + LED_BORDER_METERS * 2;
export const ledHousingHeightMeters = ledFaceHeightMeters + LED_BORDER_METERS * 2;
// The face (and so the whole sign) is centred at this height above the anchor.
export const ledFaceCenterYMeters = ledHousingHeightMeters / 2;

export const ledTickerDef: PropKindDefinition = {
  kind: 'ledTicker',
  label: 'LED Ticker',
  solid: true,
  footprintRadiusMeters: 0.5,
  footprintWidthMeters: ledHousingWidthMeters,
  footprintDepthMeters: LED_DEPTH_METERS,
  heightMeters: ledHousingHeightMeters,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

/** The static HOUSING — a dark board the animated LEDs scroll across. The lit
 *  dots are NOT here (they're the animated layer); this is what bakes/collides. */
export function ledTickerHousingParts(): PropPartSpec[] {
  const cy = ledFaceCenterYMeters;
  const housing: Color = hx(LED_HOUSING_COLOR);
  return [
    // the board body
    box([0, cy, 0], [ledHousingWidthMeters, ledHousingHeightMeters, LED_DEPTH_METERS], housing),
    // a slightly-proud darker face the dots light up against (reads as the screen)
    box([0, cy, LED_DEPTH_METERS / 2], [ledFaceWidthMeters, ledFaceHeightMeters, 0.006], hx('#05050a')),
  ];
}

/** The message's column bitmasks, capped (loud truncation, never silent). One
 *  GLYPH_ROWS-bit mask per column; the SAME recipe the lump ships to the loader. */
export function tickerColumns(text: string | undefined): number[] {
  const cols = textColumns((text ?? LED_DEFAULT_TEXT) || LED_DEFAULT_TEXT);
  // pad the loop with a few blank columns so the message gaps before repeating
  const padded = cols.concat([0, 0, 0, 0]);
  if (padded.length <= MAX_TICKER_COLS) return padded;
  console.warn(`[ledTicker] message has ${padded.length} columns — capping at ${MAX_TICKER_COLS}`);
  return padded.slice(0, MAX_TICKER_COLS);
}

export type LedDot = { localX: number; localY: number; localZ: number };

/** The lit LED dots for a scroll `offsetCols` (float — the integer part selects
 *  the source column, the fraction slides the window smoothly). Returns LOCAL
 *  anchor-relative positions; the caller lifts them to world via at(prop,…). The
 *  loader mirrors this math in Zig. Renders one extra column so a half-scrolled
 *  cell entering from the right is present. */
export function ledLitDots(columns: number[], offsetCols: number): LedDot[] {
  const dots: LedDot[] = [];
  const n = columns.length;
  if (n === 0) return dots;
  const base = Math.floor(offsetCols);
  const frac = offsetCols - base;
  const faceLeft = -ledFaceWidthMeters / 2;
  const faceTop = ledFaceCenterYMeters + ledFaceHeightMeters / 2;
  const z = LED_DEPTH_METERS / 2 + LED_FACE_INSET_METERS;
  for (let vc = 0; vc <= LED_WINDOW_COLS; vc += 1) {
    const src = (((base + vc) % n) + n) % n;
    const mask = columns[src];
    if (mask === 0) continue;
    const cellX = faceLeft + (vc - frac + 0.5) * LED_CELL_METERS;
    // clip columns that have slid past the left bezel
    if (cellX < faceLeft - LED_CELL_METERS * 0.5 || cellX > -faceLeft + LED_CELL_METERS * 0.5) continue;
    for (let r = 0; r < LED_ROWS; r += 1) {
      if ((mask & (1 << r)) === 0) continue;
      dots.push({ localX: cellX, localY: faceTop - (r + 0.5) * LED_CELL_METERS, localZ: z });
    }
  }
  return dots;
}

export const LED_DOT_SIZE_METERS = LED_CELL_METERS * LED_DOT_FRAC;
