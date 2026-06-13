import { box, cylinder8, hx, NEAR_BLACK, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function arcadeCabinetParts(): PropPartSpec[] {
  const s = propKindDefinition('arcadeCabinet').heightMeters / 2.0;
  const cab = hx('#3b2a5e');
  const trim = hx('#d83a6a');
  return [
    box([0, 0.09 * s, 0], [0.66 * s, 0.18 * s, 0.7 * s], NEAR_BLACK),
    box([0, 1.0 * s, 0.02 * s], [0.66 * s, 1.7 * s, 0.66 * s], cab),
    box([0, 1.9 * s, 0], [0.68 * s, 0.22 * s, 0.68 * s], trim),
    // the game's art — image target (the screen)
    panel('screen', [0, 1.38 * s, -0.345 * s], [0.56 * s, 0.5 * s, 0.03 * s], hx('#15314e'), [-6, 0, 0]),
    box([0, 1.0 * s, -0.4 * s], [0.6 * s, 0.09 * s, 0.32 * s], hx('#2a1e44'), [12, 0, 0]),
    cylinder8([-0.12 * s, 1.06 * s, -0.46 * s], 0.025 * s, 0.04 * s, hx('#c1272d'), [12, 0, 0]),
    cylinder8([0.1 * s, 1.06 * s, -0.46 * s], 0.025 * s, 0.04 * s, hx('#2e6fb0'), [12, 0, 0]),
  ];
}
