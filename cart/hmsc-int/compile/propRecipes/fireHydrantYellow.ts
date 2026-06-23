import { box, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fireHydrantYellowDef: PropKindDefinition = {
  kind: 'fireHydrantYellow',
  label: 'Yellow Fire Hydrant',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
};

const YELLOW = hx('#e8b84a');
const YELLOW_DARK = hx('#c79a35');
const SILVER = hx('#9aa1ab');
const DARK = hx('#3a3f46');

export function fireHydrantYellowParts(): PropPartSpec[] {
  return [
    // base flange
    cylinder16([0, 0.05, 0], 0.2, 0.1, YELLOW_DARK),
    // main barrel
    cylinder16([0, 0.36, 0], 0.16, 0.52, YELLOW),
    // top dome
    cylinder16([0, 0.66, 0], 0.12, 0.12, YELLOW_DARK),
    cylinder16([0, 0.74, 0], 0.07, 0.04, YELLOW),
    // side nozzles (left and right)
    cylinder16([-0.18, 0.38, 0], 0.045, 0.12, SILVER, [0, 0, 90]),
    cylinder16([0.18, 0.38, 0], 0.045, 0.12, SILVER, [0, 0, 90]),
    // nozzle caps
    cylinder16([-0.24, 0.38, 0], 0.055, 0.04, DARK, [0, 0, 90]),
    cylinder16([0.24, 0.38, 0], 0.055, 0.04, DARK, [0, 0, 90]),
    // front pumper nozzle (larger)
    cylinder16([0, 0.32, 0.18], 0.055, 0.14, SILVER, [90, 0, 0]),
    cylinder16([0, 0.32, 0.25], 0.065, 0.04, DARK, [90, 0, 0]),
    // operating nut on top front
    box([0, 0.62, 0.1], [0.05, 0.05, 0.05], DARK, [45, 0, 0]),
  ];
}
