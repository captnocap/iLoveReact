import { box, hx, WHITE, type PropPartSpec } from '../../game/kinds/propModels';

export function greenCrossSignParts(): PropPartSpec[] {
  const green = hx('#2ea84f');
  return [
    box([0, 2.3, -0.04], [0.95, 0.95, 0.08], WHITE),
    box([0, 2.3, -0.09], [0.24, 0.78, 0.025], green),
    box([0, 2.3, -0.09], [0.78, 0.24, 0.025], green),
  ];
}
