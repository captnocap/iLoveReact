import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tabletDef: PropKindDefinition = {
  kind: 'tablet',
  label: 'Tablet',
  solid: false,
  footprintRadiusMeters: 0.22,
  heightMeters: 0.03,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function tabletParts(): PropPartSpec[] {
  return [
    box([0, 0.01, 0], [0.44, 0.02, 0.32], hx('#22262b')),
    box([0, 0.02, 0], [0.4, 0.01, 0.28], hx('#2c4a66')),
  ];
}
