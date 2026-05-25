import { SK_ITEM_LOCKPICK } from './spriteKinds';
import { defineItem } from './types';

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
  },
  inventory: {
    shortLabel: 'pick',
    equipText: 'Lockpick ready.',
  },
});
