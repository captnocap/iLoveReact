import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const brickDef: PropKindDefinition = {
  kind: 'brick',
  label: 'Brick',
  // Kickable street litter — tiny sphere body, near-dead bounce.
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.08,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.1, restitution: 0.12 },
};

export function brickParts(): PropPartSpec[] {
  return [box([0, 0.036, 0], [0.23, 0.07, 0.11], hx('#9c4a36'))];
}
