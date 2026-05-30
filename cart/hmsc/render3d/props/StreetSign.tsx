import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at } from './place';
import { STREET_SIGN_TEXTURE_KEY } from './signFace';

// A street guide sign: a slim pole carrying a green reflective panel. The panel
// is the billboard_demo pattern — a THIN box whose face samples a 2D Box+Text
// capture (see signFace + PropCaptures), so the sign's lettering is real UI
// baked onto the mesh, not painted geometry. The panel faces -Z at yaw 0.

const POLE = '#9aa1ab';
const POLE_DARK = '#6c727b';

export function StreetSign(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const height = propKindDefinition(props.prop.kind).heightMeters;
  const panelTop = height - 0.1;
  return (
    <>
      {/* Pole + base */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.14, height: 0.12, segments: 10 }} material={POLE_DARK} position={at(props.prop, [0, 0.06, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05, height, segments: 10 }} material={POLE} position={at(props.prop, [0, height / 2, 0])} />
      {/* Guide panel — textured billboard face */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        // Only the two broad faces carry the route name; the four thin edges
        // (0.03 m) pin to the capture's green corner instead of cramping the
        // whole "HMSC AVE" texture onto them. See hmsc AGENTS.md "Textured boxes".
        params={{ width: 1.5, height: 0.44, depth: 0.03, texturedFaces: ['front', 'back'] }}
        material="#ffffff"
        textureKey={STREET_SIGN_TEXTURE_KEY}
        position={at(props.prop, [0, panelTop - 0.22, -0.04])}
        rotation={[0, yaw, 0]}
      />
    </>
  );
}
