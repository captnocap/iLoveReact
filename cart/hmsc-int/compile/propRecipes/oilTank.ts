import { box, cylinder8, cylinder16, hx, RUST, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function oilTankParts(): PropPartSpec[] {
  const def = propKindDefinition('oilTank');
  const r = def.heightMeters / 2 - 0.25;
  const len = def.footprintRadiusMeters * 2 - 0.4;
  const shell = hx('#a89684');
  return [
    cylinder16([0, r + 0.5, 0], r, len, shell, [0, 0, 90]),
    sphere([len / 2, r + 0.5, 0], [0.6, r * 1.9, r * 1.9], hx('#968471')),
    sphere([-len / 2, r + 0.5, 0], [0.6, r * 1.9, r * 1.9], hx('#968471')),
    cylinder8([0.4, r * 2 + 0.5, 0], 0.18, 0.24, RUST),
    box([-len * 0.32, 0.28, 0], [0.32, 0.56, r * 1.9], hx('#82827a')),
    box([len * 0.32, 0.28, 0], [0.32, 0.56, r * 1.9], hx('#82827a')),
  ];
}
