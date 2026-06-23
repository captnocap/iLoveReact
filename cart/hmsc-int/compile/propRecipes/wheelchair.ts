import { box, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wheelchairDef: PropKindDefinition = {
  kind: 'wheelchair',
  label: 'Wheelchair',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
};

const FRAME = hx('#4a4a4e');
const SEAT = hx('#22262b');
const TIRE = hx('#1a1c1e');
const RIM = hx('#9aa1ab');

export function wheelchairParts(): PropPartSpec[] {
  return [
    // seat
    box([0, 0.42, 0], [0.4, 0.06, 0.4], SEAT),
    // backrest
    box([0, 0.65, -0.18], [0.38, 0.45, 0.05], SEAT),
    // frame rails
    box([0, 0.28, 0], [0.42, 0.03, 0.03], FRAME, [0, 0, -5]),
    // rear vertical supports
    box([-0.18, 0.45, -0.18], [0.02, 0.4, 0.02], FRAME),
    box([0.18, 0.45, -0.18], [0.02, 0.4, 0.02], FRAME),
    // large rear wheels
    cylinder16([-0.22, 0.3, 0], 0.24, 0.04, TIRE, [90, 0, 0]),
    cylinder16([-0.22, 0.3, 0], 0.18, 0.05, RIM, [90, 0, 0]),
    cylinder16([0.22, 0.3, 0], 0.24, 0.04, TIRE, [90, 0, 0]),
    cylinder16([0.22, 0.3, 0], 0.18, 0.05, RIM, [90, 0, 0]),
    // small front casters
    cylinder16([0, 0.06, 0.18], 0.06, 0.03, TIRE, [90, 0, 0]),
    // footrests
    box([0, 0.12, 0.22], [0.25, 0.02, 0.1], FRAME),
    box([-0.1, 0.25, 0.18], [0.02, 0.25, 0.02], FRAME),
    box([0.1, 0.25, 0.18], [0.02, 0.25, 0.02], FRAME),
    // push handles
    box([-0.18, 0.85, -0.22], [0.02, 0.12, 0.02], FRAME, [0, 0, -20]),
    box([0.18, 0.85, -0.22], [0.02, 0.12, 0.02], FRAME, [0, 0, 20]),
  ];
}
