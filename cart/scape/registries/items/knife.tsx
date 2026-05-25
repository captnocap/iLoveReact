import { SK_ITEM_KNIFE } from './spriteKinds';
import { defineItem } from './types';

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
  },
  inventory: {
    shortLabel: 'knife',
    equipText: 'Knife in hand.',
  },
});
