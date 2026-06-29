// buildArmed — what's armed to place in the iso build map, and the toggle-off
// equality test. Its OWN module (req_1967): this type + helper are shared by the
// map (LoaderIsoView), the rail (CatalogRail), and the properties panel, so they
// must not hide inside any one component's file (that's exactly how the duplicated
// drag-paint gate slipped past — a grab-bag component file exporting shared bits).

import type { BuildSkinSet } from './game';

// A placed piece's paintable LOOK — face skins (a wall/floor's front/back/sides)
// and/or per-part textures (a prop's named parts). Copied off one piece and
// stamped onto others by the skin brush (req_2077: "copy the skin… then paint it"),
// so it's geometry-blind: a wall copy carries `skin`, a prop copy carries
// `partTextures`, and the stamp picks whichever the target can wear.
export interface PieceLook {
  skin?: BuildSkinSet;
  partTextures?: Record<string, string>;
}

// A single catalog PIECE, a PREFAB (a named composition that stamps into many
// pieces), the TOWER tool (req_0478: drag a footprint → a hollow multi-storey
// shell), a WATER body, or the SKIN brush (req_2077: hold a copied look and stamp
// it onto pieces by clicking). null = nothing armed (pan/select mode).
export type Armed =
  | { kind: 'piece' | 'prefab'; id: string }
  | { kind: 'tower' }
  | { kind: 'water'; id: string }
  | { kind: 'skin'; look: PieceLook }
  | null;

/** the same tool armed twice = a toggle-off (rail chips re-click to disarm) */
export function sameArmed(cur: Armed, next: NonNullable<Armed>): boolean {
  if (!cur || cur.kind !== next.kind) return false;
  if (cur.kind === 'tower' || next.kind === 'tower') return true;
  // A skin brush carries a fresh copy, not an id — re-copying always REPLACES the
  // held look rather than toggling the brush off.
  if (cur.kind === 'skin' || next.kind === 'skin') return false;
  return cur.id === next.id;
}
