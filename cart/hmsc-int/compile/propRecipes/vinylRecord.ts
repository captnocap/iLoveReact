import { cylinder8, cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';

export function vinylRecordParts(): PropPartSpec[] {
  return [
    cylinder16([0, 0.02, 0], 0.18, 0.015, hx('#111214')),
    cylinder8([0, 0.032, 0], 0.05, 0.012, hx('#d8762a')),
  ];
}
