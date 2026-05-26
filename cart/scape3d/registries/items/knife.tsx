import { Fragment } from 'react';
import { SK_ITEM_KNIFE } from './spriteKinds';
import { defineItem } from './types';
import { itemBox } from './itemMesh';

const STEEL = '#bcc4c7';
const HANDLE = '#43261a';

export const knife = defineItem({
  type: {
    key: 'knife',
    category: 'weapon',
    label: 'Kitchen knife',
    cost: 35,
    ranged: false,
    burnable: true,
    enables: ['slash', 'threaten'],
  },
  world: {
    spriteKind: SK_ITEM_KNIFE,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_KNIFE}) {
    c = over(c, shade(sdBox(vec2f(lx - 2.0, ly + 12.0), vec2f(2.0, 11.0)), vec3f(0.74, 0.77, 0.78), vec3f(0.22, 0.24, 0.25)));
    c = over(c, shade(sdBox(vec2f(lx + 2.0, ly + 24.0), vec2f(2.8, 6.0)), vec3f(0.26, 0.15, 0.10), vec3f(0.10, 0.06, 0.04)));
  }
`,
    // ~31 cm kitchen knife lying flat — flat blade + a chunkier handle.
    model: (a) => (
      <Fragment>
        {itemBox(a, { x: 6, y: 1, w: 22, h: 1.5, d: 3.5 }, STEEL)}    {/* blade */}
        {itemBox(a, { x: -10, y: 1.5, w: 9, h: 3, d: 3.2 }, HANDLE)}  {/* handle */}
      </Fragment>
    ),
  },
  inventory: {
    shortLabel: 'knife',
    equipText: 'Knife in hand.',
  },
});
