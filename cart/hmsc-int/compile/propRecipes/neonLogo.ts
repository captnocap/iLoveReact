// neonLogo — a decal-faced NEON SIGN (req_0893 #2; req_0915 floating tubes).
//
// The neon itself is a DECAL: paste a logo's SVG (game/textures/neon), then skin
// this sign's face with that material through partTextures. The prop is JUST a
// thin face panel — no board (req_0915: the user wanted only the glowing tubes,
// not a black rectangle). The decal ships a TRANSPARENT background, and the
// scene3d shader alpha-cuts empty texels, so the wall behind shows through and
// only the lit tubes float. The panel is SQUARE so a square-fit logo decal isn't
// stretched. ONE face for a 1-sided sign, TWO back-to-back for a 2-sided one.
//
// Two kinds share ONE panel builder (rule of two): neonLogo (single) and
// neonLogoDouble own their defs in their own files, both lowering through here.

import { panel, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

// Square so a fit-to-square logo decal maps without horizontal stretch.
const NEON_SIZE_METERS = 1.1;
const FACE_DEPTH_METERS = 0.012;
const FACE_GAP_METERS = 0.013; // back face offset for the 2-sided blade
// Shows ONLY on an un-skinned sign; a decal forces the material white so the
// logo's own colors read true (render3d/parts PartMesh whitens textured parts).
const BASE = hx('#0a0a12');

export const neonLogoDef: PropKindDefinition = {
  kind: 'neonLogo',
  label: 'Neon Logo (1-sided)',
  solid: true,
  footprintRadiusMeters: NEON_SIZE_METERS / 2,
  footprintDepthMeters: 0.05,
  heightMeters: NEON_SIZE_METERS,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export const neonLogoDoubleDef: PropKindDefinition = {
  kind: 'neonLogoDouble',
  label: 'Neon Logo (2-sided)',
  solid: true,
  footprintRadiusMeters: NEON_SIZE_METERS / 2,
  footprintDepthMeters: 0.06,
  heightMeters: NEON_SIZE_METERS,
  tileKind: 'wall',
  trafficControl: 'none',
  // A blade sign hangs perpendicular off a wall so both faces show to passers-by.
  mount: 'wall',
  coverClass: 'none',
};

/** The neon sign's parts — just the thin face panel(s), no board. `double` adds a
 *  second face on the back, yawed 180° so its decal reads from behind; the two are
 *  independent texture targets ('face' / 'faceBack') so each side can wear its own
 *  logo. Transparent decal texels are alpha-cut by the shader, so only the lit
 *  tubes show (req_0915 floating neon). */
export function neonPanelParts(double: boolean): PropPartSpec[] {
  const cy = NEON_SIZE_METERS / 2;
  const size: readonly [number, number, number] = [NEON_SIZE_METERS, NEON_SIZE_METERS, FACE_DEPTH_METERS];
  const parts: PropPartSpec[] = [
    panel('face', [0, cy, double ? FACE_GAP_METERS : 0], size, BASE),
  ];
  if (double) {
    parts.push(panel('faceBack', [0, cy, -FACE_GAP_METERS], size, BASE, [0, 180, 0]));
  }
  return parts;
}

export function neonLogoParts(): PropPartSpec[] {
  return neonPanelParts(false);
}
