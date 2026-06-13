import { box, glassBox, hx, STEEL, WOOD_DARK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function displayCaseParts(): PropPartSpec[] {
  const def = propKindDefinition('displayCase');
  const w = def.footprintRadiusMeters * 2;
  return [
    box([0, 0.27, 0], [w, 0.54, 0.7], WOOD_DARK),
    glassBox([0, 0.76, 0], [w - 0.02, 0.42, 0.66]),   // the real translucent glass pane (same as windows)
    box([0, 0.99, 0], [w, 0.04, 0.72], STEEL),
    box([-w * 0.25, 0.62, 0], [0.18, 0.12, 0.3], hx('#d8a23a')),
    box([w * 0.05, 0.61, 0.1], [0.14, 0.1, 0.2], hx('#7a4a8a')),
    box([w * 0.3, 0.62, -0.08], [0.16, 0.12, 0.24], hx('#56a85c')),
  ];
}
