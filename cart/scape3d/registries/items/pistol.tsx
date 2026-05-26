import { Fragment } from 'react';
import { SK_ITEM_PISTOL } from './spriteKinds';
import { defineItem } from './types';
import { itemBox } from './itemMesh';

const METAL = '#383b42';
const GRIP = '#2e251f';

// The first ranged weapon. Its RangeProfile drives the action-menu hit-% through
// systems/chance.ts: best at ~4 tiles, falls off with distance, needs line of sight,
// and is heavily penalised firing through glass.
export const pistol = defineItem({
  type: {
    key: 'pistol',
    category: 'weapon',
    label: 'Cheap pistol',
    cost: 240,
    ranged: true,
    burnable: true,
    enables: ['shoot'],
    charges: 7, // rounds in the mag
    range: {
      baseAccuracy: 0.75,
      optimalRange: 4,
      falloffPerTile: 0.06,
      maxRange: 9,
      needsLos: true,
      glassPenalty: 0.45,
    },
  },
  world: {
    spriteKind: SK_ITEM_PISTOL,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_PISTOL}) {
    c = over(c, shade(sdBox(vec2f(lx, ly + 20.0), vec2f(11.0, 3.0)), vec3f(0.22, 0.23, 0.26), vec3f(0.10, 0.10, 0.12)));
    c = over(c, shade(sdBox(vec2f(lx + 10.0, ly + 20.0), vec2f(1.8, 2.0)), vec3f(0.30, 0.31, 0.34), vec3f(0.12, 0.12, 0.14)));
    c = over(c, shade(sdBox(vec2f(lx - 6.0, ly + 12.0), vec2f(3.0, 6.5)), vec3f(0.18, 0.14, 0.12), vec3f(0.08, 0.06, 0.05)));
    c = over(c, shade(sdBox(vec2f(lx - 1.0, ly + 14.5), vec2f(3.2, 1.6)), vec3f(0.16, 0.16, 0.18), vec3f(0.07, 0.07, 0.08)));
  }
`,
    // ~18 cm pistol lying flat — slide along x, grip out the back.
    model: (a) => (
      <Fragment>
        {itemBox(a, { x: 2, y: 3, w: 16, h: 4, d: 3.2 }, METAL)}     {/* slide / barrel */}
        {itemBox(a, { x: -5, y: 1.6, z: 4, w: 4, h: 3.2, d: 8 }, GRIP)}  {/* grip */}
        {itemBox(a, { x: -3, y: 1.4, z: 1.5, w: 4, h: 1.6, d: 4 }, METAL)} {/* trigger guard */}
      </Fragment>
    ),
  },
  inventory: {
    shortLabel: 'pistol',
    equipText: 'Cheap pistol in hand.',
  },
});
