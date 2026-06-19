// editors/model/studio/overlays/ViewCompass.tsx — the view-orientation compass
// (the navigation gizmo — req_0969, playbook 4b#1). Lifted verbatim from
// editors/model/Studio.tsx (req_1390), with its private vec math.
//
// A corner widget that always shows the camera's orientation (the ±X/Y/Z axis
// ends projected through the live view basis) and snaps the view to face an axis
// when you click its ball. A 2D projection of the camera basis for now (hot-
// reload); it graduates to the host screen-stable overlay with the gizmo/grid.

import { Box, Pressable, Text } from '@reactjit/primitives';
import { useInterval, useRerender } from '@reactjit/hooks';

const DEG = Math.PI / 180;
type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const COMPASS = { size: 78, radius: 25, posR: 9, negR: 6 } as const;
// the 6 axis ends. faceYaw/facePitch = orbit angles that look ALONG this axis
// (camera on that side, looking at the origin). NaN yaw = a pole → keep current
// yaw. Convention from camera.zig orbitalEye: yaw=atan2(-ox,-oz), pitch=asin(oy).
const COMPASS_AXES: { key: string; dir: V3; color: string; label: string; pos: boolean; faceYaw: number; facePitch: number }[] = [
  { key: '+x', dir: [1, 0, 0], color: '#e0584e', label: 'X', pos: true, faceYaw: -90, facePitch: 0 },
  { key: '-x', dir: [-1, 0, 0], color: '#e0584e', label: '', pos: false, faceYaw: 90, facePitch: 0 },
  { key: '+y', dir: [0, 1, 0], color: '#5ec26a', label: 'Y', pos: true, faceYaw: NaN, facePitch: 89.9 },
  { key: '-y', dir: [0, -1, 0], color: '#5ec26a', label: '', pos: false, faceYaw: NaN, facePitch: -89.9 },
  { key: '+z', dir: [0, 0, 1], color: '#4aa3ff', label: 'Z', pos: true, faceYaw: 180, facePitch: 0 },
  { key: '-z', dir: [0, 0, -1], color: '#4aa3ff', label: '', pos: false, faceYaw: 0, facePitch: 0 },
];

export function ViewCompass(props: { lookRef: { current: { yaw: number; pitch: number } }; onFace: (yaw: number, pitch: number) => void }) {
  // Self-tick to mirror the camera live (the spin is host/ref-driven, so the
  // parent doesn't re-render). Isolated → never touches the Scene3D tree.
  const repaint = useRerender();
  useInterval(repaint, 33);

  const { yaw, pitch } = props.lookRef.current;
  const yr = yaw * DEG, pr = pitch * DEG;
  // forward = -eye_offset (camera.zig orbitalEye); right/up complete the basis.
  const F: V3 = [Math.sin(yr) * Math.cos(pr), -Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
  const R = norm3(cross3(F, [0, 1, 0]));
  const U = cross3(R, F);
  const c = COMPASS.size / 2;
  const ends = COMPASS_AXES.map((ax) => {
    const sx = dot3(ax.dir, R), sy = dot3(ax.dir, U), depth = dot3(ax.dir, F);
    return { ax, px: c + sx * COMPASS.radius, py: c - sy * COMPASS.radius, depth };
  }).sort((a, b) => b.depth - a.depth); // far first → near drawn on top

  return (
    <Box style={{ position: 'absolute', left: 14, bottom: 14, width: COMPASS.size, height: COMPASS.size, borderRadius: COMPASS.size / 2, backgroundColor: '#0b1320bb', borderWidth: 1, borderColor: '#27364a' }}>
      {ends.filter((e) => e.ax.pos).map((e) => {
        const dx = e.px - c, dy = e.py - c;
        const len = Math.hypot(dx, dy) || 0.001;
        const angle = Math.atan2(dy, dx) / DEG;
        return <Box key={`l${e.ax.key}`} style={{ position: 'absolute', left: (c + e.px) / 2 - len / 2, top: (c + e.py) / 2 - 1, width: len, height: 2, borderRadius: 1, backgroundColor: e.ax.color, opacity: 0.65, transform: { rotate: angle } }} />;
      })}
      <Box style={{ position: 'absolute', left: c - 3, top: c - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#d98a4a' }} />
      {ends.map((e) => {
        const r = e.ax.pos ? COMPASS.posR : COMPASS.negR;
        return (
          <Pressable key={e.ax.key} onPress={() => props.onFace(e.ax.faceYaw, e.ax.facePitch)} tooltip={`face ${e.ax.key}`} style={{ position: 'absolute', left: e.px - r, top: e.py - r, width: r * 2, height: r * 2 }}>
            <Box style={{ width: r * 2, height: r * 2, borderRadius: r, alignItems: 'center', justifyContent: 'center', backgroundColor: e.ax.pos ? e.ax.color : '#0b1320', borderWidth: e.ax.pos ? 0 : 2, borderColor: e.ax.color, opacity: e.ax.pos ? 1 : 0.62 }}>
              {e.ax.label ? <Text fontSize={9} color="#08101c" style={{ fontWeight: '800', fontFamily: 'monospace' }}>{e.ax.label}</Text> : null}
            </Box>
          </Pressable>
        );
      })}
    </Box>
  );
}
