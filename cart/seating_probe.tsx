// seating_probe — PROVES the face-rig seating engine (req_1930 / req_2028-2030)
// on the cases that matter: a BOOTH (one rigged seat face → several figures side
// by side, all facing out) and a BED (seat+head faces → figures LYING down).
//
// Everything comes from deriveSeatFromFaces: capacity from the seat face length,
// facing from the back/head faces, sit-vs-lay from whether a head is tagged. Each
// occupant is placed by seatTransformForPin — the same solver the chair uses.
//
// Verify:  ./tools/rjit shot seating_probe --out /tmp/seating.png --frames 24

import { useMemo } from 'react';
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { FigureMeshes, buildPartRender } from './hmsc-int/game/figure/render';
import { buildRigFrame } from './hmsc-int/game/figure/rig';
import { generateFace, hedDepthGrid } from './hmsc-int/game/figure/hed';
import {
  deriveSeatFromFaces, seatTransformForPin, SIT_ACTIONS, LAY_ACTIONS,
  type PlacedProp, type RiggedFace, type SeatBodyPart,
} from './hmsc-int/game/figure/seating';

type V3 = [number, number, number];
const SEED = 7;
const CART_KEY = 'seating_probe';

// face builders (same as the unit test): a horizontal seat/mattress face, and a
// vertical backrest/headboard face — in PROP-LOCAL meters (ground anchor origin).
function horizFace(bodyPart: SeatBodyPart, cx: number, cz: number, h: number, w: number, d: number): RiggedFace {
  return { bodyPart, verts: [[cx - w / 2, h, cz - d / 2], [cx + w / 2, h, cz - d / 2], [cx + w / 2, h, cz + d / 2], [cx - w / 2, h, cz + d / 2]] };
}
function vertFace(bodyPart: SeatBodyPart, cx: number, cz: number, h: number, ht: number, w: number): RiggedFace {
  return { bodyPart, verts: [[cx - w / 2, h, cz], [cx + w / 2, h, cz], [cx + w / 2, h + ht, cz], [cx - w / 2, h + ht, cz]] };
}

// a furniture box drawn in the prop's local frame, then world-placed by the prop.
function localBox(prop: PlacedProp, cx: number, cy: number, cz: number, w: number, h: number, d: number, color: string, key: string) {
  return <Scene3D.Mesh key={key} geometry={Geometry.Box} params={{ width: w, height: h, depth: d }}
    position={[prop.position[0] + cx, prop.position[1] + cy, prop.position[2] + cz]} rotation={[0, prop.yawDegrees, 0]} material={color} />;
}

// BOOTH: a 2.2m bench (seat face on top) + a backrest behind → ~4 sit slots.
const BOOTH: PlacedProp = { position: [-2.4, 0, 0], yawDegrees: 0 };
const BOOTH_FACES: RiggedFace[] = [horizFace('seat', 0, 0, 0.45, 2.2, 0.5), vertFace('back', 0, 0.25, 0.45, 0.5, 2.2)];

// BED: a 1.4×2.0 mattress (seat face) + a pillow/headboard (head face) → lay, 2 across.
const BED: PlacedProp = { position: [2.8, 0, 0], yawDegrees: 0 };
const BED_FACES: RiggedFace[] = [horizFace('seat', 0, 0, 0.5, 1.4, 2.0), horizFace('back', 0, 0, 0.5, 1.4, 2.0), vertFace('head', 0, -1.0, 0.5, 0.4, 1.4)];

export default function SeatingProbe() {
  const doc = useMemo(() => generateFace(SEED), []);
  const parts = useMemo(() => buildPartRender(doc, hedDepthGrid(doc), CART_KEY, SEED), [doc]);
  const sitRig = useMemo(() => buildRigFrame('neutral', 'stand', 0, [...SIT_ACTIONS]), []);
  const layRig = useMemo(() => buildRigFrame('neutral', 'stand', 0, [...LAY_ACTIONS]), []);

  const booth = useMemo(() => deriveSeatFromFaces(BOOTH_FACES)!, []);
  const bed = useMemo(() => deriveSeatFromFaces(BED_FACES)!, []);

  const occupant = (prop: PlacedProp, seat: ReturnType<typeof deriveSeatFromFaces>, key: string) =>
    seat!.pins.map((pin, i) => {
      const t = seatTransformForPin(pin, seat!.seatHeightMeters, seat!.pose, prop, 'neutral');
      return <FigureMeshes key={`${key}-${i}`} rig={seat!.pose === 'lay' ? layRig : sitRig} parts={parts} yawDeg={t.yawDeg} lift={t.lift} offset={t.offset} intern />;
    });

  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#1b2533" showAxes={false}>
        <Scene3D.Camera position={[0.4, 3.4, 7.2]} target={[0.2, 0.5, 0]} fov={52} far={400} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.85} />
        <Scene3D.DirectionalLight direction={[-0.4, -1, -0.35]} color="#fff6e0" intensity={0.7} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 14, height: 0.4, depth: 10 }} material="#2a3647" position={[0, -0.2, 0]} />

        {/* booth: bench seat block + backrest */}
        {localBox(BOOTH, 0, 0.225, 0, 2.3, 0.45, 0.55, '#7a4a2e', 'booth-seat')}
        {localBox(BOOTH, 0, 0.7, 0.28, 2.3, 0.55, 0.12, '#8a5a38', 'booth-back')}
        {occupant(BOOTH, booth, 'booth')}

        {/* bed: mattress + pillow */}
        {localBox(BED, 0, 0.25, 0, 1.5, 0.5, 2.1, '#3a4a6a', 'bed-mattress')}
        {localBox(BED, 0, 0.56, -0.9, 1.3, 0.16, 0.32, '#c8d0e0', 'bed-pillow')}
        {occupant(BED, bed, 'bed')}
      </Scene3D>
    </Box>
  );
}
