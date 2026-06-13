import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { chairFrame } from './diningChair';

export function foldingChairParts(): PropPartSpec[] {
  return chairFrame(hx('#3a8f4f'), hx('#3a3f46')); // default green body, metal legs (skinnable)
}
