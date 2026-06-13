import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';

export function posterParts(): PropPartSpec[] {
  return [
    box([0, 1.55, -0.02], [0.96, 1.36, 0.015], hx('#3a3a3a')),
    // the poster sheet — image target (req_0635 "basically just a flat")
    panel('face', [0, 1.55, -0.035], [0.9, 1.3, 0.012], hx('#3f7d8a')),
  ];
}
