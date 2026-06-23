import { box, cylinder8, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const campfireDef: PropKindDefinition = {
  kind: 'campfire',
  label: 'Campfire',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
};

const STONE = hx('#6b7079');
const LOG = hx('#6b4a2e');
const ASH = hx('#3a3f46');
const EMBER = hx('#e8702a');
const COAL = hx('#1a1c1e');

export function campfireParts(): PropPartSpec[] {
  return [
    // ash bed
    cylinder8([0, 0.02, 0], 0.28, 0.04, ASH),
    // ring of stones
    cylinder8([0.28, 0.04, 0], 0.06, 0.06, STONE),
    cylinder8([0.2, 0.04, 0.2], 0.06, 0.06, STONE),
    cylinder8([0, 0.04, 0.28], 0.06, 0.06, STONE),
    cylinder8([-0.2, 0.04, 0.2], 0.06, 0.06, STONE),
    cylinder8([-0.28, 0.04, 0], 0.06, 0.06, STONE),
    cylinder8([-0.2, 0.04, -0.2], 0.06, 0.06, STONE),
    cylinder8([0, 0.04, -0.28], 0.06, 0.06, STONE),
    cylinder8([0.2, 0.04, -0.2], 0.06, 0.06, STONE),
    // logs in teepee
    box([0, 0.1, 0], [0.06, 0.25, 0.06], LOG, [30, 0, 15]),
    box([0, 0.1, 0], [0.06, 0.25, 0.06], LOG, [30, 0, -15]),
    box([0, 0.1, 0], [0.06, 0.25, 0.06], LOG, [30, 90, 15]),
    box([0, 0.1, 0], [0.06, 0.25, 0.06], LOG, [30, 90, -15]),
    // embers / fire core
    sphere([0, 0.08, 0], [0.12, 0.12, 0.12], EMBER),
    sphere([0.04, 0.1, 0.03], [0.05, 0.08, 0.05], COAL),
  ];
}
