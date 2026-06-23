import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const broomDef: PropKindDefinition = {
  kind: 'broom',
  label: 'Broom',
  solid: true,
  footprintRadiusMeters: 0.12,
  footprintDepthMeters: 0.12,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function broomParts(): PropPartSpec[] {
  return [
    box([0, 0.8, 0], [0.04, 1.6, 0.04], hx('#6b4a2e'), [0, 0, 3]),
    box([0.02, 0.35, 0], [0.18, 0.5, 0.08], hx('#8a6a4a'), [0, 0, 3]),
    box([0, 0.85, 0], [0.06, 0.06, 0.06], hx('#22262b')),
  ];
}
