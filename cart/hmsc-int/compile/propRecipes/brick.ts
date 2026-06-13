import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';

export function brickParts(): PropPartSpec[] {
  return [box([0, 0.036, 0], [0.23, 0.07, 0.11], hx('#9c4a36'))];
}
