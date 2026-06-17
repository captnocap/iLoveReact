// paint_on_3d_demo — painting ON the 3D model, the correct way. The sequel to
// triangle_mask_demo (which proved the per-pixel no-spill mask in flat 2D).
//
// THE CORRECTED MENTAL MODEL (what the Studio painter must become):
//   1. You paint on the 3D MODEL surface — click the model, a ray finds the face
//      and the point on it. You never paint "on the atlas" directly.
//   2. The atlas (the model's baked per-face texture) is READ-ONLY base. Paint is
//      a SEPARATE LAYER in the same surface space, composited OVER the base. Here
//      the base is the box's flat material (untouched) and the "paint layer" is the
//      projected grid + highlight drawn on top — erase it and the base is intact.
//   3. The grid is UNIFORM in MODEL-SURFACE space: one fixed world-space cell size
//      (CELL) on EVERY face. A bigger face just shows more cells; a thin face shows
//      fewer — never sliver cells. And because the grid lives in model space, camera
//      zoom never changes it (the camera auto-orbits AND zooms here to prove it).
//      This is the opposite of keying the grid to atlas texels, which gives sliver
//      cells on thin/slanted faces (the packed-atlas problem).
//   4. The mask is PER-FACE: the hovered cell clips to the hovered face and CANNOT
//      spill across a shared edge onto the perpendicular neighbour. Hover near a box
//      edge and watch the highlight stop dead at the edge.
//
// The grid/highlight is a 2D overlay projected through the SAME camera the host
// renders with (meshSelect.makeProjector replicates gpu/3d.zig), so it sits exactly
// on the rendered faces — the proven Studio overlay technique.
//
// Verify: ./tools/rjit shot paint_on_3d_demo --out /tmp/paint3d.png

import { useEffect, useRef, useState } from 'react';
import { Box, Scene3D, Text } from '@reactjit/runtime/primitives';
import { makeProjector, orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { screenRay } from './hmsc-int/editors/model/meshPaint';

type V3 = [number, number, number];

const SIZE = 620;
const FOV = 48;
const CELL = 0.3;            // grid cell size, in MODEL/WORLD units — uniform on every face
const PITCH = 20;            // camera elevation (deg)
const HX = 1.35, HY = 0.85, HZ = 0.85; // box half-extents (deliberately unequal faces)
const Geom = { box: (require('@reactjit/geometries') as any).Box };

// vec helpers
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Each box face as a planar rect in MODEL space: a min-corner + two in-plane axes
// (unit dir + world length) + outward normal. The grid steps along uDir/vDir.
type Face = { corner: V3; uDir: V3; uLen: number; vDir: V3; vLen: number; normal: V3 };
const FACES: Face[] = [
  { corner: [HX, -HY, -HZ], uDir: [0, 1, 0], uLen: 2 * HY, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [1, 0, 0] },   // +X
  { corner: [-HX, -HY, -HZ], uDir: [0, 1, 0], uLen: 2 * HY, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [-1, 0, 0] }, // -X
  { corner: [-HX, HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [0, 1, 0] },   // +Y
  { corner: [-HX, -HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 0, 1], vLen: 2 * HZ, normal: [0, -1, 0] }, // -Y
  { corner: [-HX, -HY, HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 1, 0], vLen: 2 * HY, normal: [0, 0, 1] },   // +Z
  { corner: [-HX, -HY, -HZ], uDir: [1, 0, 0], uLen: 2 * HX, vDir: [0, 1, 0], vLen: 2 * HY, normal: [0, 0, -1] }, // -Z
];

const facePoint = (f: Face, u: number, v: number): V3 => add(add(f.corner, mul(f.uDir, u)), mul(f.vDir, v));
const faceCenter = (f: Face): V3 => facePoint(f, f.uLen / 2, f.vLen / 2);

// camera as a pure function of the frame tick: spins in yaw, oscillates in distance
// (zoom) so "the grid stays the same size on the surface as the camera zooms" is visible.
function camAt(tick: number): CameraSnap {
  const yaw = tick * 0.5;
  const dist = 5.4 + 1.7 * Math.sin(tick * 0.018);
  const eye = orbitalEyeJS([0, 0, 0], yaw, PITCH, dist);
  return { eye, target: [0, 0, 0], fov: FOV, aspect: 1, w: SIZE, h: SIZE, near: 0.02 };
}

type Hover = { face: number; cu: number; cv: number } | null;

// raycast the cursor against the 6 faces; nearest FRONT-facing hit wins.
function pickFace(cam: CameraSnap, sx: number, sy: number): Hover {
  const { o, d } = screenRay(cam, sx, sy);
  let best: Hover = null;
  let bestT = Infinity;
  FACES.forEach((f, i) => {
    const denom = dot(d, f.normal);
    if (denom >= -1e-6) return;                 // only the front side (normal points out)
    const t = dot(sub(f.corner, o), f.normal) / denom;
    if (t <= 1e-3 || t >= bestT) return;
    const hit = add(o, mul(d, t));
    const rel = sub(hit, f.corner);
    const u = dot(rel, f.uDir), v = dot(rel, f.vDir);
    if (u < 0 || u > f.uLen || v < 0 || v > f.vLen) return;
    bestT = t;
    best = { face: i, cu: Math.floor(u / CELL), cv: Math.floor(v / CELL) };
  });
  return best;
}

type Proj = { x: number; y: number; front: boolean };

// a projected world-space segment, drawn as a rotated 1px-ish box
function Seg(props: { a: Proj; b: Proj; color: string; thick: number; opacity?: number }) {
  const { a, b } = props;
  if (!a.front || !b.front) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return <Box style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - props.thick / 2, width: len, height: props.thick, borderRadius: props.thick / 2, backgroundColor: props.color, opacity: props.opacity ?? 1, transform: { rotate: angle } }} />;
}

