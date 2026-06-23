import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const gurneyDef: PropKindDefinition = {
  kind: 'gurney',
  label: 'Gurney',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
};

const FRAME = hx('#9aa1ab');
const MATTRESS = hx('#eef0f2');
const RAIL = hx('#6c727b');
const WHEEL = hx('#1a1c1e');

export function gurneyParts(): PropPartSpec[] {
  return [
    // mattress
    box([0, 0.52, 0], [0.8, 0.1, 0.5], MATTRESS),
    // pillow
    box([0, 0.6, -0.18], [0.25, 0.06, 0.14], MATTRESS),
    // metal frame base
    box([0, 0.35, 0], [0.82, 0.05, 0.52], FRAME),
    // side rails
    box([0, 0.52, 0.27], [0.78, 0.06, 0.02], RAIL),
    box([0, 0.52, -0.27], [0.78, 0.06, 0.02], RAIL),
    // rail supports
    box([-0.3, 0.44, 0.27], [0.02, 0.12, 0.02], FRAME),
    box([0.3, 0.44, 0.27], [0.02, 0.12, 0.02], FRAME),
    box([-0.3, 0.44, -0.27], [0.02, 0.12, 0.02], FRAME),
    box([0.3, 0.44, -0.27], [0.02, 0.12, 0.02], FRAME),
    // wheels
    cylinder8([-0.32, 0.06, 0.2], 0.05, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([0.32, 0.06, 0.2], 0.05, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([-0.32, 0.06, -0.2], 0.05, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([0.32, 0.06, -0.2], 0.05, 0.03, WHEEL, [90, 0, 0]),
    // push bar at head
    box([0, 0.62, -0.3], [0.5, 0.03, 0.03], RAIL),
  ];
}
