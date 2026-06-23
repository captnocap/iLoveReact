import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const forkDef: PropKindDefinition = {
  kind: 'fork',
  label: 'Fork',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.02,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function forkParts(): PropPartSpec[] {
  return [
    box([0, 0.005, 0], [0.02, 0.01, 0.22], hx('#9aa1ab')),
    box([0, 0.005, -0.11], [0.08, 0.01, 0.04], hx('#9aa1ab')),
    box([-0.025, 0.005, -0.13], [0.01, 0.01, 0.06], hx('#9aa1ab')),
    box([0, 0.005, -0.13], [0.01, 0.01, 0.06], hx('#9aa1ab')),
    box([0.025, 0.005, -0.13], [0.01, 0.01, 0.06], hx('#9aa1ab')),
  ];
}
