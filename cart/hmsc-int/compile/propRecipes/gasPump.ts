import { box, CONCRETE, cylinder8, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function gasPumpParts(): PropPartSpec[] {
  const s = propKindDefinition('gasPump').heightMeters / 2.1;
  const cream = hx('#e8e4da');
  const red = hx('#c1272d');
  return [
    box([0, 0.05 * s, 0], [0.8 * s, 0.1 * s, 0.5 * s], CONCRETE),
    box([0, 0.72 * s, 0], [0.62 * s, 1.25 * s, 0.42 * s], cream),
    box([0, 1.1 * s, -0.21 * s], [0.5 * s, 0.5 * s, 0.02 * s], NEAR_BLACK),
    box([0, 1.45 * s, 0], [0.64 * s, 0.18 * s, 0.44 * s], red),
    box([0, 1.58 * s, 0], [0.68 * s, 0.12 * s, 0.46 * s], cream),
    cylinder8([0.34 * s, 0.95 * s, 0], 0.03 * s, 0.75 * s, NEAR_BLACK, [0, 0, 14]),
    box([0.38 * s, 0.52 * s, 0], [0.09 * s, 0.2 * s, 0.09 * s], red),
  ];
}
