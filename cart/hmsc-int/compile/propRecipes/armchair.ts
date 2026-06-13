import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { chairFrame } from './diningChair';

export function armchairParts(): PropPartSpec[] {
  return chairFrame(hx('#b03a2e'), hx('#3a3f46')); // default red body, metal legs (skinnable)
}
