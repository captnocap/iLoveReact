// propParts — a prop's texturable PARTS (render3d/parts.tsx Part[]).
//
// The prop twin of buildingParts: the describe side of the click-to-pick texture
// flow for props. Each prop model exports its own *Parts(prop); this dispatches by
// kind. A prop with no entry returns [] — it renders its own bespoke meshes and
// offers no texture targets yet (Stage 2 rolls the rest of render3d/props/* in).

import type { WorldProp } from '../design';
import type { Part } from './parts';
import { streetSignParts } from './props/StreetSign';
import { dataPropParts } from './props/DataProp';

export function propParts(prop: WorldProp): Part[] {
  switch (prop.kind) {
    case 'streetSign': return streetSignParts(prop);
    // PROPBATCH-0611: data-recipe kinds describe themselves — their image
    // panels (album cover, poster, vending front…) become pick/texture
    // targets; everything else returns [].
    default: return dataPropParts(prop);
  }
}
