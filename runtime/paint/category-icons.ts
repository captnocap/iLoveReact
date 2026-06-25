// runtime/paint/category-icons.ts — wireframe glyphs for build-piece CATEGORIES
// (floor / wall / ramp / …). Authored as SVG-style path layers exactly like the
// brush/tool glyphs in icons.ts, so they bake into the SAME SDF atlas (via
// scripts/paint-glyph-source.ts → rjit bake-icons) and draw as one cheap quad
// each. The whole point (req_1925): a wireframe PICTURE that reads as "floor"
// without the word — and NOT a live <Graph.Path> per tab (dozens re-tessellating
// every frame is the cost SdfIcon exists to kill).
//
// Centered ±12 space, y-down (matching icons.ts). Strokes (fill:false) read as
// wireframe; the baker rasterizes them to an SDF.

import type { IconLayer } from './icons';

/** The build categories that ship a glyph — names map to `cat.<id>` in the atlas. */
export const BUILD_CATEGORY_ICONS = [
  'floor', 'wall', 'ramp', 'roof', 'stairs', 'elevator', 'pillar', 'prefabs', 'water', 'tower',
] as const;
export type BuildCategoryIcon = (typeof BUILD_CATEGORY_ICONS)[number];

function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x},${y} L ${x + w},${y} L ${x + w},${y + h} L ${x},${y + h} Z`;
}

/** Wireframe icon layers for a build category. Pure; the bake source and any
 *  live fallback both read this so the atlas can never drift from the picker. */
export function categoryIconLayers(cat: string): IconLayer[] {
  switch (cat) {
    case 'floor': // an isometric tile, cross-divided so it reads "tiled ground"
      return [
        { d: 'M 0,-7 L 10,0 L 0,7 L -10,0 Z', fill: false },
        { d: 'M 5,-3.5 L -5,3.5', fill: false },
        { d: 'M -5,-3.5 L 5,3.5', fill: false },
      ];
    case 'wall': // an upright panel with staggered brick courses
      return [
        { d: rect(-9, -7, 18, 14), fill: false },
        { d: 'M -9,-2.33 L 9,-2.33', fill: false },
        { d: 'M -9,2.33 L 9,2.33', fill: false },
        { d: 'M 0,-7 L 0,-2.33', fill: false },
        { d: 'M -4.5,-2.33 L -4.5,2.33', fill: false },
        { d: 'M 4.5,-2.33 L 4.5,2.33', fill: false },
        { d: 'M 0,2.33 L 0,7', fill: false },
      ];
    case 'ramp': // a right-triangle incline rising to the right
      return [{ d: 'M -9,7 L 9,7 L 9,-5 Z', fill: false }];
    case 'roof': // a gable peak over a ceiling line
      return [
        { d: 'M -10,1 L 0,-7 L 10,1', fill: false },
        { d: 'M -8,1 L 8,1', fill: false },
      ];
    case 'stairs': // a three-tread step profile ascending right
      return [{ d: 'M -9,6 L -3,6 L -3,1 L 3,1 L 3,-4 L 9,-4', fill: false }];
    case 'elevator': // a shaft box with up/down chevrons
      return [
        { d: rect(-7, -8, 14, 16), fill: false },
        { d: 'M -2.5,-3 L 0,-5.5 L 2.5,-3', fill: false },
        { d: 'M -2.5,3 L 0,5.5 L 2.5,3', fill: false },
      ];
    case 'pillar': // a column: capital + shaft + base
      return [
        { d: rect(-7, -8.5, 14, 2.5), fill: false },
        { d: 'M -3.5,-6 L -3.5,6', fill: false },
        { d: 'M 3.5,-6 L 3.5,6', fill: false },
        { d: rect(-7, 6, 14, 2.5), fill: false },
      ];
    case 'prefabs': // a little house: body + roof + door (a composed prefab)
      return [
        { d: rect(-7, -1, 14, 8), fill: false },
        { d: 'M -8.5,-1 L 0,-8 L 8.5,-1', fill: false },
        { d: rect(-2, 2, 4, 5), fill: false },
      ];
    case 'water': // two rows of ripples
      return [
        { d: 'M -9,-2 L -6,-4.5 L -3,-2 L 0,-4.5 L 3,-2 L 6,-4.5 L 9,-2', fill: false },
        { d: 'M -9,4 L -6,1.5 L -3,4 L 0,1.5 L 3,4 L 6,1.5 L 9,4', fill: false },
      ];
    case 'tower': // a tall multi-storey block with an antenna
      return [
        { d: rect(-5, -9, 10, 18), fill: false },
        { d: 'M -5,-4.5 L 5,-4.5', fill: false },
        { d: 'M -5,0 L 5,0', fill: false },
        { d: 'M -5,4.5 L 5,4.5', fill: false },
        { d: 'M 0,-9 L 0,-11.5', fill: false },
      ];
    default: // unknown → a plain framed box, so a new category never goes blank
      return [{ d: rect(-8, -8, 16, 16), fill: false }];
  }
}
