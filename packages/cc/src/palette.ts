/**
 * ComputerCraft 16-color palette.
 *
 * CC colors are powers of 2 (colors.white = 1, colors.orange = 2, etc.).
 * This module maps CSS hex colors to the nearest CC color via RGB distance.
 */

export interface CCColor {
  id: number;        // CC color API value (power of 2)
  name: string;
  r: number;
  g: number;
  b: number;
}

export const CC_PALETTE: CCColor[] = [
  { id: 1,     name: 'white',     r: 0xF0, g: 0xF0, b: 0xF0 },
  { id: 2,     name: 'orange',    r: 0xF2, g: 0xB2, b: 0x33 },
  { id: 4,     name: 'magenta',   r: 0xE5, g: 0x7F, b: 0xD8 },
  { id: 8,     name: 'lightBlue', r: 0x99, g: 0xB2, b: 0xF2 },
  { id: 16,    name: 'yellow',    r: 0xDE, g: 0xDE, b: 0x6C },
  { id: 32,    name: 'lime',      r: 0x7F, g: 0xCC, b: 0x19 },
  { id: 64,    name: 'pink',      r: 0xF2, g: 0xB2, b: 0xCC },
  { id: 128,   name: 'gray',      r: 0x4C, g: 0x4C, b: 0x4C },
  { id: 256,   name: 'lightGray', r: 0x99, g: 0x99, b: 0x99 },
  { id: 512,   name: 'cyan',      r: 0x4C, g: 0x99, b: 0xB2 },
  { id: 1024,  name: 'purple',    r: 0xB2, g: 0x66, b: 0xE5 },
  { id: 2048,  name: 'blue',      r: 0x33, g: 0x66, b: 0xCC },
  { id: 4096,  name: 'brown',     r: 0x7F, g: 0x66, b: 0x4C },
  { id: 8192,  name: 'green',     r: 0x57, g: 0xA6, b: 0x4E },
  { id: 16384, name: 'red',       r: 0xCC, g: 0x4C, b: 0x4C },
  { id: 32768, name: 'black',     r: 0x11, g: 0x11, b: 0x11 },
];

/** Map color name to CC color for quick lookup. */
const nameMap = new Map<string, number>();
for (const c of CC_PALETTE) {
  nameMap.set(c.name, c.id);
}

/** Parse a CSS hex color (#RGB or #RRGGBB) to [r, g, b]. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Named CSS colors commonly used in React styles. */
const CSS_NAMES: Record<string, string> = {
  white: '#F0F0F0', black: '#111111', red: '#CC4C4C', green: '#57A64E',
  blue: '#3366CC', yellow: '#DEDE6C', cyan: '#4C99B2', magenta: '#E57FD8',
  orange: '#F2B233', purple: '#B266E5', pink: '#F2B2CC', gray: '#4C4C4C',
  grey: '#4C4C4C', brown: '#7F664C', lime: '#7FCC19',
  lightgray: '#999999', lightgrey: '#999999', darkgray: '#4C4C4C', darkgrey: '#4C4C4C',
};

/**
 * Quantize any CSS color string to the nearest CC color ID.
 * Accepts: hex (#RGB, #RRGGBB), CC color names, common CSS color names.
 * Returns CC color API number (power of 2), or 32768 (black) as fallback.
 */
export function nearestCCColor(color: string): number {
  if (!color) return 32768; // black

  // Check CC color name directly
  const byName = nameMap.get(color);
  if (byName !== undefined) return byName;

  // Check CSS named color
  const cssHex = CSS_NAMES[color.toLowerCase()];
  let hex = cssHex || color;

  const rgb = parseHex(hex);
  if (!rgb) return 32768; // fallback black

  let bestDist = Infinity;
  let bestId = 32768;

  for (const c of CC_PALETTE) {
    const dr = rgb[0] - c.r;
    const dg = rgb[1] - c.g;
    const db = rgb[2] - c.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = c.id;
    }
  }

  return bestId;
}

/** Default foreground (white) and background (black) CC colors. */
export const CC_DEFAULT_FG = 1;      // white
export const CC_DEFAULT_BG = 32768;  // black
