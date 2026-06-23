import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const directorsChairDef: PropKindDefinition = {
  kind: 'directorsChair',
  label: "Director's Chair",
  solid: true,
  footprintRadiusMeters: 0.38,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.48, capacity: 1 },
  coverClass: 'soft',
};

export function directorsChairParts(): PropPartSpec[] {
  const seatY = 0.48;
  return [
    // X-frame legs
    box([0, seatY / 2, 0.22], [0.05, 0.72, 0.05], hx('#6b4a2e'), [0, 0, -18]),
    box([0, seatY / 2, -0.22], [0.05, 0.72, 0.05], hx('#6b4a2e'), [0, 0, -18]),
    box([0, seatY / 2, 0.22], [0.05, 0.72, 0.05], hx('#6b4a2e'), [0, 0, 18]),
    box([0, seatY / 2, -0.22], [0.05, 0.72, 0.05], hx('#6b4a2e'), [0, 0, 18]),
    // seat
    box([0, seatY, 0], [0.46, 0.05, 0.42], hx('#22262b')),
    // backrest
    box([0, seatY + 0.24, -0.22], [0.42, 0.42, 0.05], hx('#22262b')),
  ];
}
