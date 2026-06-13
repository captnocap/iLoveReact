import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function loungeChairParts(): PropPartSpec[] {
  const len = propKindDefinition('loungeChair').footprintRadiusMeters * 2;
  const frame = hx('#e8e4da');
  const cushion = hx('#3a8fd8');
  return [
    box([-len * 0.1, 0.32, 0], [len * 0.74, 0.07, 0.58], cushion),
    box([len * 0.33, 0.5, 0], [len * 0.36, 0.07, 0.58], cushion, [0, 0, -38]),
    box([-len * 0.4, 0.18, -0.24], [0.06, 0.36, 0.05], frame),
    box([-len * 0.4, 0.18, 0.24], [0.06, 0.36, 0.05], frame),
    box([len * 0.18, 0.18, -0.24], [0.06, 0.36, 0.05], frame),
    box([len * 0.18, 0.18, 0.24], [0.06, 0.36, 0.05], frame),
    box([-len * 0.12, 0.27, 0], [len * 0.7, 0.04, 0.62], frame),
  ];
}
