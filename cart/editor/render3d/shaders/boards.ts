// shaders/boards.ts — the 15 effect_fills boards. Hand-owned and stable: boards
// are a small, rarely-changed taxonomy, not something a folder-sweep derives.
// A material's `@board` header slug must be one of BOARD_SLUGS. New boards get
// proposed/blessed here, not invented per-material (see DESIGN_INTAKE.md).
export type Board = {
  index: number;      // D[4]
  letter: string;     // effect_fills demo board letter — legacy, drives nothing but naming
  title: string;
  slug: string;       // the @board header value
  seedCoef: [number, number, number]; // [perMaterial, perVariant, offset] — default seed spread
};

export const BOARDS: Board[] = [
  { index: 0, letter: 'A', title: 'Environment', slug: 'environment', seedCoef: [17, 5, 3] },
  { index: 1, letter: 'B', title: 'Condemned', slug: 'condemned', seedCoef: [23, 11, 41] },
  { index: 2, letter: 'C', title: 'Props & Wearables', slug: 'props', seedCoef: [29, 13, 89] },
  { index: 3, letter: 'D', title: 'Neon Rot', slug: 'neon_rot', seedCoef: [31, 17, 131] },
  { index: 4, letter: 'E', title: 'Neon Surface', slug: 'neon_surface', seedCoef: [37, 19, 181] },
  { index: 5, letter: 'F', title: 'Contraband', slug: 'contraband', seedCoef: [41, 23, 229] },
  { index: 6, letter: 'G', title: 'Liminal', slug: 'liminal', seedCoef: [43, 27, 271] },
  { index: 7, letter: 'H', title: 'Second Pass', slug: 'second_pass', seedCoef: [47, 29, 313] },
  { index: 8, letter: 'I', title: 'Facades', slug: 'facades', seedCoef: [53, 31, 367] },
  { index: 9, letter: 'J', title: 'Wall Props', slug: 'wall_props', seedCoef: [59, 37, 421] },
  { index: 10, letter: 'K', title: 'Street Ground', slug: 'street_ground', seedCoef: [61, 41, 463] },
  { index: 11, letter: 'L', title: 'Wood Brick Stone', slug: 'wood_brick_stone', seedCoef: [67, 43, 509] },
  { index: 12, letter: 'M', title: 'Metal Yard', slug: 'metal_yard', seedCoef: [71, 47, 557] },
  { index: 13, letter: 'N', title: 'Wallpapers', slug: 'wallpapers', seedCoef: [73, 53, 601] },
  { index: 14, letter: 'O', title: 'Gradients', slug: 'gradients', seedCoef: [79, 59, 653] },
];

export const BOARD_SLUGS: ReadonlySet<string> = new Set(BOARDS.map((b) => b.slug));

export function boardBySlug(slug: string): Board | undefined {
  return BOARDS.find((b) => b.slug === slug);
}

export function boardByIndex(index: number): Board | undefined {
  return BOARDS.find((b) => b.index === index);
}
