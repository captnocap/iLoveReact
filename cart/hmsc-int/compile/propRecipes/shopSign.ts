import { box, hx, METAL, panel, STEEL_DARK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function shopSignParts(): PropPartSpec[] {
  const h = propKindDefinition('shopSign').heightMeters;
  return [
    box([0, h - 0.1, -0.4], [0.07, 0.07, 0.85], METAL),
    box([0, h - 0.32, -0.62], [0.02, 0.4, 0.02], STEEL_DARK),
    box([0, h - 0.32, -0.42], [0.02, 0.4, 0.02], STEEL_DARK),
    // the hanging blade — image target
    panel('face', [0, h - 0.78, -0.52], [0.78, 0.52, 0.04], hx('#7a4a8a')),
  ];
}
