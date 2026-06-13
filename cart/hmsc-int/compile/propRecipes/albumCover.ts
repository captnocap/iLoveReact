import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';

export function albumCoverParts(): PropPartSpec[] {
  return [
    // the sleeve, standing with a lean — its face IS the prop (req_0635)
    panel('cover', [0, 0.18, 0], [0.36, 0.36, 0.025], hx('#7a4a8a'), [-8, 0, 0]),
    box([0, 0.02, 0.02], [0.36, 0.03, 0.05], hx('#4a2a55')),
  ];
}
