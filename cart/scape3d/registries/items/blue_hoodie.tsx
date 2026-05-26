import { Fragment } from 'react';
import { SK_ITEM_HOODIE } from './spriteKinds';
import { defineItem } from './types';
import { itemBox } from './itemMesh';

const PRESENTS = { silhouette: 'avg' as const, color: '#2e6da4', accessory: 'hood' as const };
const CLOTH = '#2956a8';
const CLOTH_DARK = '#1a3a5c';

export const blueHoodie = defineItem({
  type: {
    key: 'blue_hoodie',
    category: 'costume',
    label: 'Blue hoodie',
    cost: 90,
    presents: PRESENTS,
    burnable: true,
  },
  world: {
    spriteKind: SK_ITEM_HOODIE,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_HOODIE}) {
    c = over(c, shade(sdBox(vec2f(lx, ly + 18.0), vec2f(9.0, 11.0)), vec3f(0.16, 0.34, 0.54), vec3f(0.06, 0.13, 0.22)));
    c = over(c, shade(sdCirc(vec2f(lx, ly + 32.0), 7.0), vec3f(0.18, 0.38, 0.60), vec3f(0.06, 0.13, 0.22)));
    c = over(c, shade(sdBox(vec2f(lx, ly + 8.0), vec2f(12.0, 3.0)), vec3f(0.10, 0.23, 0.36), vec3f(0.04, 0.09, 0.16)));
  }
`,
    // A folded hoodie — a low cloth bundle with the hood folded on top.
    model: (a) => (
      <Fragment>
        {itemBox(a, { y: 3, w: 17, h: 6, d: 13 }, CLOTH)}            {/* folded body */}
        {itemBox(a, { x: 4, y: 8, w: 9, h: 4, d: 9 }, CLOTH_DARK)}   {/* hood fold */}
      </Fragment>
    ),
  },
  inventory: {
    shortLabel: 'hoodie',
    equipText: 'Blue hoodie equipped.',
    onEquip: ({ player }) => {
      player.costume = PRESENTS;
    },
  },
});
