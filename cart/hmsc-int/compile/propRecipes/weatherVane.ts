import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const weatherVaneDef: PropKindDefinition = {
  kind: 'weatherVane',
  label: 'Weather Vane',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const STEEL = hx('#9aa1ab');
const DARK = hx('#3a3f46');
const COPPER = hx('#8a4a32');

export function weatherVaneParts(): PropPartSpec[] {
  return [
    // ground stake base
    cylinder8([0, 0.06, 0], 0.08, 0.12, DARK),
    // tall thin pole
    cylinder8([0, 0.6, 0], 0.015, 1.1, STEEL),
    // directional arrow horizontal bar
    box([0, 1.1, 0], [0.45, 0.02, 0.02], COPPER),
    // arrow head (pointing one way)
    box([0.22, 1.1, 0], [0.1, 0.06, 0.02], COPPER, [0, 0, -30]),
    box([0.22, 1.1, 0], [0.1, 0.06, 0.02], COPPER, [0, 0, 30]),
    // tail (other way)
    box([-0.2, 1.1, 0], [0.12, 0.08, 0.02], COPPER),
    // cardinal direction letters support (small vertical box)
    box([0, 1.05, 0], [0.04, 0.06, 0.04], DARK),
    // decorative ball at top
    cylinder8([0, 1.18, 0], 0.025, 0.04, COPPER),
  ];
}
