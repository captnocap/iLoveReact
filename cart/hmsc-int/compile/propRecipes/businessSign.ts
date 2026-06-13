import { box, hx, panel, WOOD_DARK, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const businessSignDef: PropKindDefinition = {
  kind: 'businessSign',
  label: 'A-Frame Sign',
  // The sidewalk sandwich board in front of a business; face takes an image.
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function businessSignParts(): PropPartSpec[] {
  const cream = hx('#f4f1e8');
  return [
    box([0, 0.53, -0.13], [0.66, 1.06, 0.04], cream, [-12, 0, 0]),
    box([0, 0.53, 0.13], [0.66, 1.06, 0.04], hx('#d8d2c2'), [12, 0, 0]),
    box([0, 1.05, 0], [0.66, 0.05, 0.1], WOOD_DARK),
    // the sandwich-board face — image target
    panel('face', [0, 0.56, -0.155], [0.56, 0.82, 0.012], hx('#2e6fb0'), [-12, 0, 0]),
  ];
}
