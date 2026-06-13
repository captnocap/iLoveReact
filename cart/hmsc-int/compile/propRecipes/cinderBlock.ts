import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const cinderBlockDef: PropKindDefinition = {
  kind: 'cinderBlock',
  label: 'Cinder Block',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 0.23,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function cinderBlockParts(): PropPartSpec[] {
  return [
    box([0, 0.11, 0], [0.44, 0.22, 0.22], hx('#a8a8a0')),
    box([-0.1, 0.222, 0], [0.13, 0.015, 0.16], hx('#62625c')),
    box([0.1, 0.222, 0], [0.13, 0.015, 0.16], hx('#62625c')),
  ];
}
