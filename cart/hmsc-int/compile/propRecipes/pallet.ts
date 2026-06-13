import { box, WOOD_DARK, WOOD_PALE, type PropPartSpec } from '../../game/kinds/propModels';

export function palletParts(): PropPartSpec[] {
  const parts: PropPartSpec[] = [];
  for (const z of [-0.5, 0, 0.5]) parts.push(box([0, 0.045, z], [1.2, 0.08, 0.1], WOOD_DARK));
  for (let i = 0; i < 5; i += 1) parts.push(box([(i - 2) * 0.27, 0.12, 0], [0.2, 0.05, 1.2], WOOD_PALE));
  return parts;
}
