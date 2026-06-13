import { box, STONE, STONE_DARK, STONE_LIGHT, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function rockShardParts(): PropPartSpec[] {
  const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('rockShard');
  return [
    box([0, h * 0.5, 0], [r * 1.1, h * 1.0, r * 0.9], STONE, [4, 15, -6]),
    box([r * 0.35, h * 0.38, r * 0.2], [r * 0.8, h * 0.76, r * 0.7], STONE_DARK, [-8, 50, 9]),
    box([-r * 0.3, h * 0.42, -r * 0.25], [r * 0.7, h * 0.85, r * 0.6], STONE_LIGHT, [10, -30, -12]),
    box([0, h * 0.1, 0], [r * 1.8, h * 0.2, r * 1.5], STONE_DARK, [0, 30, 0]),
  ];
}
