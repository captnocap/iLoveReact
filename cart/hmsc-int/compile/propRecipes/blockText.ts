// blockText — PARAMETRIC block-letter signage (req_0893, ask #1).
//
// A business-name sign whose geometry is a FUNCTION of per-instance text: the
// placed prop carries a `text` string (WorldProp.text / PlacedBuildPiece.text),
// and this recipe lowers it to chunky extruded 3D letters built from the prop
// vocabulary's ONE shape that bakes everywhere — the box. Each glyph is a 5×7
// stencil; every lit row collapses into the fewest horizontal run boxes, so a
// letter is a handful of instances, not 35. Because the output is plain
// PropPartSpec boxes, /test (DataProp) and the compiled bake (worldGeometry)
// draw it identically with zero new engine surface — the same contract every
// data-recipe prop honours.
//
// Parametric props differ from fixed ones ONLY in that resolvePropParts passes
// the instance's text through; the footprint path (resolvePartsForKind, no
// instance) lowers a default word so a sign still measures a collision box.

import { hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

// The word a bare sign shows until the user types one (and what the footprint
// path measures). Generous, not cramped — see [[feedback_juice_limits_dont_set_low]].
export const BLOCK_DEFAULT_TEXT = 'SHOP';
// Real channel letters run ~0.6–0.8m tall; 0.7 reads from across a street. ONE
// named home for the cap height — both the def and the recipe read it.
const BLOCK_CAP_HEIGHT_METERS = 0.7;

export const blockLettersDef: PropKindDefinition = {
  kind: 'blockLetters',
  label: 'Block Letters',
  // Channel-letter signage mounts on a building face; the measured footprint
  // (from the default word) gives it a thin collision box flush to the wall.
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: BLOCK_CAP_HEIGHT_METERS,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

// The sign extrudes this far off its mounting plane (the lit channel depth).
const GLYPH_DEPTH_METERS = 0.09;
// Default lit-letter colour — a warm sign red. Color is the skin: every box is
// a texture target via the propPartId index fallback, so a placement can repaint.
const BLOCK_COLOR: Color = hx('#ff3b4e');
// How many characters a single sign admits. Generous (a business name fits);
// past it we truncate LOUDLY rather than silently dropping the tail.
const MAX_BLOCK_CHARS = 24;

// 5×7 uppercase stencil font. '#' = lit cell, ' ' = empty. Row 0 is the top.
// Glyphs are intentionally blocky (the PSX-chunky style contract); lowercase
// folds to uppercase, unknown glyphs render as a space.
const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;
const FONT: Record<string, readonly string[]> = {
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ####', '#    ', '#    ', '#  ##', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['#####', '    #', '    #', '    #', '#   #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '# # #', '#  ##', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': ['#####', '    #', '   # ', '  ## ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': [' ### ', '#    ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '    #', ' ### '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  ',': ['     ', '     ', '     ', '     ', '     ', '  ## ', ' #   '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  '?': [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '],
  '&': [' ##  ', '#  # ', '#  # ', ' ##  ', '# # #', '#  # ', ' ## #'],
  "'": ['  #  ', '  #  ', '  #  ', '     ', '     ', '     ', '     '],
};

function glyph(ch: string): readonly string[] {
  return FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT[' '];
}

/** Normalize, fold case, and cap. Truncation is LOUD (a warn), never silent —
 *  see [[feedback_juice_limits_dont_set_low]]. */
function normalizeText(raw: string | undefined): string {
  const text = (raw ?? BLOCK_DEFAULT_TEXT).toUpperCase();
  if (text.length <= MAX_BLOCK_CHARS) return text;
  console.warn(`[blockText] "${text}" exceeds ${MAX_BLOCK_CHARS} chars — truncating the tail`);
  return text.slice(0, MAX_BLOCK_CHARS);
}

/**
 * The block-letter parts for one sign. `cell` derives from the cap height so a
 * registry height edit rescales the whole sign; the string is centred on x=0 so
 * the prop's anchor sits under the middle of the word (matching how every other
 * recipe centres on its anchor). One box per lit horizontal run, extruded
 * GLYPH_DEPTH off the mounting plane.
 */
export function blockLettersParts(capHeightMeters: number, text?: string): PropPartSpec[] {
  const word = normalizeText(text);
  const cell = capHeightMeters / GLYPH_ROWS;
  const advance = (GLYPH_COLS + 1) * cell; // one empty column between letters
  const totalWidth = word.length > 0 ? word.length * advance - cell : 0;
  const left = -totalWidth / 2;
  const parts: PropPartSpec[] = [];
  for (let i = 0; i < word.length; i += 1) {
    const rows = glyph(word[i]);
    const glyphLeft = left + i * advance;
    for (let r = 0; r < GLYPH_ROWS; r += 1) {
      const row = rows[r] ?? '';
      // Collapse consecutive lit cells into one box (fewer instances).
      let c = 0;
      while (c < GLYPH_COLS) {
        if (row[c] !== '#') { c += 1; continue; }
        let run = 1;
        while (c + run < GLYPH_COLS && row[c + run] === '#') run += 1;
        const w = run * cell;
        // cell centre: top row (r=0) is highest; y measured up from the base.
        const cx = glyphLeft + (c + run / 2) * cell;
        const cy = capHeightMeters - (r + 0.5) * cell;
        parts.push({
          shape: 'box',
          local: [cx, cy, GLYPH_DEPTH_METERS / 2],
          size: [w, cell, GLYPH_DEPTH_METERS],
          color: BLOCK_COLOR,
        });
        c += run;
      }
    }
  }
  return parts;
}
