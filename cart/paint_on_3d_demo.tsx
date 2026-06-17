// paint_on_3d_demo — painting ON the 3D model, the correct way. The sequel to
// triangle_mask_demo (which proved the per-pixel no-spill mask in flat 2D).
//
// THE CORRECTED MENTAL MODEL (what the Studio painter must become):
//   1. You paint on the 3D MODEL surface — drag on the model, a ray finds the face
//      and the cell on it. You never paint "on the atlas" directly.
//   2. The atlas (the model's baked per-face texture) is READ-ONLY base. Paint is
//      a SEPARATE LAYER in the same surface space, composited OVER the base. Here
//      the base is the box's flat material (untouched) and the paint layer is the
//      filled cells drawn on top — erase it and the base is intact.
//   3. The grid is UNIFORM in MODEL-SURFACE space: one fixed world-space cell size
//      (CELL) on EVERY face. A bigger face just shows more cells; a thin face fewer
//      — never sliver cells. Camera zoom never changes it (the camera auto-orbits
//      AND zooms while idle to prove it; it freezes while you paint).
//   4. The mask is PER-FACE: a painted/hovered cell clips to its face and CANNOT
//      spill across a shared edge onto the perpendicular neighbour.
//
//   5. NO PINSTRIPES (req_1256). The old painter merged paint into one horizontal
//      run-box PER ROW and rasterized them into the atlas; fractional texel size
//      made each row-box round its top/height independently, opening periodic 1px
//      gaps that read as horizontal stripes. Here a painted cell is ONE solid
//      polygon (Graph.Path fill) from its projected corners. Adjacent cells share
//      exact edges, so the fill tiles seamlessly — a continuous layer, no rows, no
//      gaps, no stripes. That is the fix: stop rasterizing paint as per-row boxes.
//
// The grid/paint is a 2D layer projected through the SAME camera the host renders
// with (meshSelect.makeProjector replicates gpu/3d.zig), so it sits exactly on the
// rendered faces — the proven Studio overlay technique.
//
// Verify: ./tools/rjit shot paint_on_3d_demo --out /tmp/paint3d.png   (drag to paint live)

import { useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable, Scene3D, Text } from '@reactjit/runtime/primitives';
import { makeProjector, orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { screenRay } from './hmsc-int/editors/model/meshPaint';

type V3 = [number, number, number];

const SIZE = 620;
const FOV = 48;
const CELL = 0.3;            // grid cell size, in MODEL/WORLD units — uniform on every face
const PITCH = 20;            // camera elevation (deg)
const HX = 1.35, HY = 0.85, HZ = 0.85; // box half-extents (deliberately unequal faces)
const PAINT_COLOR = '#d24b4b'; // a flat red — the same colour the old painter pinstriped
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
const faceVisible = (f: Face, eye: V3): boolean => dot(f.normal, sub(eye, faceCenter(f))) > 0;
const cellsU = (f: Face) => Math.max(1, Math.round(f.uLen / CELL));
const cellsV = (f: Face) => Math.max(1, Math.round(f.vLen / CELL));

// camera as a pure function of the frame tick: spins in yaw, oscillates in distance
// (zoom) so "the grid stays the same size on the surface as the camera zooms" is visible.
function camAt(tick: number): CameraSnap {
  const yaw = tick * 0.5;
  const dist = 5.4 + 1.7 * Math.sin(tick * 0.018);
  const eye = orbitalEyeJS([0, 0, 0], yaw, PITCH, dist);
  return { eye, target: [0, 0, 0], fov: FOV, aspect: 1, w: SIZE, h: SIZE, near: 0.02 };
}

type Hit = { face: number; cu: number; cv: number };
const cellKey = (h: Hit) => `${h.face}:${h.cu}:${h.cv}`;

// raycast the cursor against the 6 faces; nearest FRONT-facing hit wins.
function pickFace(cam: CameraSnap, sx: number, sy: number): Hit | null {
  const { o, d } = screenRay(cam, sx, sy);
  let best: Hit | null = null;
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

// a projected world-space segment, drawn as a rotated thin box
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
  const [painted, setPainted] = useState<Record<string, string>>({});
  const hoverRef = useRef<Hit | null>(null);
  const drawingRef = useRef(false);
  const tickRef = useRef(0);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  tickRef.current = tick;

  // Pump: advance the camera (FROZEN while painting so the target holds still), then
  // re-pick the hovered face from the LIVE cursor (free-move delivers no onMouseMove —
  // poll getMouseX/Y) using the next frame's camera so highlight and render agree.
  useEffect(() => {
    const host: any = globalThis as any;
    const id = setInterval(() => {
      setTick((prev) => {
        const next = drawingRef.current ? prev : prev + 1;
        const r = rectRef.current;
        if (r && typeof host.getMouseX === 'function' && !drawingRef.current) {
          const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
          const inside = mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height;
          hoverRef.current = inside ? pickFace(camAt(next), mx - r.x, my - r.y) : null;
        }
        return next;
      });
    }, 33);
    return () => clearInterval(id);
  }, []);

  // paint the cell under a screen-space point into the paint LAYER (additive set).
  const paintAt = (screenX: number, screenY: number) => {
    const r = rectRef.current;
    if (!r) return;
    const hit = pickFace(camAt(tickRef.current), screenX - r.x, screenY - r.y);
    if (!hit) return;
    const key = cellKey(hit);
    setPainted((p) => (p[key] ? p : { ...p, [key]: PAINT_COLOR }));
  };

  const cam = camAt(tick);
  const project = makeProjector(cam);
  const proj = (p: V3): Proj => { const q = project(p); return { x: q.x, y: q.y, front: q.front }; };
  const hover = hoverRef.current;
  const C = SIZE / 2; // Graph is center-origin; pixel (px,py) → graph (px-C, py-C)

  // ── the PAINT LAYER: one solid filled polygon per painted cell ───────────────
  // Corners come straight from the projected face cell; adjacent cells share exact
  // corners, so the fills tile with no seam. This is the no-pinstripe fix.
  const fills: any[] = [];
  for (const key in painted) {
    const [fs, cus, cvs] = key.split(':');
    const f = FACES[Number(fs)];
    if (!f || !faceVisible(f, cam.eye)) continue;
    const cu = Number(cus), cv = Number(cvs);
    const u0 = cu * CELL, u1 = Math.min(u0 + CELL, f.uLen), v0 = cv * CELL, v1 = Math.min(v0 + CELL, f.vLen);
    const q = [facePoint(f, u0, v0), facePoint(f, u1, v0), facePoint(f, u1, v1), facePoint(f, u0, v1)].map(proj);
    if (!q.every((p) => p.front)) continue;
    const d = `M ${q[0].x - C},${q[0].y - C} L ${q[1].x - C},${q[1].y - C} L ${q[2].x - C},${q[2].y - C} L ${q[3].x - C},${q[3].y - C} Z`;
    fills.push(<Graph.Path key={key} d={d} fill={painted[key]} />);
  }

  // ── grid + outlines + hover highlight (line layer, on top of the fills) ──────
  const lines: any[] = [];
  FACES.forEach((f, fi) => {
    if (!faceVisible(f, cam.eye)) return;
    const c0 = facePoint(f, 0, 0), c1 = facePoint(f, f.uLen, 0), c2 = facePoint(f, f.uLen, f.vLen), c3 = facePoint(f, 0, f.vLen);
    const corners = [c0, c1, c2, c3].map(proj);
    for (let i = 0; i < 4; i++) lines.push(<Seg key={`o${fi}-${i}`} a={corners[i]} b={corners[(i + 1) % 4]} color="#7fd6c0" thick={1.6} opacity={0.85} />);
    for (let u = CELL; u < f.uLen - 1e-4; u += CELL) lines.push(<Seg key={`gu${fi}-${u.toFixed(2)}`} a={proj(facePoint(f, u, 0))} b={proj(facePoint(f, u, f.vLen))} color="#4fb8a0" thick={1.0} opacity={0.55} />);
    for (let v = CELL; v < f.vLen - 1e-4; v += CELL) lines.push(<Seg key={`gv${fi}-${v.toFixed(2)}`} a={proj(facePoint(f, 0, v))} b={proj(facePoint(f, f.uLen, v))} color="#4fb8a0" thick={1.0} opacity={0.55} />);
    if (hover && hover.face === fi) {
      const u0 = hover.cu * CELL, u1 = Math.min(u0 + CELL, f.uLen), v0 = hover.cv * CELL, v1 = Math.min(v0 + CELL, f.vLen);
      const hc = [facePoint(f, u0, v0), facePoint(f, u1, v0), facePoint(f, u1, v1), facePoint(f, u0, v1)].map(proj);
      for (let i = 0; i < 4; i++) lines.push(<Seg key={`hc${fi}-${i}`} a={hc[i]} b={hc[(i + 1) % 4]} color="#ffb019" thick={3} />);
    }
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        drag on the model to paint — solid fill, no pinstripes, clipped per face
      </Text>
      <Box onLayout={(r: any) => { rectRef.current = r; }} style={{ width: SIZE, height: SIZE, position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
          <Scene3D.Camera position={cam.eye} target={[0, 0, 0]} fov={FOV} />
          <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.4, 1, 0.3]} color="#ffffff" intensity={0.7} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Mesh geometry={Geom.box} params={{ width: 2 * HX, height: 2 * HY, depth: 2 * HZ }} material={{ color: '#caa6e0' }} position={[0, 0, 0]} />
        </Scene3D>
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1}>
          {fills}
        </Graph>
        <Box style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, pointerEvents: 'none', overflow: 'visible' }}>{lines}</Box>
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, backgroundColor: '#00000000' }}
          onMouseDown={(e: any) => { drawingRef.current = true; paintAt(e.x, e.y); }}
          onMouseMove={(e: any) => { if (drawingRef.current) paintAt(e.x, e.y); }}
          onMouseUp={() => { drawingRef.current = false; }}
          onMouseLeave={() => { drawingRef.current = false; }}
        />
      </Box>
    </Box>
  );
}
