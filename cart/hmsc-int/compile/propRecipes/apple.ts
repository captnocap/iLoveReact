import { box, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';

export function appleParts(): PropPartSpec[] {
  return [
    sphere([0, 0.05, 0], [0.1, 0.09, 0.1], hx('#c1272d')),
    box([0, 0.1, 0], [0.012, 0.03, 0.012], hx('#5c4631')),
  ];
}
