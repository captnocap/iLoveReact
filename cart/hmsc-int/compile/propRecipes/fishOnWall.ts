import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fishOnWallDef: PropKindDefinition = {
  kind: 'fishOnWall',
  label: 'Mounted Fish',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.08,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export function fishOnWallParts(): PropPartSpec[] {
  return [
    box([0, 0.25, -0.02], [0.04, 0.5, 0.08], hx('#6b4a2e')), // plaque
    box([0, 0.35, 0.02], [0.35, 0.12, 0.04], hx('#3a7d80'), [0, 0, -8]), // body
    box([-0.2, 0.4, 0.02], [0.12, 0.08, 0.03], hx('#3a7d80'), [0, 0, 25]), // tail
    box([0.18, 0.35, 0.02], [0.08, 0.06, 0.03], hx('#9aa1ab')), // head
  ];
}
