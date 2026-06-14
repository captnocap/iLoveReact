// neonLogo — a decal-faced NEON SIGN (req_0893, ask #2).
//
// The neon itself is a DECAL: author a glowing path in /compose (a DecalPathNode
// — paste a logo's SVG `d` or draw it with the pen), then skin this sign's face
// part with that material through the normal partTextures channel. The prop is
// just the mounting panel(s): ONE face for a single-sided sign, TWO back-to-back
// faces for a double-sided one (the user's "1 or 2 faced" ask). The dark backing
// makes the lit tube read; transparent areas of the decal fall to that backing.
//
// Two kinds share ONE panel builder (rule of two): neonLogo (single) and
// neonLogoDouble own their defs in their own files, both lowering through here.

import { box, panel, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

// A storefront logo sign — wide enough to read a name, mounted on a wall.
const NEON_WIDTH_METERS = 1.4;
const NEON_HEIGHT_METERS = 0.8;
const PANEL_DEPTH_METERS = 0.04;
// The dark housing the tubes sit against (unlit decal areas fall to this).
const BACKING = hx('#0a0a12');

export const neonLogoDef: PropKindDefinition = {
  kind: 'neonLogo',
  label: 'Neon Logo (1-sided)',
  solid: true,
  footprintRadiusMeters: 0.7,
  footprintDepthMeters: 0.05,
  heightMeters: NEON_HEIGHT_METERS,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export const neonLogoDoubleDef: PropKindDefinition = {
  kind: 'neonLogoDouble',
  label: 'Neon Logo (2-sided)',
  solid: true,
  footprintRadiusMeters: 0.7,
  footprintDepthMeters: 0.12,
  heightMeters: NEON_HEIGHT_METERS,
  tileKind: 'wall',
  trafficControl: 'none',
  // A blade sign hangs perpendicular off a wall so both faces show to passers-by.
  mount: 'wall',
  coverClass: 'none',
};

/** The neon sign's parts. `double` adds a second face on the back, rotated 180°
 *  so its decal reads from behind — the two faces are independent texture targets
 *  ('face' / 'faceBack'), so a sign can show the same logo or a different one each
 *  way. The face panels are thin so the decal's glow dominates the silhouette. */
export function neonPanelParts(double: boolean): PropPartSpec[] {
  const cy = NEON_HEIGHT_METERS / 2;
  const size: readonly [number, number, number] = [NEON_WIDTH_METERS, NEON_HEIGHT_METERS, 0.012];
  const parts: PropPartSpec[] = [
    // central dark housing (the board the tubes mount on)
    box([0, cy, 0], [NEON_WIDTH_METERS, NEON_HEIGHT_METERS, PANEL_DEPTH_METERS], BACKING),
    // front face — the neon decal target
    panel('face', [0, cy, PANEL_DEPTH_METERS / 2 + 0.006], size, BACKING),
  ];
  if (double) {
    // back face: pushed to the rear and yawed 180° so its decal faces -Z.
    parts.push(panel('faceBack', [0, cy, -(PANEL_DEPTH_METERS / 2 + 0.006)], size, BACKING, [0, 180, 0]));
  }
  return parts;
}

export function neonLogoParts(): PropPartSpec[] {
  return neonPanelParts(false);
}
