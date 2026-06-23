import { box, cylinder16, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const streetLightVintageDef: PropKindDefinition = {
  kind: 'streetLightVintage',
  label: 'Vintage Street Light',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 3.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const BLACK = hx('#1a1c1e');
const DARK = hx('#3a3f46');
const GLASS = hx('#e8d896');

export function streetLightVintageParts(): PropPartSpec[] {
  return [
    // base mounting
    cylinder16([0, 0.06, 0], 0.22, 0.12, BLACK),
    // main pole (tapered look via stacked cylinders)
    cylinder16([0, 0.8, 0], 0.14, 1.5, BLACK),
    cylinder16([0, 2.1, 0], 0.11, 1.2, BLACK),
    // decorative collar
    cylinder16([0, 1.55, 0], 0.16, 0.08, DARK),
    // top arm / crossbar
    box([0, 3.0, 0], [0.8, 0.06, 0.1], BLACK, [0, 0, -5]),
    // hanging lantern support
    cylinder16([0.35, 2.95, 0], 0.015, 0.15, BLACK),
    cylinder16([-0.35, 2.95, 0], 0.015, 0.15, BLACK),
    // lantern housings
    cylinder16([0.35, 2.82, 0], 0.08, 0.12, BLACK),
    cylinder16([-0.35, 2.82, 0], 0.08, 0.12, BLACK),
    // glowing glass panes
    panel('lightR', [0.35, 2.82, 0], [0.12, 0.12, 0.12], GLASS),
    panel('lightL', [-0.35, 2.82, 0], [0.12, 0.12, 0.12], GLASS),
    // lantern tops
    cylinder16([0.35, 2.9, 0], 0.09, 0.04, DARK),
    cylinder16([-0.35, 2.9, 0], 0.09, 0.04, DARK),
    // finials
    cylinder16([0.35, 3.0, 0], 0.02, 0.06, BLACK),
    cylinder16([-0.35, 3.0, 0], 0.02, 0.06, BLACK),
  ];
}
