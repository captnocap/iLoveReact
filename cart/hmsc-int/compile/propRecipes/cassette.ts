import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';

export function cassetteParts(): PropPartSpec[] {
  return [
    box([0, 0.008, 0], [0.1, 0.014, 0.064], hx('#2a2d33')),
    box([0, 0.017, 0], [0.07, 0.004, 0.04], hx('#d8d2c2')),
  ];
}
