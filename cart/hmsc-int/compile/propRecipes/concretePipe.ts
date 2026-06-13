import { CONCRETE, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function concretePipeParts(): PropPartSpec[] {
  const def = propKindDefinition('concretePipe');
  const radius = def.heightMeters / 2;
  const len = def.footprintRadiusMeters * 2 - 0.2;
  return [
    cylinder16([0, radius, 0], radius, len, CONCRETE, [0, 0, 90]),
    // a longer darker core pokes out both ends — the PSX fake bore
    cylinder16([0, radius, 0], radius * 0.78, len + 0.04, hx('#4a4843'), [0, 0, 90]),
    cylinder16([len / 2 - 0.12, radius, 0], radius * 1.06, 0.26, hx('#a8a59c'), [0, 0, 90]),
  ];
}
