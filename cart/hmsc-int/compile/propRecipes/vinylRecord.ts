import { cylinder8, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const vinylRecordDef: PropKindDefinition = {
  kind: 'vinylRecord',
  label: 'Vinyl Record',
  solid: false,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
};

export function vinylRecordParts(): PropPartSpec[] {
  return [
    cylinder16([0, 0.02, 0], 0.18, 0.015, hx('#111214')),
    cylinder8([0, 0.032, 0], 0.05, 0.012, hx('#d8762a')),
  ];
}
