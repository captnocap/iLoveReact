import { SK_ITEM_BOMB } from './spriteKinds';
import { defineItem } from './types';

export const bomb = defineItem({
  type: {
    key: 'bomb',
    category: 'weapon',
    label: 'Pipe bomb',
    cost: 450,
    burnable: true,
    enables: ['plant_bomb'],
    charges: 1,
  },
  world: {
    spriteKind: SK_ITEM_BOMB,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_BOMB}) {
    c = over(c, shade(sdCirc(vec2f(lx, (ly + 9.0) * 1.15), 8.5), vec3f(0.18, 0.20, 0.23), vec3f(0.07, 0.08, 0.09)));
    c = over(c, shade(sdBox(vec2f(lx + 6.0, ly + 19.0), vec2f(1.6, 7.0)), vec3f(0.72, 0.50, 0.18), vec3f(0.20, 0.14, 0.06)));
    c = over(c, shade(sdCirc(vec2f(lx + 7.0, ly + 29.0), 2.2), vec3f(0.95, 0.78, 0.32), vec3f(0.42, 0.24, 0.08)));
  }
`,
  },
  inventory: {
    shortLabel: 'bomb',
    equipText: 'Pipe bomb in hand.',
  },
});
