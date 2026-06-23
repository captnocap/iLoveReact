import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const parkingMeterDoubleDef: PropKindDefinition = {
  kind: 'parkingMeterDouble',
  label: 'Double Parking Meter',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const POLE = hx('#2c2c2e');
const HEAD = hx('#4a4a4e');
const SCREEN = hx('#111111');

export function parkingMeterDoubleParts(): PropPartSpec[] {
  return [
    // central pole
    cylinder8([0, 0.55, 0], 0.04, 1.1, POLE),
    // base
    box([0, 0.05, 0], [0.2, 0.08, 0.2], POLE),
    // cross arm
    box([0, 1.05, 0], [0.5, 0.05, 0.08], HEAD),
    // left meter head
    box([-0.22, 1.05, 0], [0.16, 0.26, 0.18], HEAD),
    box([-0.22, 1.05, 0.1], [0.1, 0.14, 0.01], SCREEN),
    // right meter head
    box([0.22, 1.05, 0], [0.16, 0.26, 0.18], HEAD),
    box([0.22, 1.05, 0.1], [0.1, 0.14, 0.01], SCREEN),
    // caps
    cylinder8([-0.22, 1.2, 0], 0.07, 0.04, HEAD),
    cylinder8([0.22, 1.2, 0], 0.07, 0.04, HEAD),
  ];
}
