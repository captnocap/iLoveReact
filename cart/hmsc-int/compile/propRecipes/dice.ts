import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const diceDef: PropKindDefinition = {
  kind: 'dice',
  label: 'Dice',
  solid: false,
  footprintRadiusMeters: 0.04,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function diceParts(): PropPartSpec[] {
  return [
    box([0, 0.02, 0], [0.04, 0.04, 0.04], hx('#eef0f2')),
    box([-0.04, 0.02, 0.03], [0.04, 0.04, 0.04], hx('#d6d9dc'), [0, 15, 0]),
    box([0.04, 0.025, 0.03], [0.04, 0.04, 0.04], hx('#9aa1ab'), [10, -10, 0]),
  ];
}
