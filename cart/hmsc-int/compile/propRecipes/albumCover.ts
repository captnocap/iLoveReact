import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const albumCoverDef: PropKindDefinition = {
  kind: 'albumCover',
  label: 'Album Cover',
  // A standing record sleeve; the cover is an image target (req_0635).
  solid: false,
  footprintRadiusMeters: 0.19,
  heightMeters: 0.37,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
};

export function albumCoverParts(): PropPartSpec[] {
  return [
    // the sleeve, standing with a lean — its face IS the prop (req_0635)
    panel('cover', [0, 0.18, 0], [0.36, 0.36, 0.025], hx('#7a4a8a'), [-8, 0, 0]),
    box([0, 0.02, 0.02], [0.36, 0.03, 0.05], hx('#4a2a55')),
  ];
}
