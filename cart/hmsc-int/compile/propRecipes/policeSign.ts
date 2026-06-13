import { box, cylinder8, hx, WHITE, type PropPartSpec } from '../../game/kinds/propModels';

export function policeSignParts(): PropPartSpec[] {
  return [
    box([0, 2.7, -0.05], [2.4, 0.7, 0.1], hx('#16365c')),
    box([0.2, 2.7, -0.11], [1.4, 0.3, 0.02], WHITE),
    cylinder8([-0.85, 2.7, -0.11], 0.2, 0.03, hx('#d8b23a'), [90, 0, 0]),
  ];
}
