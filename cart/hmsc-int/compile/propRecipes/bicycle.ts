import { box, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bicycleDef: PropKindDefinition = {
  kind: 'bicycle',
  label: 'Bicycle',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
};

const FRAME = hx('#c2362f');
const TIRE = hx('#1a1c1e');
const RIM = hx('#9aa1ab');
const SEAT = hx('#111215');
const HANDLE = hx('#111215');

export function bicycleParts(): PropPartSpec[] {
  return [
    // rear wheel
    cylinder16([-0.25, 0.22, 0], 0.2, 0.04, TIRE, [90, 0, 0]),
    cylinder16([-0.25, 0.22, 0], 0.14, 0.05, RIM, [90, 0, 0]),
    // front wheel
    cylinder16([0.25, 0.22, 0], 0.2, 0.04, TIRE, [90, 0, 0]),
    cylinder16([0.25, 0.22, 0], 0.14, 0.05, RIM, [90, 0, 0]),
    // main frame tubes
    box([0, 0.35, 0], [0.55, 0.02, 0.02], FRAME, [0, 0, -18]), // top tube
    box([-0.12, 0.25, 0], [0.35, 0.02, 0.02], FRAME, [0, 0, 65]), // seat tube
    box([0.05, 0.22, 0], [0.4, 0.02, 0.02], FRAME, [0, 0, 55]), // down tube
    // rear triangle
    box([-0.2, 0.15, 0], [0.2, 0.02, 0.02], FRAME, [0, 0, 75]),
    box([-0.12, 0.22, 0], [0.28, 0.02, 0.02], FRAME, [0, 0, -10]),
    // front fork
    box([0.25, 0.32, 0], [0.02, 0.34, 0.02], FRAME, [0, 0, -22]),
    // seat
    box([-0.12, 0.48, 0], [0.14, 0.05, 0.1], SEAT),
    // handlebars
    box([0.25, 0.52, 0], [0.08, 0.02, 0.28], HANDLE),
    box([0.23, 0.48, 0], [0.02, 0.08, 0.02], HANDLE),
    // pedals / crank
    box([0, 0.22, 0], [0.06, 0.06, 0.02], RIM),
  ];
}
