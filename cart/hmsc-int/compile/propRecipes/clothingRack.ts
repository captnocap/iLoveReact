import { type PropKindDefinition } from '../../game/kinds/props';
import { box, cylinder8, hx, STEEL, STEEL_DARK, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function clothingRackParts(): PropPartSpec[] {
  const def = propKindDefinition('clothingRack');
  const h = def.heightMeters;
  const halfSpan = def.footprintRadiusMeters * 0.9;
  const clothes: Color[] = [hx('#c14d4d'), hx('#2e6fb0'), hx('#56a85c'), hx('#d8a23a'), hx('#7a4a8a'), hx('#e0e0d4')];
  const parts: PropPartSpec[] = [
    cylinder8([-halfSpan, h / 2, 0], 0.03, h, STEEL),
    cylinder8([halfSpan, h / 2, 0], 0.03, h, STEEL),
    box([-halfSpan, 0.03, 0], [0.5, 0.05, 0.5], STEEL_DARK),
    box([halfSpan, 0.03, 0], [0.5, 0.05, 0.5], STEEL_DARK),
    cylinder8([0, h - 0.03, 0], 0.025, halfSpan * 2, STEEL, [0, 0, 90]),
  ];
  clothes.forEach((color, i) => {
    const x = -halfSpan * 0.78 + (i / (clothes.length - 1)) * halfSpan * 1.56;
    parts.push(box([x, h - 0.45, 0], [0.26, 0.74, 0.1], color));
  });
  return parts;
}

export const clothingRackDef: PropKindDefinition = {
  kind: 'clothingRack',
  label: 'Clothing Rack',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.7, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};
