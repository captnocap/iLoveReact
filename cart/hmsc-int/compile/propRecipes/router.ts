import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const routerDef: PropKindDefinition = {
  kind: 'router',
  label: 'Router',
  solid: false,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.06,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function routerParts(): PropPartSpec[] {
  return [
    box([0, 0.03, 0], [0.4, 0.04, 0.28], hx('#22262b')),
    box([0, 0.04, 0], [0.05, 0.02, 0.05], hx('#3a7d80')),
    cylinder8([0.12, 0.08, 0.1], 0.005, 0.1, hx('#9aa1ab'), [0, 0, 25]),
    cylinder8([-0.12, 0.08, -0.1], 0.005, 0.1, hx('#9aa1ab'), [0, 0, -25]),
  ];
}
