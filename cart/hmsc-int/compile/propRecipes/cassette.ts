import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const cassetteDef: PropKindDefinition = {
  kind: 'cassette',
  label: 'Cassette',
  solid: false,
  footprintRadiusMeters: 0.06,
  heightMeters: 0.02,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
};

export function cassetteParts(): PropPartSpec[] {
  return [
    box([0, 0.008, 0], [0.1, 0.014, 0.064], hx('#2a2d33')),
    box([0, 0.017, 0], [0.07, 0.004, 0.04], hx('#d8d2c2')),
  ];
}
