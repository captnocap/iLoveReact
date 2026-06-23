import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const highChairDef: PropKindDefinition = {
  kind: 'highChair',
  label: 'High Chair',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 1.15,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.65, capacity: 1 },
  coverClass: 'soft',
};

export function highChairParts(): PropPartSpec[] {
  const seatY = 0.65;
  return [
    box([0.18, seatY / 2, 0.18], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([-0.18, seatY / 2, 0.18], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([0.18, seatY / 2, -0.18], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([-0.18, seatY / 2, -0.18], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([0, seatY, 0], [0.45, 0.06, 0.45], hx('#8a6240')),
    box([0, seatY + 0.22, 0.22], [0.45, 0.4, 0.05], hx('#8a6240'), [-5, 0, 0]),
    box([0, seatY + 0.02, 0.24], [0.42, 0.04, 0.22], hx('#7d3b4a')), // tray
  ];
}
