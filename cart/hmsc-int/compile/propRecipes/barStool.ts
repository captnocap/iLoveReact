import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const barStoolDef: PropKindDefinition = {
  kind: 'barStool',
  label: 'Bar Stool',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 1.05,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.75, capacity: 1 },
  coverClass: 'soft',
};

export function barStoolParts(): PropPartSpec[] {
  const legH = 0.98;
  return [
    box([0, legH / 2, 0], [0.05, legH, 0.05], hx('#6b4a2e')),
    box([0, 0.35, 0], [0.4, 0.04, 0.4], hx('#4a4a4a')),
    box([0, legH + 0.025, 0], [0.42, 0.06, 0.42], hx('#8a6240')),
    box([0, legH + 0.08, 0.21], [0.42, 0.12, 0.04], hx('#7d3b4a')), // backrest
  ];
}
