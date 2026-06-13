import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function jerryCanParts(): PropPartSpec[] {
  const h = propKindDefinition('jerryCan').heightMeters;
  const red = hx('#b03028');
  return [
    box([0, h * 0.46, 0], [0.36, h * 0.84, 0.17], red),
    box([0, h * 0.94, 0], [0.2, h * 0.08, 0.06], hx('#8e1d22')),
    cylinder8([0.13, h * 0.93, 0], 0.035, h * 0.14, hx('#8e1d22'), [0, 0, -20]),
  ];
}
