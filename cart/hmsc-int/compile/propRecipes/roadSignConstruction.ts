import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignConstructionDef: PropKindDefinition = {
  kind: 'roadSignConstruction',
  label: 'Construction Sign',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const POST = hx('#8b6e2c');
const ORANGE = hx('#e8702a');
const BLACK = hx('#1a1c1e');

export function roadSignConstructionParts(): PropPartSpec[] {
  return [
    // post
    box([0, 0.7, 0], [0.06, 1.4, 0.06], POST),
    // diamond back plate (larger, black border)
    box([0, 1.55, 0], [0.55, 0.55, 0.05], BLACK, [0, 0, 45]),
    // diamond face (orange)
    box([0, 1.55, 0.02], [0.46, 0.46, 0.04], ORANGE, [0, 0, 45]),
    // black symbol panel (image target)
    panel('symbol', [0, 1.55, 0.05], [0.35, 0.35, 0.01], BLACK, [0, 0, 45]),
  ];
}
