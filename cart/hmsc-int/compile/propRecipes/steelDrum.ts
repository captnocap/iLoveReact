import { cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function steelDrumParts(): PropPartSpec[] {
  const h = propKindDefinition('steelDrum').heightMeters;
  const body = hx('#7a3b2a');
  return [
    cylinder16([0, h * 0.48, 0], 0.3, h * 0.94, body),
    cylinder16([0, h * 0.33, 0], 0.315, h * 0.05, hx('#5e2c1e')),
    cylinder16([0, h * 0.66, 0], 0.315, h * 0.05, hx('#5e2c1e')),
    cylinder16([0, h * 0.97, 0], 0.295, h * 0.04, hx('#4a4843')),
  ];
}
