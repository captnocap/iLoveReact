import { SK_ITEM_CROWBAR } from './spriteKinds';
import { defineItem } from './types';

// A crowbar — the tool that gates prying up floorboards (and forcing things open
// later). `enables: ['pry']` is the contract the action menu reads.
export const crowbar = defineItem({
  type: {
    key: 'crowbar',
    category: 'tool',
    label: 'Crowbar',
    cost: 40,
    enables: ['pry'],
  },
  world: {
    spriteKind: SK_ITEM_CROWBAR,
    tint: 0,
    wgsl: `
  else if (kind == ${SK_ITEM_CROWBAR}) {
    c = over(c, shade(sdBox(vec2f(lx + 3.0, ly), vec2f(2.0, 17.0)), vec3f(0.78, 0.22, 0.18), vec3f(0.30, 0.10, 0.08)));
    c = over(c, shade(sdBox(vec2f(lx + 8.0, ly - 16.0), vec2f(6.0, 2.0)), vec3f(0.78, 0.22, 0.18), vec3f(0.30, 0.10, 0.08)));
    c = over(c, shade(sdBox(vec2f(lx - 1.0, ly + 17.0), vec2f(4.0, 2.0)), vec3f(0.62, 0.16, 0.13), vec3f(0.26, 0.08, 0.06)));
  }
`,
  },
  inventory: {
    shortLabel: 'bar',
    equipText: 'Crowbar in hand. Good for prying.',
  },
});
