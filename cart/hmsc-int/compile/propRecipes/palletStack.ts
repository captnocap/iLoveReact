import { box, WOOD, WOOD_DARK, WOOD_PALE, type PropPartSpec } from '../../game/kinds/propModels';

export function palletStackParts(): PropPartSpec[] {
  const parts: PropPartSpec[] = [];
  const jitter = [0.03, -0.04, 0.02, -0.02, 0.04, 0];
  for (let i = 0; i < 6; i += 1) {
    const y = 0.08 + i * 0.165;
    parts.push(box([jitter[i], y, jitter[5 - i]], [1.2, 0.07, 1.2], i % 2 === 0 ? WOOD_PALE : WOOD));
    parts.push(box([jitter[i], y - 0.06, jitter[5 - i]], [1.1, 0.06, 0.1], WOOD_DARK));
  }
  return parts;
}
