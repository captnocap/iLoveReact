// seating_probe — PROVES the contact-pin seating rig (req_1930, "ass to brass")
// end-to-end and on screen: a real figure SITS on a real prop because the
// solver landed its `seat` contact anchor on the prop's seat pin.
//
// The path under proof is the production one: propSeat/propSeatPin (the prop's
// seat height + pin) → seatTransformOnProp (game/figure/seating) → the exact
// { yawDeg, lift, offset } handed to <FigureMeshes>, the same editor-preview
// figure renderer the labs use. No bespoke posing — if the ass is on the chair,
// the rig works.
//
// Expect: a dressed figure seated on a dining chair, pelvis on the seat, facing
// out. Verify:  ./tools/rjit shot seating_probe --out /tmp/seating.png --frames 24

import { useMemo } from 'react';
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { FigureMeshes, buildPartRender } from './hmsc-int/game/figure/render';
import { buildRigFrame } from './hmsc-int/game/figure/rig';
import { generateFace, hedDepthGrid } from './hmsc-int/game/figure/hed';
import { seatTransformOnProp, SIT_ACTIONS } from './hmsc-int/game/figure/seating';
import { propSeat, propSeatPin } from './hmsc-int/game/kinds/props';
import { resolvePropParts } from './hmsc-int/compile/propRecipes/resolve';
import { cssColor, type PropPartSpec } from './hmsc-int/game/kinds/propModels';
import { at } from './hmsc-int/render3d/props/place';
import type { WorldProp } from './hmsc-int/design';

const CHAIR_KIND = 'diningChair';
const SEED = 7;
const CART_KEY = 'seating_probe';

// The placed prop the figure sits on — a dining chair at the origin, no yaw.
const chair: WorldProp = { id: 'probe-chair', kind: CHAIR_KIND, x: 0, y: 0, z: 0, yawDegrees: 0, createdByCommand: 'probe' };

// One PropPartSpec → one Scene3D mesh (the box/cylinder/sphere mapping DataProp
// uses; the chair is boxes, but keep the full mapping so any seat prop works).
function propMesh(spec: PropPartSpec, i: number) {
  const position = at(chair, [spec.local[0], spec.local[1], spec.local[2]]);
  const rotation: [number, number, number] = [spec.rotation?.[0] ?? 0, chair.yawDegrees + (spec.rotation?.[1] ?? 0), spec.rotation?.[2] ?? 0];
  let geometry: any = Geometry.Box;
  let params: any = { width: spec.size[0], height: spec.size[1], depth: spec.size[2] };
  let scale: [number, number, number] | undefined;
  if (spec.shape === 'cylinder8' || spec.shape === 'cylinder16') {
    geometry = Geometry.Cylinder;
    params = { radius: spec.size[0] / 2, height: spec.size[1], segments: spec.shape === 'cylinder8' ? 8 : 16 };
  } else if (spec.shape === 'sphere') {
    geometry = Geometry.Sphere;
    params = { radius: 0.5, segments: 10, rings: 7 };
    scale = [spec.size[0], spec.size[1], spec.size[2]];
  }
  return <Scene3D.Mesh key={`chair-${i}`} geometry={geometry} params={params} position={position} rotation={rotation} scale={scale} material={cssColor(spec.color)} opacity={spec.opacity} />;
}

export default function SeatingProbe() {
  const chairParts = useMemo(() => resolvePropParts(chair), []);
  // The dressed figure (the editor-preview path: face → part render → rig).
  const doc = useMemo(() => generateFace(SEED), []);
  const parts = useMemo(() => buildPartRender(doc, hedDepthGrid(doc), CART_KEY, SEED), [doc]);
  const rig = useMemo(() => buildRigFrame('neutral', 'stand', 0, [...SIT_ACTIONS]), []);

  // THE RIG: solve the transform that lands the figure's seat anchor on the pin.
  const t = useMemo(() => {
    const seat = propSeat(CHAIR_KIND)!;
    const pin = propSeatPin(CHAIR_KIND)!;
    return seatTransformOnProp({ seatHeightMeters: seat.seatHeightMeters, pin }, { position: [chair.x, chair.y, chair.z], yawDegrees: chair.yawDegrees }, 'neutral');
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%' }}>
      {/* CharacterCaptures (face/skin StaticSurface) is intentionally OMITTED:
          in a headless `rjit shot` it forces a "WxH" placeholder chip over the
          frame and adds nothing to a SEATING proof. The figure draws with plain
          fallback materials — what we're verifying is the pose + placement. */}
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#1b2533" showAxes={false}>
        {/* side-3/4 angle: the chair seat + legs read clearly under the seated figure */}
        <Scene3D.Camera position={[2.9, 1.15, -1.7]} target={[0, 0.55, 0]} fov={44} far={400} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.8} />
        <Scene3D.DirectionalLight direction={[-0.4, -1, -0.35]} color="#fff6e0" intensity={0.7} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8, height: 0.4, depth: 8 }} material="#2a3647" position={[0, -0.2, 0]} />
        {chairParts.map(propMesh)}
        <FigureMeshes rig={rig} parts={parts} yawDeg={t.yawDeg} lift={t.lift} offset={t.offset} intern />
      </Scene3D>
    </Box>
  );
}
