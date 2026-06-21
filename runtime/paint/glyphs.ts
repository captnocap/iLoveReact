// runtime/paint/glyphs.ts — a tiny 5×7 bitmap font for STAMPING TEXT into a
// paint texture (the text tool, req_1600). Painters here are nearest-sampled
// pixel surfaces, so blocky bitmap glyphs land crisp at any scale — exactly the
// look a pixel painter wants, and with zero host/font dependency.
//
// Deep-but-narrow: the font data is private; callers see only `layoutText`,
// which returns the lit cells (in font-pixel units) plus the block size. The
// caller multiplies by its own pixel scale, offsets to the click point, and
// stamps one filled square per cell — so the same font drives every painter.

/** Glyph grid: 5 columns × 7 rows. Spacing is one blank column between glyphs. */
export const GLYPH_W = 5;
export const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1; // glyph width + 1px gap
const LINE_STEP = GLYPH_H + 1; // glyph height + 1px gap

// Each glyph is 7 rows of 5 chars — '#' lit, anything else off. Lowercase maps
// to uppercase (a single-case pixel font is the standard, compact tradeoff).
const GLYPHS: Record<string, string> = {
  'A': '.###.\n#...#\n#...#\n#####\n#...#\n#...#\n#...#',
  'B': '####.\n#...#\n#...#\n####.\n#...#\n#...#\n####.',
  'C': '.####\n#....\n#....\n#....\n#....\n#....\n.####',
  'D': '####.\n#...#\n#...#\n#...#\n#...#\n#...#\n####.',
  'E': '#####\n#....\n#....\n####.\n#....\n#....\n#####',
  'F': '#####\n#....\n#....\n####.\n#....\n#....\n#....',
  'G': '.####\n#....\n#....\n#.###\n#...#\n#...#\n.####',
  'H': '#...#\n#...#\n#...#\n#####\n#...#\n#...#\n#...#',
  'I': '#####\n..#..\n..#..\n..#..\n..#..\n..#..\n#####',
  'J': '..###\n...#.\n...#.\n...#.\n#..#.\n#..#.\n.##..',
  'K': '#...#\n#..#.\n#.#..\n##...\n#.#..\n#..#.\n#...#',
  'L': '#....\n#....\n#....\n#....\n#....\n#....\n#####',
  'M': '#...#\n##.##\n#.#.#\n#.#.#\n#...#\n#...#\n#...#',
  'N': '#...#\n##..#\n#.#.#\n#.#.#\n#..##\n#...#\n#...#',
  'O': '.###.\n#...#\n#...#\n#...#\n#...#\n#...#\n.###.',
  'P': '####.\n#...#\n#...#\n####.\n#....\n#....\n#....',
  'Q': '.###.\n#...#\n#...#\n#...#\n#.#.#\n#..#.\n.##.#',
  'R': '####.\n#...#\n#...#\n####.\n#.#..\n#..#.\n#...#',
  'S': '.####\n#....\n#....\n.###.\n....#\n....#\n####.',
  'T': '#####\n..#..\n..#..\n..#..\n..#..\n..#..\n..#..',
  'U': '#...#\n#...#\n#...#\n#...#\n#...#\n#...#\n.###.',
  'V': '#...#\n#...#\n#...#\n#...#\n#...#\n.#.#.\n..#..',
  'W': '#...#\n#...#\n#...#\n#.#.#\n#.#.#\n##.##\n#...#',
  'X': '#...#\n#...#\n.#.#.\n..#..\n.#.#.\n#...#\n#...#',
  'Y': '#...#\n#...#\n.#.#.\n..#..\n..#..\n..#..\n..#..',
  'Z': '#####\n....#\n...#.\n..#..\n.#...\n#....\n#####',
  '0': '.###.\n#...#\n#..##\n#.#.#\n##..#\n#...#\n.###.',
  '1': '..#..\n.##..\n..#..\n..#..\n..#..\n..#..\n.###.',
  '2': '.###.\n#...#\n....#\n...#.\n..#..\n.#...\n#####',
  '3': '#####\n...#.\n..#..\n...#.\n....#\n#...#\n.###.',
  '4': '...#.\n..##.\n.#.#.\n#..#.\n#####\n...#.\n...#.',
  '5': '#####\n#....\n####.\n....#\n....#\n#...#\n.###.',
  '6': '..##.\n.#...\n#....\n####.\n#...#\n#...#\n.###.',
  '7': '#####\n....#\n...#.\n..#..\n.#...\n.#...\n.#...',
  '8': '.###.\n#...#\n#...#\n.###.\n#...#\n#...#\n.###.',
  '9': '.###.\n#...#\n#...#\n.####\n....#\n...#.\n.##..',
  ' ': '.....\n.....\n.....\n.....\n.....\n.....\n.....',
  '.': '.....\n.....\n.....\n.....\n.....\n.##..\n.##..',
  ',': '.....\n.....\n.....\n.....\n.##..\n.##..\n.#...',
  '!': '..#..\n..#..\n..#..\n..#..\n..#..\n.....\n..#..',
  '?': '.###.\n#...#\n....#\n...#.\n..#..\n.....\n..#..',
  '-': '.....\n.....\n.....\n#####\n.....\n.....\n.....',
  '_': '.....\n.....\n.....\n.....\n.....\n.....\n#####',
  ':': '.....\n.##..\n.##..\n.....\n.##..\n.##..\n.....',
  ';': '.....\n.##..\n.##..\n.....\n.##..\n.##..\n.#...',
  '/': '....#\n....#\n...#.\n..#..\n.#...\n#....\n#....',
  '\\': '#....\n#....\n.#...\n..#..\n...#.\n....#\n....#',
  "'": '..#..\n..#..\n..#..\n.....\n.....\n.....\n.....',
  '"': '.#.#.\n.#.#.\n.#.#.\n.....\n.....\n.....\n.....',
  '(': '..##.\n.#...\n.#...\n.#...\n.#...\n.#...\n..##.',
  ')': '.##..\n...#.\n...#.\n...#.\n...#.\n...#.\n.##..',
  '+': '.....\n..#..\n..#..\n#####\n..#..\n..#..\n.....',
  '=': '.....\n.....\n#####\n.....\n#####\n.....\n.....',
  '#': '.#.#.\n.#.#.\n#####\n.#.#.\n#####\n.#.#.\n.#.#.',
  '&': '.##..\n#..#.\n#.#..\n.#...\n#.#.#\n#..#.\n.##.#',
  '@': '.###.\n#...#\n#.###\n#.#.#\n#.###\n#....\n.###.',
  '*': '.....\n#.#.#\n.###.\n#####\n.###.\n#.#.#\n.....',
  '%': '##..#\n##.#.\n..#..\n.#...\n#.#..\n#.##.\n#..##',
};

