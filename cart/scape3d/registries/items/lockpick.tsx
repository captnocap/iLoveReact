import { Fragment } from 'react';
import { SK_ITEM_LOCKPICK } from './spriteKinds';
import { defineItem } from './types';
import { itemBox } from './itemMesh';

const PICK = '#b3ba9e';

export const lockpick = defineItem({
  type: {
    key: 'lockpick',
    category: 'tool',
    label: 'Lockpick',
    cost: 60,
    burnable: true,
    enables: ['pick_lock'],
    charges: 3,
  },
  world: {
    spriteKind: SK_ITEM_LOCKPICK,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_LOCKPICK}) {
    c = over(c, shade(sdBox(vec2f(lx, ly + 14.0), vec2f(1.5, 14.0)), vec3f(0.70, 0.73, 0.62), vec3f(0.22, 0.24, 0.20)));
    c = over(c, shade(abs(sdCirc(vec2f(lx - 4.0, ly + 26.0), 4.5)) - 1.1, vec3f(0.70, 0.73, 0.62), vec3f(0.22, 0.24, 0.20)));
  }
`,
    // ~14 cm lockpick lying flat — thin shaft + a small flat handle loop.
    model: (a) => (
      <Fragment>
        {itemBox(a, { x: 2, y: 0.8, w: 13, h: 1, d: 1.4 }, PICK)}    {/* shaft */}
        {itemBox(a, { x: -7, y: 0.8, w: 5, h: 1, d: 5 }, PICK)}      {/* handle loop */}
      </Fragment>
    ),
  },
  inventory: {
    shortLabel: 'pick',
    equipText: 'Lockpick ready.',
  },
});
