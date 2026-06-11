import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at } from './place';
import { STREET_SIGN_TEXTURE_KEY } from './signFace';
import { type Part, TexturedParts } from '../parts';

// A street guide sign: a slim pole carrying a green reflective panel. The panel
// is the billboard_demo pattern — a THIN box whose face samples a 2D Box+Text
// capture (see signFace + PropCaptures), so the sign's lettering is real UI
// baked onto the mesh, not painted geometry. The panel faces -Z at yaw 0.
//
// Pole / base / panel are PARTS (render3d/parts.tsx), so the click-to-pick
// inspector can re-skin any of them. The panel's UNTEXTURED look is itself a
// texture (the route plate), carried as defaultTextureKey; an applied texture
// overrides it. Its capture stays mounted by PropCaptures (the default key), so
// only an override needs a part bucket.

const POLE = '#9aa1ab';
const POLE_DARK = '#6c727b';

export function streetSignParts(prop: WorldProp): Part[] {
  const yaw = prop.yawDegrees;
  const height = propKindDefinition(prop.kind).heightMeters;
  const panelTop = height - 0.1;
  return [
    {
      id: 'base', label: 'Base', geometry: 'Cylinder', params: { radius: 0.14, height: 0.12, segments: 10 },
      position: at(prop, [0, 0.06, 0]), material: POLE_DARK,
    },
    {
      id: 'pole', label: 'Pole', geometry: 'Cylinder', params: { radius: 0.05, height, segments: 10 },
      position: at(prop, [0, height / 2, 0]), material: POLE,
    },
    {
      // Only the two broad faces carry the route name; the four thin edges (0.03 m)
      // pin to the capture's green corner instead of cramping the texture onto them.
      id: 'panel', label: 'Sign panel', geometry: 'Box', params: { width: 1.5, height: 0.44, depth: 0.03 },
      texturedFaces: ['front', 'back'], defaultTextureKey: STREET_SIGN_TEXTURE_KEY,
      tex: { cols: 3, floors: 1 }, material: '#ffffff',
      position: at(prop, [0, panelTop - 0.22, -0.04]), rotation: [0, yaw, 0],
    },
  ];
}

export function StreetSign(props: { prop: WorldProp }) {
  return <TexturedParts parts={streetSignParts(props.prop)} textures={props.prop.partTextures} />;
}
