import { cylinder8, cylinder16, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function tireParts(): PropPartSpec[] {
  const R = propKindDefinition('tire').heightMeters / 2;
  return [
    cylinder16([0, R, 0], R, R * 0.68, NEAR_BLACK, [90, 0, 0]),
    cylinder16([0, R, 0], R * 0.46, R * 0.72, hx('#6c727b'), [90, 0, 0]),
    cylinder8([0, R, 0], R * 0.14, R * 0.76, hx('#52565d'), [90, 0, 0]),
  ];
}
