import { type PropKindDefinition } from '../../game/kinds/props';
import { box, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';

export function appleParts(): PropPartSpec[] {
  return [
    sphere([0, 0.05, 0], [0.1, 0.09, 0.1], hx('#c1272d')),
    box([0, 0.1, 0], [0.012, 0.03, 0.012], hx('#5c4631')),
  ];
}

export const appleDef: PropKindDefinition = {
  kind: 'apple',
  label: 'Apple',
  solid: true,
  footprintRadiusMeters: 0.05,
  heightMeters: 0.09,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.06, restitution: 0.35 },
};
