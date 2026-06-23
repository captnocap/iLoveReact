import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockingChairDef: PropKindDefinition = {
  kind: 'rockingChair',
  label: 'Rocking Chair',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 1.05,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

export function rockingChairParts(): PropPartSpec[] {
  const seatY = 0.45;
  return [
    // runners
    box([0, 0.08, 0.32], [0.88, 0.05, 0.06], hx('#6b4a2e'), [-8, 0, 0]),
    box([0, 0.08, -0.32], [0.88, 0.05, 0.06], hx('#6b4a2e'), [-8, 0, 0]),
    // legs
    box([0.22, seatY / 2, 0.22], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([-0.22, seatY / 2, 0.22], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([0.22, seatY / 2, -0.22], [0.05, seatY, 0.05], hx('#6b4a2e')),
    box([-0.22, seatY / 2, -0.22], [0.05, seatY, 0.05], hx('#6b4a2e')),
    // seat
    box([0, seatY, 0], [0.5, 0.06, 0.5], hx('#8a6240')),
    // backrest
    box([0, seatY + 0.3, 0.24], [0.5, 0.58, 0.05], hx('#8a6240'), [-6, 0, 0]),
    // armrests
    box([0.26, seatY + 0.12, 0], [0.05, 0.06, 0.42], hx('#6b4a2e')),
    box([-0.26, seatY + 0.12, 0], [0.05, 0.06, 0.42], hx('#6b4a2e')),
  ];
}
