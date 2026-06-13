import { box, cylinder8, cylinder16, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function speakerParts(): PropPartSpec[] {
  const h = propKindDefinition('speaker').heightMeters;
  return [
    box([0, h * 0.5, 0], [0.42, h, 0.35], hx('#23262a')),
    cylinder16([0, h * 0.32, -0.165], 0.14, 0.04, hx('#101113'), [90, 0, 0]),
    sphere([0, h * 0.32, -0.18], [0.1, 0.1, 0.05], hx('#34383d')),
    cylinder8([0, h * 0.75, -0.165], 0.06, 0.035, hx('#101113'), [90, 0, 0]),
  ];
}
