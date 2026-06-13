import { box, hx, NEAR_BLACK, panel, STEEL, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function sodaMachineParts(): PropPartSpec[] {
  const s = propKindDefinition('sodaMachine').heightMeters / 1.7;
  const body = hx('#c1272d');
  return [
    box([0, 0.8 * s, 0], [0.8 * s, 1.6 * s, 0.6 * s], body),
    // the brandable front — image target
    panel('front', [0, 1.15 * s, -0.305 * s], [0.7 * s, 0.7 * s, 0.02 * s], hx('#8e1d22')),
    box([-0.2 * s, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
    box([0, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
    box([0.2 * s, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
    box([0, 0.3 * s, -0.28 * s], [0.6 * s, 0.05 * s, 0.12 * s], STEEL),
  ];
}
