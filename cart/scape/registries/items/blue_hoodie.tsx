import { SK_ITEM_HOODIE } from './spriteKinds';
import { defineItem } from './types';

const PRESENTS = { silhouette: 'avg' as const, color: '#2e6da4', accessory: 'hood' as const };

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
  },
  inventory: {
    shortLabel: 'hoodie',
    equipText: 'Blue hoodie equipped.',
    onEquip: ({ player }) => {
      player.costume = PRESENTS;
    },
  },
});
