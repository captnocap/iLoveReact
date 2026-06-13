import { box, cylinder8, hx, NEAR_BLACK, STEEL_DARK, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function dinerBoothParts(): PropPartSpec[] {
  const def = propKindDefinition('dinerBooth');
  const w = def.footprintRadiusMeters * 2;
  const vinyl = hx('#c14d4d');
  const vinylDark = hx('#a83a3a');
  return [
    box([0, 0.45, -0.5], [w - 0.1, 0.14, 0.45], vinyl),
    box([0, 0.7, -0.72], [w - 0.1, 0.85, 0.12], vinylDark),
    box([0, 0.45, 0.5], [w - 0.1, 0.14, 0.45], vinyl),
    box([0, 0.7, 0.72], [w - 0.1, 0.85, 0.12], vinylDark),
    box([0, 0.22, -0.5], [w - 0.14, 0.32, 0.4], NEAR_BLACK),
    box([0, 0.22, 0.5], [w - 0.14, 0.32, 0.4], NEAR_BLACK),
    box([0, 0.74, 0], [w - 0.3, 0.06, 0.6], WHITE),
    cylinder8([0, 0.37, 0], 0.06, 0.74, STEEL_DARK),
  ];
}
