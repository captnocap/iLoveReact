import { box, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';

export function openSignParts(): PropPartSpec[] {
  return [
    box([0, 1.9, -0.025], [0.62, 0.34, 0.04], NEAR_BLACK),
    box([0, 1.9, -0.05], [0.5, 0.2, 0.015], hx('#ff4f6a')),
    box([0, 1.9, -0.055], [0.42, 0.12, 0.01], hx('#ffd9e0')),
  ];
}
