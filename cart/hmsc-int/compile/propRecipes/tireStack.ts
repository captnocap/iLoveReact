import { cylinder16, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const tireStackDef: PropKindDefinition = {
  kind: 'tireStack',
  label: 'Tire Stack',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function tireStackParts(): PropPartSpec[] {
  const parts: PropPartSpec[] = [];
  const jitter = [[0.04, -0.02], [-0.05, 0.03], [0.02, 0.05], [-0.03, -0.04]];
  for (let i = 0; i < 4; i += 1) {
    parts.push(cylinder16([jitter[i][0], 0.13 + i * 0.24, jitter[i][1]], 0.42, 0.23, i % 2 === 0 ? NEAR_BLACK : hx('#232628')));
  }
  parts.push(cylinder16([jitter[3][0], 1.0, jitter[3][1]], 0.2, 0.02, hx('#0c0d0e')));
  return parts;
}
