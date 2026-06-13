import { CONCRETE, cylinder8, cylinder16, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function fountainParts(): PropPartSpec[] {
  const r = propKindDefinition('fountain').footprintRadiusMeters;
  const water = hx('#3a8fd8');
  const waterPale = hx('#bfe3f2');
  return [
    cylinder16([0, 0.275, 0], r, 0.55, CONCRETE),
    cylinder16([0, 0.29, 0], r * 0.88, 0.5, water),
    cylinder8([0, 0.95, 0], 0.25, 0.9, hx('#a8a59c')),
    cylinder16([0, 1.45, 0], 0.7, 0.16, CONCRETE),
    cylinder16([0, 1.5, 0], 0.6, 0.1, water),
    cylinder8([0, 1.85, 0], 0.07, 0.6, waterPale),
    sphere([0, 2.15, 0], [0.42, 0.24, 0.42], waterPale),
  ];
}
