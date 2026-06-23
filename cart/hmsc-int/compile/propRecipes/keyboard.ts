import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const keyboardDef: PropKindDefinition = {
  kind: 'keyboard',
  label: 'Keyboard',
  solid: false,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.05,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function keyboardParts(): PropPartSpec[] {
  return [
    box([0, 0.02, 0], [0.7, 0.04, 0.24], hx('#d6d9dc')),
    box([0, 0.04, 0], [0.6, 0.01, 0.18], hx('#22262b')),
  ];
}
