import { box, hx, WHITE, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const hospitalSignDef: PropKindDefinition = {
  kind: 'hospitalSign',
  label: 'Hospital Sign',
  // The building-identity prop: bolt it to any structure and it reads as a
  // hospital (white panel + red cross).
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 3.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export function hospitalSignParts(): PropPartSpec[] {
  const red = hx('#c1272d');
  return [
    box([0, 2.7, -0.05], [2.6, 0.8, 0.1], WHITE),
    box([-0.95, 2.7, -0.115], [0.16, 0.52, 0.025], red),
    box([-0.95, 2.7, -0.115], [0.52, 0.16, 0.025], red),
    box([0.35, 2.7, -0.115], [1.5, 0.34, 0.02], hx('#15314e')),
  ];
}