// Parse a glyph string into the set of lit cells, lazily + cached.
const g_cellCache = new Map<string, Array<{ x: number; y: number }>>();
function glyphCells(ch: string): Array<{ x: number; y: number }> {
  const cached = g_cellCache.get(ch);
  if (cached) return cached;
  const rows = (GLYPHS[ch] ?? GLYPHS[' ']).split('\n');
  const cells: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) if (row[c] === '#') cells.push({ x: c, y: r });
  }
  g_cellCache.set(ch, cells);
  return cells;
}

export interface TextLayout {
  /** Lit cells, in font-pixel units (x → right, y → down), origin at top-left. */
  cells: Array<{ x: number; y: number }>;
  /** Block width/height in font-pixel units (the widest line × the line count). */
  width: number;
  height: number;
}

/** Does the font have a glyph for this character (lowercase folds to upper)? */
export function hasGlyph(ch: string): boolean {
  return GLYPHS[ch.toUpperCase()] !== undefined;
}

/**
 * Lay a string out into lit cells. Lines split on `\n`; unknown characters
 * render blank (advance only). The result is in FONT-PIXEL units — multiply by
 * a per-pixel scale and offset to taste, then stamp one square per cell.
 */
export function layoutText(text: string): TextLayout {
  const cells: Array<{ x: number; y: number }> = [];
  const lines = String(text ?? '').split('\n');
  let width = 0;
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const baseY = li * LINE_STEP;
    let penX = 0;
    for (const raw of line) {
      const ch = GLYPHS[raw] !== undefined ? raw : raw.toUpperCase();
      for (const cell of glyphCells(ch)) cells.push({ x: penX + cell.x, y: baseY + cell.y });
      penX += ADVANCE;
    }
    // line width excludes the trailing gap of the last glyph
    if (line.length) width = Math.max(width, penX - 1);
  }
  const height = lines.length * LINE_STEP - 1;
  return { cells, width: Math.max(0, width), height: Math.max(0, height) };
}
