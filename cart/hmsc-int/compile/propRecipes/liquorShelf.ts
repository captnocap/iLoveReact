import { type PropKindDefinition } from '../../game/kinds/props';
import { box, cylinder8, hx, WOOD, WOOD_DARK, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function liquorShelfParts(): PropPartSpec[] {
  const def = propKindDefinition('liquorShelf');
  const h = def.heightMeters;
  const span = def.footprintRadiusMeters * 2;
  const bottle: Color[] = [hx('#b06f2a'), hx('#2e6f55'), hx('#cfe6f2'), hx('#7a3b2a')];
  const parts: PropPartSpec[] = [
    box([0, h / 2, 0.2], [span, h, 0.05], WOOD_DARK),
    box([0, 0.06, 0], [span, 0.12, 0.45], WOOD_DARK),
    box([-span / 2 + 0.03, h / 2, 0], [0.06, h, 0.42], WOOD),
    box([span / 2 - 0.03, h / 2, 0], [0.06, h, 0.42], WOOD),
  ];
  const shelfYs = [h * 0.35, h * 0.6, h * 0.85];
  shelfYs.forEach((y, row) => {
    parts.push(box([0, y, 0.02], [span - 0.12, 0.04, 0.38], WOOD));
    for (let i = 0; i < 5; i += 1) {
      const x = -span * 0.36 + (i / 4) * span * 0.72;
      parts.push(cylinder8([x, y + 0.17, 0.02], 0.045, 0.3, bottle[(row * 5 + i) % bottle.length]));
    }
  });
  return parts;
}

export const liquorShelfDef: PropKindDefinition = {
  kind: 'liquorShelf',
  label: 'Liquor Shelf',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 5, spawnFillChance: 0.7, searchSeconds: 2.5, access: 'open' },
};
