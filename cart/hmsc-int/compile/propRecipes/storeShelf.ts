import { box, hx, STEEL, STEEL_DARK, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const storeShelfDef: PropKindDefinition = {
  kind: 'storeShelf',
  label: 'Store Shelf',
  // A gondola run, long like a fence — yaw-aware thin AABB in world props.
  solid: true,
  footprintRadiusMeters: 0.95,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 6, spawnFillChance: 0.65, searchSeconds: 3, access: 'open' },
};

export function storeShelfParts(): PropPartSpec[] {
  const def = propKindDefinition('storeShelf');
  const span = def.footprintRadiusMeters * 2;
  const h = def.heightMeters;
  const goods: Color[] = [hx('#d8a23a'), hx('#3a8fd8'), hx('#c14d4d'), hx('#56a85c'), hx('#b06fc4'), hx('#e0e0d4')];
  const parts: PropPartSpec[] = [
    box([0, 0.06, 0], [span, 0.12, 0.6], STEEL_DARK),
    box([0, h / 2, 0.26], [span, h - 0.08, 0.05], STEEL),
    box([-span / 2 + 0.03, h / 2, 0], [0.06, h, 0.58], STEEL_DARK),
    box([span / 2 - 0.03, h / 2, 0], [0.06, h, 0.58], STEEL_DARK),
  ];
  const shelfYs = [h * 0.3, h * 0.55, h * 0.8];
  shelfYs.forEach((y, row) => {
    parts.push(box([0, y, 0], [span - 0.12, 0.05, 0.55], STEEL));
    for (let i = 0; i < 3; i += 1) {
      const x = (i - 1) * span * 0.28;
      parts.push(box([x, y + 0.16, -0.05], [span * 0.2, 0.26, 0.35], goods[(row * 3 + i) % goods.length]));
    }
  });
  return parts;
}
