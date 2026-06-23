import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const curtainDef: PropKindDefinition = {
  kind: 'curtain',
  label: 'Curtain',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.15,
  heightMeters: 2.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'soft',
};

export function curtainParts(): PropPartSpec[] {
  return [
    box([0, 2.15, 0], [0.9, 0.06, 0.12], hx('#6b4a2e')), // rod
    box([-0.22, 1.1, 0.04], [0.35, 2.1, 0.04], hx('#7d4f43')),
    box([0.22, 1.1, 0.04], [0.35, 2.1, 0.04], hx('#7d4f43')),
    box([0, 1.1, 0.06], [0.12, 2.1, 0.04], hx('#5a3a4a')), // tie-back fold
  ];
}
