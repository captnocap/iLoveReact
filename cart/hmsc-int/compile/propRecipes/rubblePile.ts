import { box, CONCRETE, cylinder8, hx, STEEL_DARK, STONE, STONE_DARK, STONE_LIGHT, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function rubblePileParts(): PropPartSpec[] {
  const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('rubblePile');
  return [
    box([0, h * 0.35, 0], [r * 1.1, h * 0.7, r * 0.9], STONE_DARK, [6, 20, -8]),
    box([r * 0.5, h * 0.2, -r * 0.3], [r * 0.7, h * 0.4, r * 0.6], CONCRETE, [-10, 55, 6]),
    box([-r * 0.45, h * 0.18, r * 0.35], [r * 0.6, h * 0.36, r * 0.55], STONE_LIGHT, [8, -40, -10]),
    box([r * 0.15, h * 0.62, r * 0.2], [r * 0.45, h * 0.3, r * 0.4], CONCRETE, [15, 70, 12]),
    box([-r * 0.2, h * 0.55, -r * 0.35], [r * 0.4, h * 0.28, r * 0.35], STONE, [-12, 30, 8]),
    box([r * 0.55, h * 0.1, r * 0.45], [0.23, 0.07, 0.11], hx('#9c4a36'), [0, 35, 0]),
    cylinder8([-r * 0.6, h * 0.12, -r * 0.2], 0.06, 0.5, STEEL_DARK, [0, 25, 80]),
  ];
}
