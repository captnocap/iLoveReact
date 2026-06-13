import { box, cylinder8, hx, STEEL, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function toiletPaperParts(): PropPartSpec[] {
  const h = propKindDefinition('toiletPaper').heightMeters;
  return [
    box([0, h - 0.04, -0.05], [0.16, 0.04, 0.1], STEEL),
    cylinder8([0, h - 0.12, -0.12], 0.07, 0.13, WHITE, [0, 0, 90]),
    box([0, h - 0.21, -0.18], [0.1, 0.16, 0.012], hx('#e2e4e6')),
  ];
}
