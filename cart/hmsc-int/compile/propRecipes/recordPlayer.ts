import { box, cylinder8, cylinder16, hx, NEAR_BLACK, STEEL, WOOD, type PropPartSpec } from '../../game/kinds/propModels';

export function recordPlayerParts(): PropPartSpec[] {
  return [
    box([0, 0.07, 0], [0.5, 0.14, 0.4], WOOD),
    cylinder16([-0.03, 0.16, 0], 0.16, 0.035, NEAR_BLACK),
    cylinder16([-0.03, 0.185, 0], 0.15, 0.012, hx('#111214')),
    cylinder8([-0.03, 0.2, 0], 0.045, 0.014, hx('#c14d4d')),
    box([0.19, 0.18, 0.08], [0.025, 0.02, 0.2], STEEL, [0, -25, 0]),
  ];
}
