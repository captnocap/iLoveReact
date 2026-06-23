import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const stoolDef: PropKindDefinition = {
  kind: 'stool',
  label: 'Stool',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

export function stoolParts(): PropPartSpec[] {
  const legH = 0.7;
  const seatR = 0.22;
  return [
    box([0, legH / 2, 0], [0.05, legH, 0.05], hx('#6b4a2e')), // central post
    box([0, 0.04, 0], [0.42, 0.06, 0.42], hx('#4a4a4a')), // foot ring plate
    box([0, legH + 0.02, 0], [seatR * 2, 0.06, seatR * 2], hx('#8a6240')), // round seat
  ];
}
