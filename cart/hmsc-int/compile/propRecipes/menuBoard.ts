import { box, hx, NEAR_BLACK, panel, type PropPartSpec } from '../../game/kinds/propModels';

export function menuBoardParts(): PropPartSpec[] {
  return [
    box([0, 2.0, -0.03], [1.84, 0.94, 0.05], NEAR_BLACK),
    // the menu — image target
    panel('face', [0, 2.0, -0.06], [1.7, 0.8, 0.02], hx('#15314e')),
  ];
}
