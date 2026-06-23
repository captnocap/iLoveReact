import { cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rugRoundDef: PropKindDefinition = {
  kind: 'rugRound',
  label: 'Round Rug',
  solid: true,
  footprintRadiusMeters: 0.8,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function rugRoundParts(): PropPartSpec[] {
  const rust = hx('#7d4f43');
  const plum = hx('#5a3a4a');
  const tan = hx('#8a6a4a');
  const cream = hx('#d6c69a');
  return [
    cylinder8([0, 0.02, 0], 0.8, 0.04, rust),
    cylinder8([0, 0.04, 0], 0.65, 0.02, plum),
    cylinder8([0, 0.045, 0], 0.45, 0.015, tan),
    cylinder8([0, 0.05, 0], 0.22, 0.015, cream),
    // center knot
    cylinder8([0, 0.055, 0], 0.08, 0.01, plum),
  ];
}
