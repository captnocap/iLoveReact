import { box, STONE, STONE_DARK, STONE_LIGHT, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

// jagged rock forms — rotated boxes give the sharp facets the sphere-blob rocks
// can't (user: "more like jagged rocks")
export function rockJaggedParts(): PropPartSpec[] {
  const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('rockJagged');
  return [
    box([0, h * 0.45, 0], [r * 1.5, h * 0.9, r * 1.2], STONE, [12, 25, -8]),
    box([r * 0.4, h * 0.3, -r * 0.3], [r * 0.9, h * 0.7, r * 0.8], STONE_DARK, [-15, 60, 10]),
    box([-r * 0.45, h * 0.35, r * 0.25], [r * 0.8, h * 0.8, r * 0.7], STONE_LIGHT, [8, -35, -18]),
    box([r * 0.1, h * 0.8, r * 0.1], [r * 0.6, h * 0.55, r * 0.5], STONE, [22, 45, 15]),
  ];
}
