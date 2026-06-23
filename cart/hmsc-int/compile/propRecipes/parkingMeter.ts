import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const parkingMeterDef: PropKindDefinition = {
  kind: 'parkingMeter',
  label: 'Parking Meter',
  solid: true,
  footprintRadiusMeters: 0.16,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function parkingMeterParts(): PropPartSpec[] {
  const pole = hx('#6c727b');
  const head = hx('#52565d');
  const screen = hx('#2c4a66');
  const black = hx('#22262b');
  return [
    cylinder8([0, 1.0, 0], 0.06, 2.0, pole),
    box([0, 1.7, 0], [0.22, 0.35, 0.2], head),
    box([0, 1.7, -0.11], [0.16, 0.22, 0.02], screen),
    // coin slot
    box([0.04, 1.72, -0.12], [0.03, 0.06, 0.01], black),
    // side inspection plate
    box([0.11, 1.55, 0], [0.01, 0.12, 0.12], black),
    box([-0.11, 1.55, 0], [0.01, 0.12, 0.12], black),
    // cap
    cylinder8([0, 1.9, 0], 0.1, 0.04, head),
    box([0, 0.06, 0], [0.25, 0.08, 0.25], pole),
    // base bolts
    box([0.1, 0.06, 0.1], [0.03, 0.02, 0.03], black),
    box([-0.1, 0.06, 0.1], [0.03, 0.02, 0.03], black),
    box([0.1, 0.06, -0.1], [0.03, 0.02, 0.03], black),
    box([-0.1, 0.06, -0.1], [0.03, 0.02, 0.03], black),
  ];
}
