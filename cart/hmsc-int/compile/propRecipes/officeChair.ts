import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { chairFrame } from './diningChair';

export function officeChairParts(): PropPartSpec[] {
  return chairFrame(hx('#2e6fb0'), hx('#3a3f46')); // default blue body, metal legs (skinnable)
}
