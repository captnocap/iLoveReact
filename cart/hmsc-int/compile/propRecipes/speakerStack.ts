import { box, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const speakerStackDef: PropKindDefinition = {
  kind: 'speakerStack',
  label: 'PA Speaker Stack',
  solid: true,
  footprintRadiusMeters: 0.46,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

export function speakerStackParts(): PropPartSpec[] {
  const h = propKindDefinition('speakerStack').heightMeters;
  const cab = hx('#23262a');
  const cone = hx('#101113');
  return [
    box([0, h * 0.27, 0], [0.9, h * 0.54, 0.62], cab),
    box([0, h * 0.77, 0], [0.78, h * 0.44, 0.55], cab),
    cylinder16([-0.2, h * 0.27, -0.295], 0.17, 0.04, cone, [90, 0, 0]),
    cylinder16([0.2, h * 0.27, -0.295], 0.17, 0.04, cone, [90, 0, 0]),
    cylinder16([0, h * 0.7, -0.26], 0.14, 0.04, cone, [90, 0, 0]),
    box([0, h * 0.9, -0.26], [0.4, 0.14, 0.04], hx('#34383d')),
  ];
}
