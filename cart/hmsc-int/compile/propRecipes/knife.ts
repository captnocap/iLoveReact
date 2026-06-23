import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const knifeDef: PropKindDefinition = {
  kind: 'knife',
  label: 'Knife',
  solid: false,
  footprintRadiusMeters: 0.14,
  heightMeters: 0.02,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function knifeParts(): PropPartSpec[] {
  return [
    box([0, 0.005, 0.02], [0.03, 0.01, 0.14], hx('#6b4a2e')),
    box([0, 0.005, -0.08], [0.025, 0.005, 0.18], hx('#9aa1ab'), [2, 0, 0]),
  ];
}
