// neonLogoDouble — the double-sided NEON SIGN (req_0893, ask #2). Owns its def;
// the panel geometry (and the single-sided sibling) live in ./neonLogo.

import { type PropPartSpec } from '../../game/kinds/propModels';
import { neonPanelParts } from './neonLogo';

export { neonLogoDoubleDef } from './neonLogo';

export function neonLogoDoubleParts(): PropPartSpec[] {
  return neonPanelParts(true);
}
