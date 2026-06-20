// editors/model/studio/scene/staging.tsx — the Scene3D staging + the gizmo drag
// readout, lifted VERBATIM from editors/model/Studio.tsx (req_1390).
//
// A ground grid + origin axes as Scene3D content (these graduate to host-rendered,
// screen-stable overlays in Part 4b; for the hot-reload first slice they are thin
// Scene3D boxes), plus DragReadout — the self-ticking, ref-driven gizmo step tooltip.
// No behavior change.

import { useMemo } from 'react';
import { Box, Scene3D, Text } from '@reactjit/primitives';
import { useInterval, useRerender } from '@reactjit/hooks';
import { STUDIO, type Vec3 } from '../config';
import { makeProjector, type CameraSnap } from '../../meshSelect';
import type { V3 as MV3 } from '../../editMesh';

export function GroundGrid() {
  const lines = useMemo(() => {
    const out: { key: string; pos: Vec3; size: Vec3; color: string }[] = [];
    const tiles = STUDIO.gridTiles;
    const tile = STUDIO.tileMeters;
    const total = tiles * tile;
    const half = total / 2;
    const lift = STUDIO.gridLiftMeters;
    const bw = STUDIO.gridLineMeters;
    const fw = STUDIO.fineLineMeters;
    const big = '#41526e';
    const fine = '#283648';
    for (let i = 0; i <= tiles; i += 1) {
      const p = -half + i * tile;
      out.push({ key: `bx${i}`, pos: [p, lift, 0], size: [bw, bw, total], color: big });
      out.push({ key: `bz${i}`, pos: [0, lift, p], size: [total, bw, bw], color: big });
    }
    const c = tile / 2;
    const step = tile / STUDIO.fineDivisions;
    for (let i = 1; i < STUDIO.fineDivisions; i += 1) {
      const p = -c + i * step;
      out.push({ key: `fx${i}`, pos: [p, lift, 0], size: [fw, fw, tile], color: fine });
      out.push({ key: `fz${i}`, pos: [0, lift, p], size: [tile, fw, fw], color: fine });
    }
    return out;
  }, []);
  return (
    <>
      {lines.map((l) => (
        <Scene3D.Mesh key={l.key} geometry={Geom.box} params={{ width: l.size[0], height: l.size[1], depth: l.size[2] }} material={{ color: l.color, opacity: 0.85 }} position={l.pos} />
      ))}
    </>
  );
}

export function OriginAxes() {
  const len = STUDIO.axisLengthMeters;
  const th = STUDIO.axisThicknessMeters;
  const half = len / 2;
  return (
    <>
      <Scene3D.Mesh geometry={Geom.box} params={{ width: len, height: th, depth: th }} material="#e0584e" position={[half, 0, 0]} />
      <Scene3D.Mesh geometry={Geom.box} params={{ width: th, height: len, depth: th }} material="#5ec26a" position={[0, half, 0]} />
      <Scene3D.Mesh geometry={Geom.box} params={{ width: th, height: th, depth: len }} material="#4aa3ff" position={[0, 0, half]} />
    </>
  );
}

// A minimal box geometry def (a unit cube) for the staging lines/axes.
const Geom = { box: require('@reactjit/geometries').Box };

// HOST-OWNED DRAG readout (req_1270): a self-ticking tooltip for the gizmo move
// step amount. The gizmo drag streams to the host with ZERO setState, so the
// readout can't come from React state — it reads the live text + grab anchor from
// refs and re-projects every 33ms, exactly like SelectionOverlay. Mounted only
// while a gizmo drag is active (rig/loop-cut keep the inline state readout).
export function DragReadout(props: { textRef: { current: string | null }; anchorRef: { current: MV3 | null }; camSnap: () => CameraSnap }) {
  const repaint = useRerender();
  useInterval(repaint, 33);
  const text = props.textRef.current;
  const anchor = props.anchorRef.current;
  if (!text || !anchor) return null;
  const p = makeProjector(props.camSnap())(anchor);
  if (!p.front) return null;
  return (
    <Box style={{ position: 'absolute', left: p.x + 14, top: p.y - 34, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#0b1320ee', borderWidth: 1, borderColor: '#5b8fd6', pointerEvents: 'none' }}>
      <Text fontSize={11} color="#cfe2ff" style={{ fontFamily: 'monospace', fontWeight: '800' }}>{text}</Text>
    </Box>
  );
}