export default function PaintOn3DDemo() {
  const [tick, setTick] = useState(0);
  const hoverRef = useRef<Hover>(null);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // One pump: advance the camera, then re-pick the hovered face from the LIVE cursor
  // (free-move delivers no onMouseMove — poll getMouseX/Y) using the next frame's camera
  // so the highlight and the render agree. Stored in a ref; setTick triggers the redraw.
  useEffect(() => {
    const host: any = globalThis as any;
    const id = setInterval(() => {
      setTick((prev) => {
        const next = prev + 1;
        const r = rectRef.current;
        if (r && typeof host.getMouseX === 'function') {
          const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
          const inside = mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height;
          hoverRef.current = inside ? pickFace(camAt(next), mx - r.x, my - r.y) : null;
        }
        return next;
      });
    }, 33);
    return () => clearInterval(id);
  }, []);

  const cam = camAt(tick);
  const project = makeProjector(cam);
  const proj = (p: V3): Proj => { const q = project(p); return { x: q.x, y: q.y, front: q.front }; };
  const hover = hoverRef.current;

  const overlay: any[] = [];
  FACES.forEach((f, fi) => {
    if (dot(f.normal, sub(cam.eye, faceCenter(f))) <= 0) return; // back-facing — skip
    // face outline
    const c0 = facePoint(f, 0, 0), c1 = facePoint(f, f.uLen, 0), c2 = facePoint(f, f.uLen, f.vLen), c3 = facePoint(f, 0, f.vLen);
    const corners = [c0, c1, c2, c3].map(proj);
    for (let i = 0; i < 4; i++) overlay.push(<Seg key={`o${fi}-${i}`} a={corners[i]} b={corners[(i + 1) % 4]} color="#7fd6c0" thick={1.6} opacity={0.85} />);
    // UNIFORM model-space grid: lines every CELL world-units along each axis, clipped to the face
    for (let u = CELL; u < f.uLen - 1e-4; u += CELL) overlay.push(<Seg key={`gu${fi}-${u.toFixed(2)}`} a={proj(facePoint(f, u, 0))} b={proj(facePoint(f, u, f.vLen))} color="#4fb8a0" thick={1.0} opacity={0.6} />);
    for (let v = CELL; v < f.vLen - 1e-4; v += CELL) overlay.push(<Seg key={`gv${fi}-${v.toFixed(2)}`} a={proj(facePoint(f, 0, v))} b={proj(facePoint(f, f.uLen, v))} color="#4fb8a0" thick={1.0} opacity={0.6} />);
    // hovered cell — ONLY on the hovered face, clipped to the face bounds (no spill across the box edge)
    if (hover && hover.face === fi) {
      const u0 = hover.cu * CELL, u1 = Math.min(u0 + CELL, f.uLen);
      const v0 = hover.cv * CELL, v1 = Math.min(v0 + CELL, f.vLen);
      const hc = [facePoint(f, u0, v0), facePoint(f, u1, v0), facePoint(f, u1, v1), facePoint(f, u0, v1)].map(proj);
      for (let i = 0; i < 4; i++) overlay.push(<Seg key={`hc${fi}-${i}`} a={hc[i]} b={hc[(i + 1) % 4]} color="#ffb019" thick={3} />);
      const ctr = proj(facePoint(f, (u0 + u1) / 2, (v0 + v1) / 2));
      if (ctr.front) overlay.push(<Box key={`hd${fi}`} style={{ position: 'absolute', left: ctr.x - 4, top: ctr.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffb019' }} />);
    }
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        hover the model — uniform grid on every face, highlight clips at the edge, never spills
      </Text>
      <Box onLayout={(r: any) => { rectRef.current = r; }} style={{ width: SIZE, height: SIZE, position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
          <Scene3D.Camera position={cam.eye} target={[0, 0, 0]} fov={FOV} />
          <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.4, 1, 0.3]} color="#ffffff" intensity={0.7} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Mesh geometry={Geom.box} params={{ width: 2 * HX, height: 2 * HY, depth: 2 * HZ }} material={{ color: '#caa6e0' }} position={[0, 0, 0]} />
        </Scene3D>
        <Box style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, pointerEvents: 'none', overflow: 'visible' }}>{overlay}</Box>
      </Box>
    </Box>
  );
}
